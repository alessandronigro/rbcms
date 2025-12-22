const express = require("express");
const Brevo = require("@getbrevo/brevo");
const { getConnection } = require("../dbManager");

const router = express.Router();

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const TRANSACTIONAL_EMAILS_API = new Brevo.TransactionalEmailsApi();
if (BREVO_API_KEY) {
  TRANSACTIONAL_EMAILS_API.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, BREVO_API_KEY);
}

const MAX_WINDOW_DAYS = 31;
const DEFAULT_WINDOW_DAYS = 14;
const MAX_LIMIT = 200;
const REQUIRED_BCC = process.env.BREVO_REQUIRED_BCC || "vendite@formazioneintermediari.com";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BREVO_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000;
const CACHE_TTL_MS = 60 * 60 * 1000;

const brevoCache = new Map();
const brevoQueue = [];
let brevoQueueRunning = false;


const pad = (value) => (value < 10 ? `0${value}` : `${value}`);

const toYMD = (date) => {
  const normalized = new Date(date);
  return `${normalized.getFullYear()}-${pad(normalized.getMonth() + 1)}-${pad(
    normalized.getDate()
  )}`;
};

const parseDateParam = (value, fallback) => {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const normalizeEmail = (email) => (email || "").toString().trim().toLowerCase();
const normalizeName = (nome, cognome) =>
  [nome, cognome]
    .filter(Boolean)
    .map((item) => item.toString().trim())
    .join(" ")
    .trim();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function enqueueBrevoRequest(fn) {
  return new Promise((resolve, reject) => {
    brevoQueue.push({ fn, resolve, reject });
    runBrevoQueue().catch((err) => console.error("Errore queue Brevo:", err));
  });
}

async function runBrevoQueue() {
  if (brevoQueueRunning) return;
  brevoQueueRunning = true;
  while (brevoQueue.length > 0) {
    /* eslint-disable no-await-in-loop */
    const task = brevoQueue.shift();
    if (!task) break;
    try {
      const value = await task.fn();
      task.resolve(value);
    } catch (err) {
      task.reject(err);
    }
    if (brevoQueue.length > 0) {
      await wait(300);
    }
  }
  brevoQueueRunning = false;
}

async function fetchBrevoEntries(email, start, end, limit = 10) {
  const cacheKey = normalizeEmail(email);
  if (!cacheKey) {
    return { entries: [], attempts: 0 };
  }

  const cached = brevoCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return { entries: cached.entries, attempts: 0, cached: true };
  }

  let attempts = 0;
  let delay = INITIAL_RETRY_DELAY;
  let lastError = null;

  while (attempts < MAX_BREVO_RETRIES) {
    attempts += 1;
    try {
      const entries = await enqueueBrevoRequest(async () => {
        const { body } = await TRANSACTIONAL_EMAILS_API.getTransacEmailsList(
          email,
          undefined,
          undefined,
          start,
          end,
          "desc",
          limit,
          0
        );
        return Array.isArray(body?.transactionalEmails) ? body.transactionalEmails : [];
      });
      brevoCache.set(cacheKey, { entries, timestamp: Date.now() });
      return { entries, attempts };
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      const isRateLimit = status === 429;
      if (isRateLimit && attempts < MAX_BREVO_RETRIES) {
        console.warn(`⚠️ Brevo 429 per ${email}, riprovo in ${delay}ms`);
        await wait(delay);
        delay *= 2;
        continue;
      }
      console.warn(`⚠️ Brevo fetch fallito per ${email}:`, error.message || status);
      break;
    }
  }
  console.warn(`⚠️ fetchBrevoEntries: esauriti tentativi per ${email}`, lastError?.message || "");
  return { entries: [], attempts, error: lastError };
}

router.get("/welcome", async (req, res) => {
  if (!BREVO_API_KEY) {
    return res.status(503).json({
      success: false,
      error: "BREVO_API_KEY non configurata; impossibile interrogare l'API Brevo",
    });
  }

  try {
    const { email, nome = "", cognome = "", subject, start, end } = req.query;
    const targetEmail = email ? email.toString().trim() : "";
    if (!targetEmail) {
      return res.status(400).json({
        success: false,
        error: "Parametro email obbligatorio per interrogare i log transazionali Brevo",
      });
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || 25));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const now = new Date();
    const endDate = parseDateParam(end, now);
    let startDate = parseDateParam(
      start,
      new Date(endDate.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS)
    );

    if (startDate > endDate) {
      startDate = new Date(endDate.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);
    }

    const windowMs = MAX_WINDOW_DAYS * DAY_MS;
    if (endDate.getTime() - startDate.getTime() > windowMs) {
      startDate = new Date(endDate.getTime() - windowMs);
    }

    const inferredSubject = subject
      ? subject.toString().trim()
      : [nome, cognome].filter(Boolean).length
      ? `Benvenuto ${[nome, cognome].filter(Boolean).join(" ")}`
      : "Benvenuto";
    const subjectFilter = inferredSubject.toLowerCase();

    const { body } = await TRANSACTIONAL_EMAILS_API.getTransacEmailsList(
      targetEmail,
      undefined,
      undefined,
      toYMD(startDate),
      toYMD(endDate),
      "desc",
      limit,
      offset
    );

    const transactionalEmails = Array.isArray(body?.transactionalEmails)
      ? body.transactionalEmails
      : [];

    const filtered = transactionalEmails
      .map((item) => ({
        email: item.email,
        subject: item.subject,
        date: item.date,
        from: item.from,
        messageId: item.messageId,
        uuid: item.uuid,
        templateId: item.templateId,
        matchesSubject:
          typeof item.subject === "string" &&
          item.subject.toLowerCase().includes(subjectFilter),
        tags: Array.isArray(item.tags) ? item.tags : [],
      }))
      .filter((item) => item.matchesSubject);

    return res.json({
      success: true,
      metadata: {
        requiredBcc: REQUIRED_BCC,
        filters: {
          email: targetEmail,
          subject: inferredSubject,
          range: { start: toYMD(startDate), end: toYMD(endDate) },
          limit,
          offset,
        },
        totalAvailable: typeof body?.count === "number" ? body.count : transactionalEmails.length,
        returned: filtered.length,
      },
      data: filtered,
    });
  } catch (error) {
    console.error("❌ /api/mailcheck/welcome:", error);
    return res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message || "Errore nella chiamata a Brevo",
    });
  }
});

router.get("/december", async (req, res) => {
  if (!BREVO_API_KEY) {
    return res.status(503).json({
      success: false,
      error: "BREVO_API_KEY non configurata; impossibile interrogare l'API Brevo",
    });
  }

  const requestedYear = Number(req.query.year) || new Date().getFullYear();
  const requestedMonth = Number(req.query.month) || 12;
  const sanitizedMonth = Math.min(12, Math.max(1, requestedMonth));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));

  const startDate = new Date(requestedYear, sanitizedMonth - 1, 1);
  let endDate = new Date(requestedYear, sanitizedMonth, 0);
  const now = new Date();
  if (endDate > now) {
    endDate = now;
  }
  if (startDate > endDate) {
    startDate.setTime(endDate.getTime());
  }
  const startRange = `${toYMD(startDate)} 00:00:00`;
  const endRange = `${toYMD(endDate)} 23:59:59`;
  const brevoStart = toYMD(startDate);
  const brevoEnd = toYMD(endDate);

  try {
    const conn = await getConnection("forma4");
    const [users] = await conn.query(
      `
        SELECT
          cu.idUser,
          cu.idCourse,
          cu.date_inscr,
          cu.status,
          u.idst,
          u.userid,
          u.firstname,
          u.lastname,
          u.email,
          c.code AS courseCode,
          c.name AS courseName
        FROM learning_courseuser cu
        JOIN core_user u ON u.idst = cu.idUser
        LEFT JOIN learning_course c ON c.idCourse = cu.idCourse
        WHERE cu.date_inscr BETWEEN ? AND ?
        ORDER BY cu.date_inscr DESC
        LIMIT ?
      `,
      [startRange, endRange, limit]
    );

    const processedEmails = new Set();
    let brevoCalls = 0;
    let matchesFound = 0;
    const data = [];

    for (const row of users) {
      const emailKey = normalizeEmail(row.email);
      const normalizedFullName = normalizeName(row.firstname, row.lastname);
      let entries = [];

      if (emailKey) {
        processedEmails.add(emailKey);
        const { entries: fetchedEntries, attempts, error } = await fetchBrevoEntries(
          emailKey,
          brevoStart,
          brevoEnd,
          10
        );
        brevoCalls += attempts;
        entries = fetchedEntries;
        if (error) {
          console.warn("Brevo error durante il fetch:", emailKey, error.message || error);
        }
      }

      const tokens = [row.firstname, row.lastname]
        .filter(Boolean)
        .map((value) => value.toString().trim().toLowerCase())
        .filter(Boolean);

      const matchEntry =
        entries.find((entry) => {
          if (!entry?.subject) return false;
          const subjectLower = entry.subject.toLowerCase();
          if (normalizedFullName && subjectLower.includes(normalizedFullName.toLowerCase())) {
            return true;
          }
          return tokens.some((token) => subjectLower.includes(token));
        }) || null;

      if (matchEntry) matchesFound += 1;

      data.push({
        idUser: row.idUser,
        idst: row.idst,
        userid: row.userid || row.idst,
        nome: row.firstname,
        cognome: row.lastname,
        email: row.email,
        courseCode: row.courseCode || "—",
        courseName: row.courseName || "—",
        dateInscr: row.date_inscr,
        status: row.status,
        brevoMatch: matchEntry
          ? {
              subject: matchEntry.subject,
              date: matchEntry.date,
              from: matchEntry.from || "",
              messageId: matchEntry.messageId,
              uuid: matchEntry.uuid,
              tags: Array.isArray(matchEntry.tags) ? matchEntry.tags : [],
            }
          : null,
      });
    }

    return res.json({
      success: true,
      metadata: {
        year: requestedYear,
        month: sanitizedMonth,
        limit,
        range: { start: brevoStart, end: brevoEnd },
        totalUsers: users.length,
        brevoRequests: brevoCalls,
        matched: matchesFound,
        uniqueEmails: processedEmails.size,
        expectedBcc: REQUIRED_BCC,
      },
      data,
    });
  } catch (error) {
    console.error("❌ /api/mailcheck/december:", error);
    return res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message || "Errore nella query verso il DB o Brevo",
    });
  }
});

module.exports = router;
