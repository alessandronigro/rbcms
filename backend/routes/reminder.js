const express = require("express");
const dayjs = require("dayjs");
const Brevo = require("@getbrevo/brevo");
const { getConnection } = require("../dbManager");
const { invioMail } = require("../utils/mailerBrevo");
const axios = require("axios");

const router = express.Router();

const CURRENT_YEAR_DB = "forma4";
const LAST_YEAR_DB = "newformazionein";
const TARGET_DBS = [CURRENT_YEAR_DB];
const MAX_ROWS_PER_DB = 400;

const KNOWN_STATUS_KEYS = ["completato", "in-itinere", "iscritto"];

const CAMPAIGN_SENDER_EMAIL =
  process.env.CAMPAIGN_SENDER_EMAIL || process.env.SMTP_FROM || "info@formazioneintermediari.com";
const CAMPAIGN_REPLY_EMAIL = process.env.CAMPAIGN_REPLY_EMAIL || CAMPAIGN_SENDER_EMAIL;

function parseFolderId(value) {
  const trimmed = (value ?? "").toString().trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const BREVO_CONTACTS_FOLDER_ID = parseFolderId(
  process.env.BREVO_CONTACTS_FOLDER_ID ?? process.env.BREVO_FOLDER_ID,
);

function determineStatus(row) {
  const isComplete = Boolean(row.date_complete) || row.status == 2;
  if (isComplete) return { key: "completato", label: "Completato" };
  if (row.lastenter) return { key: "in-itinere", label: "In itinere" };
  return { key: "iscritto", label: "Iscritto" };
}

function matchStatusFilter(filter, key) {
  if (!filter || filter === "tutti") return true;
  if (filter === "iscritto-in-itinere") return ["iscritto", "in-itinere"].includes(key);
  return filter === key;
}

function normalizeCourseToken(value) {
  const token = (value ?? "").toString().trim().toLowerCase();
  return token || null;
}

function parseConditionCourseCodes(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((token) => normalizeCourseToken(token)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\s,;]+/)
      .map((token) => normalizeCourseToken(token))
      .filter(Boolean);
  }
  return [];
}

function parseConditionGroups(value) {
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((condition) => ({
        matchMode: condition?.matchMode === "all" ? "all" : "any",
        notEnrolledThisYear: Boolean(condition?.notEnrolledThisYear),
        excludeCourseCodes: parseConditionCourseCodes(condition?.excludeCourseCodes),
        courseCodes: parseConditionCourseCodes(condition?.courseCodes),
      }))
      .filter((condition) => condition.courseCodes.length > 0);
  } catch (error) {
    console.warn("⚠️ Reminder conditions parse failed:", error);
    return [];
  }
}

function rowMatchesCourseToken(row, token) {
  if (!token) return false;
  const courseCode = normalizeCourseToken(row.courseCode);
  const courseName = normalizeCourseToken(row.courseName);
  const courseId = row.idCourse ? normalizeCourseToken(row.idCourse.toString()) : null;
  return token === courseCode || token === courseName || token === courseId;
}

function rowCompletedLastYear(row, startOfLastYear, endOfLastYear) {
  const status = determineStatus(row);
  if (status.key !== "completato") return false;
  const completionDate = row.date_complete
    ? dayjs(row.date_complete)
    : row.date_inscr
      ? dayjs(row.date_inscr)
      : null;
  if (!completionDate || !completionDate.isValid()) return false;
  return !completionDate.isBefore(startOfLastYear) && !completionDate.isAfter(endOfLastYear);
}

async function userHasEnrollmentThisYear(userId, dbName, startOfYear, dbConnections, cache) {
  if (!dbName) return true;
  const cacheKey = `${dbName}:${userId}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const conn = dbConnections.get(dbName);
  if (!conn) {
    cache.set(cacheKey, true);
    return true;
  }
  try {
    const [rows] = await conn.query(
      `SELECT 1 FROM learning_courseuser WHERE idUser = ? AND date_inscr >= ? LIMIT 1`,
      [userId, startOfYear.format("YYYY-MM-DD HH:mm:ss")],
    );
    const hasEnrollment = Array.isArray(rows) && rows.length > 0;
    cache.set(cacheKey, hasEnrollment);
    return hasEnrollment;
  } catch (error) {
    console.warn("⚠️ Reminder enrollment check failed:", error);
    cache.set(cacheKey, true);
    return true;
  }
}

async function userMatchesAnyCondition(
  userRows,
  conditionGroups,
  currentYearDb,
  userId,
  startOfLastYear,
  endOfLastYear,
  startOfYear,
  dbConnections,
  enrollmentCache,
) {
  for (const condition of conditionGroups) {
    const matchesToken = (token) =>
      userRows.some(
        (row) => rowCompletedLastYear(row, startOfLastYear, endOfLastYear) && rowMatchesCourseToken(row, token),
      );
    const satisfies =
      condition.matchMode === "all"
        ? condition.courseCodes.every(matchesToken)
        : condition.courseCodes.some(matchesToken);
    if (!satisfies) continue;
    const currentYearRows = userRows.filter((row) => row.sourceDb === currentYearDb);
    if (condition.excludeCourseCodes?.length) {
      const hasExcludedCourse = condition.excludeCourseCodes.some((token) =>
        currentYearRows.some((row) => rowMatchesCourseToken(row, token)),
      );
      if (hasExcludedCourse) {
        continue;
      }
    }
    if (condition.notEnrolledThisYear) {
      const hasEnrollment = await userHasEnrollmentThisYear(
        userId,
        currentYearDb,
        startOfYear,
        dbConnections,
        enrollmentCache,
      );
      if (hasEnrollment) {
        continue;
      }
    }
    return true;
  }
  return false;
}

router.get("/users", async (req, res) => {
  try {
    const { period = "tutti", course = "", convenzione, from, to, status = "tutti" } = req.query;
    const courseFilters = (course || "").toString().split(",").map((value) => value.trim()).filter(Boolean);
    const numericCourses = courseFilters.filter((value) => /^\d+$/.test(value)).map((value) => Number(value));
    const codeCourses = courseFilters.filter((value) => value && !/^\d+$/.test(value));

    const parsedFrom = from ? dayjs(from.toString()).startOf("day") : null;
    const parsedTo = to ? dayjs(to.toString()).endOf("day") : null;
    const startOfYear = dayjs().startOf("year");
    const startOfMonth = dayjs().startOf("month");
    const conditionGroups = parseConditionGroups(req.query.conditions);
    const startOfLastYear = startOfYear.subtract(1, "year");
    const endOfLastYear = startOfLastYear.endOf("year");
    const dbConnections = new Map();
    const userRowsMap = new Map();
    const resultsMap = new Map();

    for (const dbName of TARGET_DBS) {
      const conn = await getConnection(dbName);
      dbConnections.set(dbName, conn);
      const clauses = ["1=1"];
      const params = [];

      if (numericCourses.length) {
        clauses.push(`c.idCourse IN (${numericCourses.map(() => "?").join(",")})`);
        params.push(...numericCourses);
      }
      if (codeCourses.length) {
        clauses.push(`c.code IN (${codeCourses.map(() => "?").join(",")})`);
        params.push(...codeCourses);
      }
      if (convenzione) {
        clauses.push("cf.user_entry = ?");
        params.push(convenzione.toString());
      }

      if (parsedFrom?.isValid()) {
        clauses.push("cu.date_inscr >= ?");
        params.push(parsedFrom.format("YYYY-MM-DD HH:mm:ss"));
      } else if (period === "anno-corrente") {
        clauses.push("cu.date_inscr >= ?");
        params.push(startOfYear.format("YYYY-MM-DD HH:mm:ss"));
      } else if (period === "mese-corrente") {
        clauses.push("cu.date_inscr >= ?");
        params.push(startOfMonth.format("YYYY-MM-DD HH:mm:ss"));
      }

      if (parsedTo?.isValid()) {
        clauses.push("cu.date_inscr <= ?");
        params.push(parsedTo.format("YYYY-MM-DD HH:mm:ss"));
      }

      const whereClause = clauses.join(" AND ");
      const sql = `
        SELECT
          cu.idUser,
          cu.idCourse,
          cu.date_inscr,
          cu.date_complete,
          u.lastenter,
          cu.status,
          u.idst AS id,
          u.firstname,
          u.lastname,
          u.email,
          c.name AS courseName,
          c.code AS courseCode,
          cf.user_entry AS convenzione
        FROM learning_courseuser cu
        JOIN core_user u ON u.idst = cu.idUser
        LEFT JOIN core_field_userentry cf ON cf.id_user = u.idst AND cf.id_common = 25
        LEFT JOIN learning_course c ON c.idCourse = cu.idCourse
        WHERE ${whereClause}
        ORDER BY cu.date_inscr DESC
        LIMIT ?
      `;

      const [rows] = await conn.query(sql, [...params, MAX_ROWS_PER_DB]);
      rows.forEach((row) => {
        const status = determineStatus(row);
        const normalizedRow = {
          id: row.id,
          nome: row.firstname,
          cognome: row.lastname,
          email: row.email,
          courseId: String(row.idCourse),
          courseName: row.courseName || row.courseCode || "—",
          convenzione: row.convenzione || "—",
          lastActivity: row.lastenter || row.date_inscr || null,
          statusKey: status.key,
          statusLabel: status.label,
          courseCode: row.courseCode,
          sourceDb: dbName,
        };
        const existing = resultsMap.get(row.id);
        if (!existing || dbName === CURRENT_YEAR_DB) {
          resultsMap.set(row.id, normalizedRow);
        }

        const userRows = userRowsMap.get(row.id) || [];
        userRows.push({
          idCourse: row.idCourse,
          courseCode: row.courseCode,
          courseName: row.courseName,
          date_inscr: row.date_inscr,
          date_complete: row.date_complete,
          status: row.status,
          lastenter: row.lastenter,
          sourceDb: dbName,
        });
        userRowsMap.set(row.id, userRows);
      });
    }

    if (conditionGroups.length) {
      const courseTokens = [
        ...new Set(conditionGroups.flatMap((condition) => condition.courseCodes)),
      ];
      if (courseTokens.length) {
        const numericCourseIds = courseTokens.filter((token) => /^\d+$/.test(token)).map(Number);
        const textCourseCodes = courseTokens.filter((token) => !/^\d+$/.test(token)).map((token) => token.toLowerCase());
        const clauses = [
          "cu.date_complete IS NOT NULL",
          "cu.date_complete >= ?",
          "cu.date_complete <= ?",
        ];
        const paramsLastYear = [
          startOfLastYear.format("YYYY-MM-DD HH:mm:ss"),
          endOfLastYear.format("YYYY-MM-DD HH:mm:ss"),
        ];
        if (numericCourseIds.length) {
          clauses.push(`c.idCourse IN (${numericCourseIds.map(() => "?").join(",")})`);
          paramsLastYear.push(...numericCourseIds);
        }
        if (textCourseCodes.length) {
          clauses.push(`LOWER(c.code) IN (${textCourseCodes.map(() => "?").join(",")})`);
          paramsLastYear.push(...textCourseCodes);
        }
        const whereClause = clauses.join(" AND ");
        const connLastYear = await getConnection(LAST_YEAR_DB);
        dbConnections.set(LAST_YEAR_DB, connLastYear);
        const sqlLastYear = `
          SELECT
            cu.idUser,
            cu.idCourse,
            cu.date_inscr,
            cu.date_complete,
            u.lastenter,
            cu.status,
            u.idst AS id,
            u.firstname,
            u.lastname,
            u.email,
            c.name AS courseName,
            c.code AS courseCode,
            cf.user_entry AS convenzione
          FROM learning_courseuser cu
          JOIN core_user u ON u.idst = cu.idUser
          LEFT JOIN core_field_userentry cf ON cf.id_user = u.idst AND cf.id_common = 25
          LEFT JOIN learning_course c ON c.idCourse = cu.idCourse
          WHERE ${whereClause}
          ORDER BY cu.date_inscr DESC
          LIMIT ?
        `;
        const [rows] = await connLastYear.query(sqlLastYear, [...paramsLastYear, MAX_ROWS_PER_DB]);
        rows.forEach((row) => {
          const status = determineStatus(row);
          const normalizedRow = {
            id: row.id,
            nome: row.firstname,
            cognome: row.lastname,
            email: row.email,
            courseId: String(row.idCourse),
            courseName: row.courseName || row.courseCode || "—",
            convenzione: row.convenzione || "—",
            lastActivity: row.date_complete || row.date_inscr || null,
            statusKey: status.key,
            statusLabel: status.label,
            courseCode: row.courseCode,
            sourceDb: LAST_YEAR_DB,
          };
          if (!resultsMap.has(row.id)) {
            resultsMap.set(row.id, normalizedRow);
          }

          const userRows = userRowsMap.get(row.id) || [];
          userRows.push({
            idCourse: row.idCourse,
            courseCode: row.courseCode,
            courseName: row.courseName,
            date_inscr: row.date_inscr,
            date_complete: row.date_complete,
            status: row.status,
            lastenter: row.lastenter,
            sourceDb: LAST_YEAR_DB,
          });
          userRowsMap.set(row.id, userRows);
        });
      }
    }

    let results = Array.from(resultsMap.values());
    let filtered = results.filter((user) => matchStatusFilter(status.toString(), user.statusKey));

    if (conditionGroups.length) {
      const enrollmentCache = new Map();
      const filteredWithConditions = [];
      for (const user of filtered) {
        const userRows = userRowsMap.get(user.id) || [];
        if (!userRows.length) continue;
        const matches = await userMatchesAnyCondition(
          userRows,
          conditionGroups,
          CURRENT_YEAR_DB,
          user.id,
          startOfLastYear,
          endOfLastYear,
          startOfYear,
          dbConnections,
          enrollmentCache,
        );
        if (matches) {
          filteredWithConditions.push(user);
        }
      }
      filtered = filteredWithConditions;
    }

    // If a convenzione filter is applied, fetch additional email addresses from wpacquisti.newconvenzioni
    if (convenzione) {
      try {
        const connW = await getConnection('wpacquisti');
        const [mailRows] = await connW.query(
          `SELECT mailbcc FROM newconvenzioni WHERE name = ? LIMIT 1`,
          [convenzione]
        );
        const mailbcc = mailRows?.[0]?.mailbcc;
        if (mailbcc) {
          console.log('🔎 mailbcc fetched for convenzione', convenzione, ':', mailbcc);
          const extraEmails = mailbcc
            .split(/[;,]/)
            .map((e) => e.trim())
            .filter(Boolean);
          console.log('🔎 extraEmails parsed:', extraEmails);
          extraEmails.forEach((email) => {
            filtered.push({
              id: null,
              nome: '',
              cognome: '',
              email,
              courseId: '',
              courseName: '',
              convenzione,
              lastActivity: null,
              statusKey: '',
              statusLabel: '',
              courseCode: '',
              sourceDb: 'wpacquisti',
            });
          });
        }
      } catch (e) {
        console.warn('⚠️ Unable to fetch extra emails for convenzione', convenzione, e);
      }
    }

    return res.json({
      users: filtered,
      total: filtered.length,
    });
  } catch (error) {
    console.error("❌ /api/reminder/users:", error);
    return res.status(500).json({ error: "Impossibile caricare i corsisti" });
  }
});

router.post("/send", async (req, res) => {
  const { recipients, subject, body: htmlBody, test } = req.body || {};
  if (!subject || !htmlBody) {
    return res.status(400).json({ error: "Oggetto e corpo sono obbligatori" });
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: "Lista destinatari mancante" });
  }

  const normalized = [];
  const seen = new Set();
  for (const recipient of recipients) {
    const email = (recipient.email || "").toString().trim();
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    normalized.push({ id: recipient.id, email, nome: recipient.nome, cognome: recipient.cognome });
  }

  if (!normalized.length) {
    return res.status(400).json({ error: "Nessun indirizzo email valido" });
  }

  const from = process.env.SMTP_FROM || "supporto@rbconsulenza.com";
  const target = test ? "supporto@rbconsulenza.com" : null;

  const sendPromises = normalized.map((recipient) =>
    invioMail({
      to: target || recipient.email,
      from,
      subject,
      html: htmlBody,
      iduser: recipient.id,
    }),
  );

  const results = await Promise.allSettled(sendPromises);
  const errors = results.filter((result) => result.status === "rejected");

  return res.json({
    success: errors.length === 0,
    message: `Email ${test ? "di test " : ""}spedite: ${normalized.length - errors.length}/${normalized.length}`,
    errors: errors.map((error) => (error.reason?.message ? error.reason.message : "Errore sconosciuto")),
  });
});

router.post("/brevo", async (req, res) => {
  const { recipients, subject, body: htmlContent } = req.body || {};
  const brevoKey = process.env.BREVO_API_KEY;
  if (!brevoKey) {
    return res.status(500).json({ error: "Chiave BREVO_API_KEY non configurata" });
  }
  if (!BREVO_CONTACTS_FOLDER_ID) {
    return res.status(500).json({
      error: "Imposta BREVO_CONTACTS_FOLDER_ID (o BREVO_FOLDER_ID) per creare le liste Brevo",
    });
  }
  if (!subject || !htmlContent) {
    return res.status(400).json({ error: "Oggetto e corpo email sono obbligatori" });
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: "Seleziona almeno un destinatario" });
  }

  const contactsApi = new Brevo.ContactsApi();
  contactsApi.setApiKey(Brevo.ContactsApiApiKeys.apiKey, brevoKey);
  const emailCampaignsApi = new Brevo.EmailCampaignsApi();
  emailCampaignsApi.setApiKey(Brevo.EmailCampaignsApiApiKeys.apiKey, brevoKey);

  const normalized = [];
  const seen = new Set();
  for (const recipient of recipients) {
    const email = (recipient.email || "").toString().trim();
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    normalized.push({
      email,
      nome: recipient.nome || "",
      cognome: recipient.cognome || "",
      courseName: recipient.courseName || "",
      convenzione: recipient.convenzione || "",
    });
  }

  if (!normalized.length) {
    return res.status(400).json({ error: "Nessun indirizzo email valido trovato" });
  }

  let listId = null;
  try {
    const listPayload = new Brevo.CreateList();
    listPayload.name = `Reminder ${dayjs().format("YYYY-MM-DD HH:mm:ss")}`;
    listPayload.folderId = BREVO_CONTACTS_FOLDER_ID;
    console.log("ℹ️ Creazione lista Brevo con folderId:", BREVO_CONTACTS_FOLDER_ID);
    const listResponse = await contactsApi.createList(listPayload);
    console.log("✅ Brevo createList response:", {
      status: listResponse.status,
      body: listResponse.body,
    });
    listId = listResponse.body?.id;
    if (!listId) throw new Error("Non è stato possibile creare la lista Brevo");

    for (const recipient of normalized) {
      const contactPayload = new Brevo.CreateContact();
      contactPayload.email = recipient.email;
      contactPayload.attributes = {
        FIRSTNAME: recipient.nome,
        LASTNAME: recipient.cognome,
        CONVENZIONE: recipient.convenzione,
        CORSO: recipient.courseName,
      };
      contactPayload.listIds = [listId];
      contactPayload.updateEnabled = true;
      try {
        const contactResponse = await contactsApi.createContact(contactPayload);
        console.log("✅ Brevo createContact response:", {
          email: recipient.email,
          status: contactResponse.status,
        });
      } catch (innerErr) {
        console.warn("⚠️ ContactsApi.createContact:", innerErr.message);
      }
    }

    const campaignPayload = new Brevo.CreateEmailCampaign();
    campaignPayload.name = `Reminder ${dayjs().format("YYYY-MM-DD HH:mm:ss")}`;
    campaignPayload.subject = subject;
    campaignPayload.htmlContent = htmlContent;
    const sender = new Brevo.CreateEmailCampaignSender();
    sender.email = CAMPAIGN_SENDER_EMAIL;
    sender.name = process.env.CAMPAIGN_SENDER_NAME || "RB Intermediari";
    campaignPayload.sender = sender;
    campaignPayload.replyTo = CAMPAIGN_REPLY_EMAIL;
    campaignPayload.recipients = new Brevo.CreateEmailCampaignRecipients();
    campaignPayload.recipients.listIds = [listId];

    const campaignResponse = await emailCampaignsApi.createEmailCampaign(campaignPayload);
    const campaignId = campaignResponse.body?.id;
    console.log("✅ Brevo createEmailCampaign response:", {
      status: campaignResponse.status,
      body: campaignResponse.body,
    });
    if (!campaignId) throw new Error("Non è stato possibile creare la campagna Brevo");

    const sendResponse = await axios.post(
      `${emailCampaignsApi.basePath}/emailCampaigns/${campaignId}/sendNow`,
      null,
      {
        headers: {
          Accept: "application/json",
          "api-key": brevoKey,
        },
      },
    );
    console.log("✅ Brevo sendEmailCampaignNow response:", {
      status: sendResponse.status,
      data: sendResponse.data,
    });
    return res.json({
      success: true,
      message: `Campagna Brevo inviata (${normalized.length} destinatari)`,
      campaignId,
      listId,
    });
  } catch (error) {
    console.error("❌ /api/reminder/brevo:", error);
    return res.status(500).json({ error: error.message || "Errore invio campagna Brevo" });
  } finally {
  }
});

module.exports = router;
