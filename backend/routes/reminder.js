const express = require("express");
const dayjs = require("dayjs");
const fs = require("fs");
const path = require("path");
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

const REMINDER_LOG_DIR = path.join(__dirname, "../public/log/general");
const REMINDER_LOG_FILE = path.join(REMINDER_LOG_DIR, "reminder.log");

const COURSE_ALIAS_MAP = {
  "cod30%": ["cod3033", "cod3034"],
  "cod15%": ["cod1533", "cod1534"],
  "cod60%": ["cod6033", "cod6034"],
};

const IVASS_COURSE_PATTERNS = ["%cod30%", "%cod15%", "%cod60%"];
const IVASS_EXCLUSION_PATTERNS = ["%cod30%", "%cod15%"];
const MAX_TEMP_COURSE_IDS_PER_QUERY = 50;
const MAX_FORM4_MATCH_KEYS_PER_QUERY = 250;
const REMINDER_PRESET_GROUPS = {
  oam: {
    matchMode: "all",
    courseCodes: ["codoam30%", "codoam15%", "codoam45%", "codoam1a%", "codoampv%"],
    excludeCourseCodes: ["codoam30%", "codoam15%", "codoam45%"],
    notEnrolledThisYear: true,
  },
  ivass: {
    matchMode: "all",
    courseCodes: ["cod30%", "cod15%", "cod60%"],
    excludeCourseCodes: ["cod30%", "cod15%"],
    notEnrolledThisYear: false,
    convenzione: "Formazione Intermediari",
  },
};

function formatLogValue(value) {
  if (value instanceof Error) {
    return `${value.message}${value.stack ? ` | Stack: ${value.stack}` : ""}`;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (err) {
      return String(value);
    }
  }
  return String(value);
}

function logReminder(level, message, details) {
  try {
    if (!fs.existsSync(REMINDER_LOG_DIR)) {
      fs.mkdirSync(REMINDER_LOG_DIR, { recursive: true });
    }
    const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
    const detailPart = details !== undefined ? ` | ${formatLogValue(details)}` : "";
    fs.appendFileSync(
      REMINDER_LOG_FILE,
      `[${timestamp}] [${level}] ${message}${detailPart}\n`,
      "utf8",
    );
  } catch (error) {
    console.error("❌ reminder log write failed:", error);
  }
}

function formatParam(param) {
  if (param === null || param === undefined) return "NULL";
  if (typeof param === "string") return `'${param.replace(/'/g, "''")}'`;
  if (typeof param === "boolean") return param ? "1" : "0";
  return String(param);
}

function formatQueryWithParams(sql, params) {
  let compact = sql.replace(/\s+/g, " ").trim();
  for (const param of params) {
    compact = compact.replace("?", formatParam(param));
  }
  return compact;
}

function logReminderQuery(db, sql, params) {
  const formatted = formatQueryWithParams(sql, params);
  logReminder("INFO", `Reminder query executed [${db}] ${formatted}`);
}

async function fetchConvenzioneMailBcc(convenzione) {
  if (!convenzione) return [];
  try {
    const connW = await getConnection("wpacquisti");
    const querySql = `SELECT mailbcc FROM newconvenzioni WHERE name = ? LIMIT 1`;
    logReminderQuery("wpacquisti", querySql, [convenzione]);
    const [mailRows] = await connW.query(querySql, [convenzione]);
    const mailbcc = mailRows?.[0]?.mailbcc;
    if (!mailbcc) return [];
    const extraEmails = mailbcc
      .split(/[;,]/)
      .map((email) => email.trim())
      .filter(Boolean);
    logReminder("INFO", `mailbcc fetched for convenzione ${convenzione}`, extraEmails);
    return extraEmails;
  } catch (error) {
    logReminder("WARN", `Unable to fetch extra emails for convenzione ${convenzione}`, error);
    return [];
  }
}

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

function escapeForRegex(value) {
  return value.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
}

function matchesWildcard(value, token) {
  if (!value || !token) return false;
  if (!token.includes("%")) {
    return value === token;
  }
  const escaped = escapeForRegex(token);
  const regex = new RegExp(`^${escaped.replace(/%/g, ".*")}$`);
  return regex.test(value);
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
    logReminder("WARN", "Reminder conditions parse failed", error);
    return [];
  }
}

function expandCourseToken(token) {
  if (!token) return [];
  const normalized = token.toLowerCase();
  if (COURSE_ALIAS_MAP[normalized]) {
    return COURSE_ALIAS_MAP[normalized];
  }
  return [normalized];
}

async function getCourseIdsByLike(dbName, patterns) {
  if (!patterns.length) return [];
  const conn = await getConnection(dbName);
  const clause = patterns.map(() => "LOWER(code) LIKE ?").join(" OR ");
  const sql = `SELECT DISTINCT idCourse FROM learning_course WHERE ${clause}`;
  const params = patterns.map((pattern) => pattern.toLowerCase());
  logReminderQuery(dbName, sql, params);
  const [rows] = await conn.query(sql, params);
  return Array.from(new Set(rows.map((row) => row.idCourse).filter(Boolean)));
}

async function queryIvassFromTemp() {
  const candidateCodes = IVASS_COURSE_PATTERNS;
  const tempCourseIds = await getCourseIdsByLike("tempnewformazionein", candidateCodes);
  if (!tempCourseIds.length) {
    return { users: [], total: 0 };
  }
  const tempConn = await getConnection("tempnewformazionein");
  const tempRows = [];
  const tempQueryBase = `
    SELECT DISTINCT
      u.firstname,
      u.lastname,
      cf_cf.user_entry AS codiceFiscale,
      cf_convenzione.user_entry AS convenzione,
      cu.idCourse
    FROM learning_courseuser cu
    JOIN core_user u ON u.idst = cu.idUser
    LEFT JOIN core_field_userentry cf_convenzione ON cf_convenzione.id_user = u.idst AND cf_convenzione.id_common = 25
    LEFT JOIN core_field_userentry cf_cf ON cf_cf.id_user = u.idst AND cf_cf.id_common = 23
    LEFT JOIN learning_course c ON c.idCourse = cu.idCourse
    WHERE LOWER(cf_convenzione.user_entry) = ?
      AND c.idCourse IN
  `;
  for (let offset = 0; offset < tempCourseIds.length; offset += MAX_TEMP_COURSE_IDS_PER_QUERY) {
    const chunk = tempCourseIds.slice(offset, offset + MAX_TEMP_COURSE_IDS_PER_QUERY);
    const chunkClause = `(${chunk.map(() => "?").join(",")})`;
    const sqlChunk = `${tempQueryBase} ${chunkClause}`;
    const chunkParams = ["formazione intermediari", ...chunk];
    logReminderQuery("tempnewformazionein", sqlChunk, chunkParams);
    const [rows] = await tempConn.query(sqlChunk, chunkParams);
    tempRows.push(...rows);
  }
  const candidateMap = new Map();
  tempRows.forEach((row) => {
    const matchKey = buildUserKey({
      firstname: row.firstname,
      lastname: row.lastname,
      codiceFiscale: row.codiceFiscale,
      convenzione: row.convenzione,
    });
    if (!matchKey) return;
    if (!candidateMap.has(matchKey)) {
      candidateMap.set(matchKey, {
        firstname: row.firstname || "",
        lastname: row.lastname || "",
        codiceFiscale: row.codiceFiscale || "",
        convenzione: row.convenzione || "",
        matchKey,
        courseIds: new Set(),
      });
    }
    const candidate = candidateMap.get(matchKey);
    if (row.idCourse) {
      candidate.courseIds.add(row.idCourse);
    }
  });
  const candidates = Array.from(candidateMap.values());

  if (!candidates.length) {
    return { users: [], total: 0 };
  }

  const exclusionCourseIds = await getCourseIdsByLike("forma4", IVASS_EXCLUSION_PATTERNS);
  const forma4Conn = await getConnection("forma4");
  const matchExpr =
    "CONCAT(LOWER(u.firstname), '|', LOWER(u.lastname), '|', LOWER(cf_cf.user_entry), '|', LOWER(cf_convenzione.user_entry))";
  const excludedKeys = new Set();
  const matchKeys = candidates.map((candidate) => candidate.matchKey).filter(Boolean);
  if (exclusionCourseIds.length && matchKeys.length) {
    const exclusionClause = exclusionCourseIds.map(() => "?").join(",");
    for (let offset = 0; offset < matchKeys.length; offset += MAX_FORM4_MATCH_KEYS_PER_QUERY) {
      const chunkKeys = matchKeys.slice(offset, offset + MAX_FORM4_MATCH_KEYS_PER_QUERY);
      const chunkClause = chunkKeys.map(() => "?").join(",");
      const sqlForma4 = `
        SELECT DISTINCT
          ${matchExpr} AS matchKey
        FROM learning_courseuser cu
        JOIN core_user u ON u.idst = cu.idUser
        LEFT JOIN core_field_userentry cf_convenzione ON cf_convenzione.id_user = u.idst AND cf_convenzione.id_common = 25
        LEFT JOIN core_field_userentry cf_cf ON cf_cf.id_user = u.idst AND cf_cf.id_common = 23
        LEFT JOIN learning_course c ON c.idCourse = cu.idCourse
        WHERE c.idCourse IN (${exclusionClause})
          AND ${matchExpr} IN (${chunkClause})
      `;
      const forma4Params = [...exclusionCourseIds, ...chunkKeys];
      logReminderQuery("forma4", sqlForma4, forma4Params);
      const [forma4Rows] = await forma4Conn.query(sqlForma4, forma4Params);
      forma4Rows.forEach((row) => {
        excludedKeys.add(row.matchKey);
      });
    }
  }
  const filtered = candidates.filter((candidate) => !excludedKeys.has(candidate.matchKey));

  return {
    users: filtered.map((candidate, index) => ({
      id: index + 1,
      nome: candidate.firstname,
      cognome: candidate.lastname,
      email: "",
      convenzione: candidate.convenzione,
      courseId: "",
      courseName: "",
      statusKey: "",
      statusLabel: "",
      lastActivity: null,
    })),
    total: filtered.length,
  };
}

function rowMatchesCourseToken(row, token) {
  if (!token) return false;
  const courseCode = normalizeCourseToken(row.courseCode);
  const courseName = normalizeCourseToken(row.courseName);
  const courseId = row.idCourse ? normalizeCourseToken(row.idCourse.toString()) : null;
  return (
    matchesWildcard(courseCode, token) ||
    matchesWildcard(courseName, token) ||
    matchesWildcard(courseId, token)
  );
}

function buildUserKey({ firstname, lastname, codiceFiscale, convenzione }) {
  const parts = [firstname, lastname, codiceFiscale, convenzione].map((value) =>
    (value ?? "").toString().trim().toLowerCase(),
  );
  return parts.join("|");
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
    logReminder("WARN", "Reminder enrollment check failed", error);
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
    const expandedCourseCodes = condition.courseCodes.flatMap((token) => expandCourseToken(token));
    const matchesToken = (token) =>
      userRows.some(
        (row) => rowCompletedLastYear(row, startOfLastYear, endOfLastYear) && rowMatchesCourseToken(row, token),
      );
    const satisfies =
      condition.matchMode === "all"
        ? expandedCourseCodes.every(matchesToken)
        : expandedCourseCodes.some(matchesToken);
    if (!satisfies) continue;
    const currentYearRows = userRows.filter((row) => row.sourceDb === currentYearDb);
    const expandedExclude = condition.excludeCourseCodes?.flatMap((token) => expandCourseToken(token)) ?? [];
    if (expandedExclude.length) {
      const hasExcludedCourse = expandedExclude.some((token) =>
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

async function queryReminderUsers({
  period = "tutti",
  course = "",
  convenzione,
  from,
  to,
  status = "tutti",
  conditionGroups = [],
}) {
  const courseFilters = (course || "")
    .toString()
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const expandedCourseFilters = courseFilters.flatMap((token) =>
    /^\d+$/.test(token) ? [token] : expandCourseToken(token),
  );
  const numericCourses = expandedCourseFilters.filter((value) => /^\d+$/.test(value)).map((value) => Number(value));
  const codeCourses = expandedCourseFilters.filter((value) => value && !/^\d+$/.test(value));

  const parsedFrom = from ? dayjs(from.toString()).startOf("day") : null;
  const parsedTo = to ? dayjs(to.toString()).endOf("day") : null;
  const startOfYear = dayjs().startOf("year");
  const startOfMonth = dayjs().startOf("month");
  const startOfLastYear = startOfYear.subtract(1, "year");
  const endOfLastYear = startOfLastYear.endOf("year");
  const dbConnections = new Map();
  const userRowsMap = new Map();
  const resultsMap = new Map();
  const debugQueries = [];

  const recordRow = (row, sourceDb) => {
    const statusResult = determineStatus(row);
    const key = buildUserKey({
      firstname: row.firstname,
      lastname: row.lastname,
      codiceFiscale: row.codiceFiscale,
      convenzione: row.convenzione,
    });
    const lastActivity =
      sourceDb === LAST_YEAR_DB
        ? row.date_complete || row.date_inscr || row.lastenter || null
        : row.lastenter || row.date_inscr || null;
    const normalizedRow = {
      id: row.id,
      nome: row.firstname,
      cognome: row.lastname,
      email: row.email,
      courseId: String(row.idCourse),
      courseName: row.courseName || row.courseCode || "—",
      convenzione: row.convenzione || "—",
      codiceFiscale: row.codiceFiscale || "",
      lastActivity,
      statusKey: statusResult.key,
      statusLabel: statusResult.label,
      courseCode: row.courseCode,
      sourceDb,
      matchKey: key,
    };
    const existing = resultsMap.get(key);
    if (!existing || sourceDb === CURRENT_YEAR_DB) {
      resultsMap.set(key, normalizedRow);
    }
    const userRows = userRowsMap.get(key) || [];
    userRows.push({
      idCourse: row.idCourse,
      courseCode: row.courseCode,
      courseName: row.courseName,
      date_inscr: row.date_inscr,
      date_complete: row.date_complete,
      status: row.status,
      lastenter: row.lastenter,
      sourceDb,
    });
    userRowsMap.set(key, userRows);
  };

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
      clauses.push("LOWER(cf_convenzione.user_entry) = ?");
      params.push(convenzione.toString().trim().toLowerCase());
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
          cf_convenzione.user_entry AS convenzione,
          cf_cf.user_entry AS codiceFiscale
        FROM learning_courseuser cu
        JOIN core_user u ON u.idst = cu.idUser
        LEFT JOIN core_field_userentry cf_convenzione ON cf_convenzione.id_user = u.idst AND cf_convenzione.id_common = 25
        LEFT JOIN core_field_userentry cf_cf ON cf_cf.id_user = u.idst AND cf_cf.id_common = 23
        LEFT JOIN learning_course c ON c.idCourse = cu.idCourse
        WHERE ${whereClause}
        ORDER BY cu.date_inscr DESC
        LIMIT ?
      `;

    debugQueries.push({
      db: dbName,
      sql,
      params: [...params, MAX_ROWS_PER_DB],
    });
    logReminderQuery(dbName, sql, [...params, MAX_ROWS_PER_DB]);
    const [rows] = await conn.query(sql, [...params, MAX_ROWS_PER_DB]);
      rows.forEach((row) => recordRow(row, dbName));
  }

  if (conditionGroups.length) {
    const courseTokens = [
      ...new Set(
        conditionGroups.flatMap((condition) =>
          condition.courseCodes.flatMap((token) => expandCourseToken(token)),
        ),
      ),
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
          cf_convenzione.user_entry AS convenzione,
          cf_cf.user_entry AS codiceFiscale
        FROM learning_courseuser cu
        JOIN core_user u ON u.idst = cu.idUser
        LEFT JOIN core_field_userentry cf_convenzione ON cf_convenzione.id_user = u.idst AND cf_convenzione.id_common = 25
        LEFT JOIN core_field_userentry cf_cf ON cf_cf.id_user = u.idst AND cf_cf.id_common = 23
        LEFT JOIN learning_course c ON c.idCourse = cu.idCourse
        WHERE ${whereClause}
        ORDER BY cu.date_inscr DESC
        LIMIT ?
      `;
        debugQueries.push({
          db: LAST_YEAR_DB,
          sql: sqlLastYear,
          params: [...paramsLastYear, MAX_ROWS_PER_DB],
        });
        logReminderQuery(LAST_YEAR_DB, sqlLastYear, [...paramsLastYear, MAX_ROWS_PER_DB]);
      const [rows] = await connLastYear.query(sqlLastYear, [...paramsLastYear, MAX_ROWS_PER_DB]);
        rows.forEach((row) => recordRow(row, LAST_YEAR_DB));
    }
  }

  let results = Array.from(resultsMap.values());
  let filtered = results.filter((user) => matchStatusFilter(status.toString(), user.statusKey));
  const filteredBeforeConditions = filtered;

  if (conditionGroups.length) {
    const enrollmentCache = new Map();
    const filteredWithConditions = [];
    for (const user of filtered) {
      const userRows = userRowsMap.get(user.matchKey) || [];
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

  if (convenzione) {
    const extraEmails = await fetchConvenzioneMailBcc(convenzione);
    extraEmails.forEach((email) => {
      filtered.push({
        id: null,
        nome: "",
        cognome: "",
        email,
        courseId: "",
        courseName: "",
        convenzione,
        lastActivity: null,
        statusKey: "",
        statusLabel: "",
        courseCode: "",
        sourceDb: "wpacquisti",
      });
    });
  }

  const conditionSummaries = conditionGroups.map((condition, index) => {
    const courses = condition.courseCodes.length ? condition.courseCodes.join(", ") : "nessuno";
    const excludes = condition.excludeCourseCodes?.length ? condition.excludeCourseCodes.join(", ") : "nessuno";
    return `Condizione ${index + 1}: ${condition.matchMode === "all" ? "tutti" : "almeno uno"} dei corsi [${courses}], esclusi quest'anno [${excludes}], non iscritti quest'anno: ${condition.notEnrolledThisYear}`;
  });

  let reason = null;
  if (!filtered.length) {
    if (!filteredBeforeConditions.length) {
      reason =
        "Nessuna iscrizione in forma4 soddisfa i filtri impostati (stato, corso, periodo, convenzione).";
    } else if (conditionGroups.length) {
      reason =
        "I corsisti filtrati inizialmente non soddisfano le condizioni specificate (verifica completamenti/scartati, corsi esclusi o iscrizioni nell'anno corrente).";
    } else {
      reason = "I filtri applicati non restituiscono corsisti corrispondenti.";
    }
  }

  const responsePayload = {
    users: filtered,
    total: filtered.length,
  };
  if (reason) {
    responsePayload.debug = {
      reason,
      queries: debugQueries.map((entry) => ({
        db: entry.db,
        sql: entry.sql.trim(),
        params: entry.params,
      })),
      conditions: conditionSummaries,
    };
  }
  return responsePayload;
}

router.get("/users", async (req, res) => {
  try {
    const { period = "tutti", course = "", convenzione, from, to, status = "tutti" } = req.query;
    const conditionGroups = parseConditionGroups(req.query.conditions);
    const payload = await queryReminderUsers({
      period,
      course,
      convenzione,
      from,
      to,
      status,
      conditionGroups,
    });
    return res.json(payload);
  } catch (error) {
    logReminder("ERROR", "/api/reminder/users error", error);
    return res.status(500).json({ error: "Impossibile caricare i corsisti" });
  }
});

router.get("/presets/:key", async (req, res) => {
  const key = (req.params.key || "").toLowerCase();
  const preset = REMINDER_PRESET_GROUPS[key];
  if (!preset) {
    return res.status(400).json({ error: "Preset reminder non valido" });
  }
  try {
    if (key === "ivass") {
      const payload = await queryIvassFromTemp();
      return res.json(payload);
    }
    const payload = await queryReminderUsers({
      conditionGroups: [preset],
      convenzione: preset.convenzione,
    });
    return res.json(payload);
  } catch (error) {
    logReminder("ERROR", `/api/reminder/presets/${key} error`, error);
    return res.status(500).json({ error: "Impossibile eseguire il reminder preset" });
  }
});

router.post("/send", async (req, res) => {
  const { recipients, subject, body: htmlBody, test, filters } = req.body || {};
  if (!subject || !htmlBody) {
    return res.status(400).json({ error: "Oggetto e corpo sono obbligatori" });
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: "Lista destinatari mancante" });
  }

  let extraRecipients = [];
  const convenzione = filters?.convenzione;
  if (convenzione) {
    const extraEmails = await fetchConvenzioneMailBcc(convenzione);
    extraRecipients = extraEmails.map((email) => ({
      id: null,
      nome: "",
      cognome: "",
      email,
      convenzione,
    }));
  }

  const normalized = [];
  const seen = new Set();
  for (const recipient of [...recipients, ...extraRecipients]) {
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
  const { recipients, subject, body: htmlContent, filters } = req.body || {};
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

  let extraRecipients = [];
  const convenzione = filters?.convenzione;
  if (convenzione) {
    const extraEmails = await fetchConvenzioneMailBcc(convenzione);
    extraRecipients = extraEmails.map((email) => ({
      email,
      nome: "",
      cognome: "",
      convenzione,
    }));
  }

  const contactsApi = new Brevo.ContactsApi();
  contactsApi.setApiKey(Brevo.ContactsApiApiKeys.apiKey, brevoKey);
  const emailCampaignsApi = new Brevo.EmailCampaignsApi();
  emailCampaignsApi.setApiKey(Brevo.EmailCampaignsApiApiKeys.apiKey, brevoKey);

  const normalized = [];
  const seen = new Set();
  for (const recipient of [...recipients, ...extraRecipients]) {
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
    logReminder("INFO", "Creazione lista Brevo", {
      folderId: BREVO_CONTACTS_FOLDER_ID,
    });
    const listResponse = await contactsApi.createList(listPayload);
    logReminder("INFO", "Brevo createList response", {
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
        logReminder("INFO", "Brevo createContact response", {
          email: recipient.email,
          status: contactResponse.status,
        });
      } catch (innerErr) {
        logReminder("WARN", "ContactsApi.createContact", innerErr.message);
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
    logReminder("INFO", "Brevo createEmailCampaign response", {
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
    logReminder("INFO", "Brevo sendEmailCampaignNow response", {
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
    logReminder("ERROR", "/api/reminder/brevo error", error);
    return res.status(500).json({ error: error.message || "Errore invio campagna Brevo" });
  } finally {
  }
});

module.exports = router;
