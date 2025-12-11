const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { getConnection, DB_MAP } = require("../dbManager");
const { ConvertToMysqlDateTime } = require("../utils/helper");

const TEST_COURSE_MAP = {
    373: 378,
    407: 408,
    428: 429,
};

const NEAR_DAY_OFFSETS = [1, -1, -4];
    
const AVAILABLE_DBS = Object.keys(DB_MAP || {});

function toInt(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
}

function randomIp() {
    const part = () => Math.floor(Math.random() * 156) + 100;
    const last = Math.floor(Math.random() * 254) + 1;
    return `${part()}.${part()}.${part()}.${last}`;
}

function randomSessionId(seed = "") {
    const base = String(seed || crypto.randomUUID()).replace(/[^a-zA-Z0-9]/g, "");
    const random = crypto.randomBytes(4).toString("hex");
    return `${base}-${random}`.slice(0, 32);
}

function buildExclusionClause(excludeIds = []) {
    if (!excludeIds.length) {
        return { clause: "", params: [] };
    }
    const sanitized = excludeIds.map((val) => Number(val)).filter((val) => Number.isFinite(val));
    if (!sanitized.length) {
        return { clause: "", params: [] };
    }
    const placeholders = sanitized.map(() => "?").join(",");
    return { clause: ` AND iduser NOT IN (${placeholders}) `, params: sanitized };
}

function normalizeDateFilter(value, endOfDay = false) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return null;
    if (endOfDay) {
        date.setHours(23, 59, 59, 999);
    } else {
        date.setHours(0, 0, 0, 0);
    }
    return ConvertToMysqlDateTime(date);
}

function buildDonorDateClause(filters = {}) {
    const parts = [];
    const params = [];

    if (filters.inscrFrom) {
        parts.push("AND date_inscr >= ?");
        params.push(filters.inscrFrom);
    }
    if (filters.inscrTo) {
        parts.push("AND date_inscr <= ?");
        params.push(filters.inscrTo);
    }
    if (filters.completeFrom) {
        parts.push("AND date_complete >= ?");
        params.push(filters.completeFrom);
    }
    if (filters.completeTo) {
        parts.push("AND date_complete <= ?");
        params.push(filters.completeTo);
    }

    return {
        clause: parts.length ? ` ${parts.join(" ")}` : "",
        params,
    };
}

function sanitizeString(value) {
    if (!value) return "";
    return value.toString().toLowerCase().trim();
}

function parseYmdDate(value) {
    if (!value) return null;
    const sanitized = value.toString().trim();
    const matches = sanitized.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!matches) {
        return null;
    }
    const year = Number(matches[1]);
    const month = Number(matches[2]) - 1;
    const day = Number(matches[3]);
    const date = new Date(year, month, day);
    return Number.isNaN(date.valueOf()) ? null : date;
}

function buildSameDayRange(value) {
    const parsed = parseYmdDate(value);
    if (!parsed) {
        return null;
    }
    const start = new Date(parsed);
    start.setHours(0, 0, 0, 0);
    const end = new Date(parsed);
    end.setHours(23, 59, 59, 999);
    return {
        from: ConvertToMysqlDateTime(start),
        to: ConvertToMysqlDateTime(end),
    };
}

function getCourseExclusivityClause(courseId, allowCrossCourseMasters) {
    if (allowCrossCourseMasters) {
        return { clause: "", params: [] };
    }
    switch (courseId) {
        case 303:
            return {
                clause: `
                  AND iduser NOT IN (
                      SELECT iduser
                      FROM learning_courseuser
                      WHERE idcourse != 303
                        AND idcourse != 221
                  )
                `,
                params: [],
            };
        case 412:
            return {
                clause: `
                  AND iduser NOT IN (
                      SELECT iduser
                      FROM learning_courseuser
                      WHERE idcourse != 412
                        AND idcourse != 221
                  )
                `,
                params: [],
            };
        default:
            return {
                clause: `
                  AND iduser NOT IN (
                      SELECT iduser
                      FROM learning_courseuser
                      WHERE idcourse != ?
                  )
                `,
                params: [courseId],
            };
    }
}

function buildOffsetDateFilters(baseValue, offsetDays) {
    const parsed = parseYmdDate(baseValue);
    if (!parsed) {
        return null;
    }
    parsed.setDate(parsed.getDate() + offsetDays);
    const start = new Date(parsed);
    start.setHours(0, 0, 0, 0);
    const end = new Date(parsed);
    end.setHours(23, 59, 59, 999);
    return {
        inscrFrom: ConvertToMysqlDateTime(start),
        inscrTo: ConvertToMysqlDateTime(end),
    };
}

async function findCoreUserId(conn, info = {}) {
    const { email, firstname, lastname } = info;
    const normalizedEmail = sanitizeString(email);
    if (normalizedEmail) {
        const [rows] = await conn.query(
            "SELECT idst FROM core_user WHERE LOWER(email) = ? LIMIT 1",
            [normalizedEmail]
        );
        if (rows && rows.length) {
            return rows[0].idst;
        }
    }

    const normalizedFirstname = sanitizeString(firstname);
    const normalizedLastname = sanitizeString(lastname);
    if (normalizedFirstname && normalizedLastname) {
        const [rows] = await conn.query(
            `SELECT idst
             FROM core_user
             WHERE LOWER(firstname) = ?
               AND LOWER(lastname) = ?
             ORDER BY register_date DESC
             LIMIT 1`,
            [normalizedFirstname, normalizedLastname]
        );
        if (rows && rows.length) {
            return rows[0].idst;
        }
    }

    return null;
}

async function resolveUsers(conn, users) {
    const resolved = [];
    for (const user of users) {
        const rawFirstname = user.firstname?.trim() ?? "";
        const rawLastname = user.lastname?.trim() ?? "";
        const rawEmail = user.email?.trim() ?? "";
        let id = null;
        try {
            id = await findCoreUserId(conn, {
                firstname: rawFirstname,
                lastname: rawLastname,
                email: rawEmail,
            });
        } catch (err) {
            console.warn("Impossibile risolvere utente:", err.message || err);
        }
        resolved.push({
            id,
            firstname: rawFirstname,
            lastname: rawLastname,
            email: rawEmail,
            note: id ? "" : "Utente non trovato",
        });
    }
    return resolved;
}

async function countDonorCandidates(conn, courseId, filters = {}, excluded = [], allowCrossCourseMasters = false) {
    const { clause, params } = buildExclusionClause(excluded);
    const { clause: dateClause, params: dateParams } = buildDonorDateClause(filters);
    const courseClause = getCourseExclusivityClause(courseId, allowCrossCourseMasters);
    let sql = "";
    let queryParams = [...params, ...courseClause.params, ...dateParams];

    switch (courseId) {
        case 303:
            sql = `
                SELECT COUNT(DISTINCT iduser) AS total
                FROM learning_courseuser
                WHERE date_inscr > '2020-02-21 00:00:00'
                  AND date_inscr < '2020-02-27 00:00:00'
                  AND status = 2
                  ${clause}
                  ${courseClause.clause}
                  ${dateClause}
            `;
            break;
        case 412:
            sql = `
                SELECT COUNT(DISTINCT iduser) AS total
                FROM learning_courseuser
                WHERE date_inscr >= '2023-09-01 00:00:00'
                  AND status = 2
                  ${clause}
                  ${courseClause.clause}
                  ${dateClause}
            `;
            break;
        case 373:
            sql = `
                SELECT COUNT(DISTINCT iduser) AS total
                FROM learning_courseuser
                WHERE status = 2
                  AND iduser IN (85645)
                  AND idcourse IN (373,378)
                  ${dateClause}
            `;
            break;
        case 407:
            sql = `
                SELECT COUNT(DISTINCT iduser) AS total
                FROM learning_courseuser
                WHERE date_inscr > '2024-01-01 00:00:00'
                  AND status >= 2
                  AND iduser != 1039
                  ${clause}
                  AND idcourse IN (407)
                  ${dateClause}
            `;
            break;
        case 428:
            sql = `
                SELECT COUNT(DISTINCT iduser) AS total
                FROM learning_courseuser
                WHERE date_inscr > '2023-10-01 00:00:00'
                  AND status >= 2
                  AND iduser != 1039
                  ${clause}
                  AND idcourse IN (428,429)
                  ${dateClause}
            `;
            break;
        case 18:
            sql = `
                SELECT COUNT(DISTINCT iduser) AS total
                FROM learning_courseuser
                WHERE idcourse = 18
                  AND status = 2
                  ${clause}
                  ${courseClause.clause}
                  ${dateClause}
            `;
            break;
        default:
            sql = `
                SELECT COUNT(DISTINCT iduser) AS total
                FROM learning_courseuser
                WHERE date_complete <= '2023-12-25 00:00:00'
                  AND date_inscr >= '2023-01-01 00:00:00'
                  AND idcourse = ?
                  ${clause}
                  ${courseClause.clause}
                  ${dateClause}
                  AND status = 2
            `;
            queryParams = [...queryParams, courseId];
            break;
    }

    if (!sql) return 0;

    const [rows] = await conn.query(sql, queryParams);
    return Number(rows?.[0]?.total ?? 0);
}
router.get("/courses", async (req, res) => {
    const dbName = (req.query.db || "formazionein").toString();
    if (!AVAILABLE_DBS.includes(dbName)) {
        return res.status(400).json({ success: false, error: "Database non valido" });
    }

    try {
        const conn = await getConnection(dbName);
        const [rows] = await conn.query(
            `SELECT idCourse AS idcourse, code, name
             FROM learning_course
             ORDER BY code ASC`
        );

        const payload = (rows || []).map((row) => ({
            idcourse: row.idcourse ?? row.idCourse,
            code: row.code,
            name: row.name,
        }));

        return res.json({ success: true, data: payload });
    } catch (error) {
        console.error("Errore fetch corsi simulazione", error);
        return res.status(500).json({ success: false, error: "Errore recupero corsi" });
    }
});

function ensureCourseId(courseId) {
    const numeric = toInt(courseId);
    if (numeric === null) {
        throw new Error("courseId non valido");
    }
    return numeric;
}

async function describeDonor(conn, donorId, courseId) {
    if (!donorId || !courseId) return null;
    const [rows] = await conn.query(
        `SELECT lcu.iduser,
                lcu.status,
                DATE_FORMAT(lcu.date_inscr, '%Y-%m-%d %H:%i:%s') AS date_inscr,
                DATE_FORMAT(lcu.date_complete, '%Y-%m-%d %H:%i:%s') AS date_complete,
                c.code AS course_code,
                c.name AS course_name,
                cu.userid,
                cu.firstname,
                cu.lastname
         FROM learning_courseuser lcu
         JOIN learning_course c ON c.idCourse = lcu.idCourse
         LEFT JOIN core_user cu ON cu.idst = lcu.iduser
         WHERE lcu.iduser = ?
           AND lcu.idCourse = ?
         ORDER BY lcu.date_inscr DESC
         LIMIT 1`,
        [donorId, courseId]
    );
    if (!rows || !rows.length) return null;
    const row = rows[0];
    return {
        iduser: row.iduser,
        status: row.status,
        date_inscr: row.date_inscr,
        date_complete: row.date_complete,
        course_code: row.course_code,
        course_name: row.course_name,
        userid: row.userid ?? null,
        firstname: row.firstname ?? null,
        lastname: row.lastname ?? null,
    };
}

async function pickDonor({ sourceConn, courseId, excluded, filters = {} }) {
    const { clause, params } = buildExclusionClause(excluded);
    const { clause: dateClause, params: dateParams } = buildDonorDateClause(filters);
    let sql = "";
    let queryParams = [...params, ...dateParams];

    switch (courseId) {
        case 303:
            sql = `
                SELECT iduser
                FROM learning_courseuser
                WHERE date_inscr > '2020-02-21 00:00:00'
                  AND date_inscr < '2020-02-27 00:00:00'
                  AND status = 2
                  ${clause}
                  AND iduser NOT IN (
                      SELECT iduser
                      FROM learning_courseuser
                      WHERE idcourse != 303
                        AND idcourse != 221
                  )
                  ${dateClause}
                ORDER BY RAND()
                LIMIT 1
            `;
            break;
        case 412:
            sql = `
                SELECT iduser
                FROM learning_courseuser
                WHERE date_inscr >= '2023-09-01 00:00:00'
                  AND status = 2
                  ${clause}
                  AND iduser NOT IN (
                      SELECT iduser
                      FROM learning_courseuser
                      WHERE idcourse != 412
                        AND idcourse != 221
                  )
                  ${dateClause}
                ORDER BY RAND()
                LIMIT 1
            `;
            break;
        case 373:
            sql = `
                SELECT iduser
                FROM learning_courseuser
                WHERE status = 2
                  AND iduser IN (85645)
                  AND idcourse IN (373,378)
                  ${dateClause}
                ORDER BY RAND()
                LIMIT 1
            `;
            break;
        case 407:
            sql = `
                SELECT iduser
                FROM learning_courseuser
                WHERE date_inscr > '2024-01-01 00:00:00'
                  AND status >= 2
                      AND iduser != 1039
                      ${clause}
                      AND idcourse IN (407)
                      ${dateClause}
                    ORDER BY RAND()
                    LIMIT 1
                `;
                break;
        case 428:
            sql = `
                SELECT iduser
                FROM learning_courseuser
                WHERE date_inscr > '2023-10-01 00:00:00'
                  AND status >= 2
                      AND iduser != 1039
                      ${clause}
                      AND idcourse IN (428,429)
                      ${dateClause}
                    ORDER BY RAND()
                    LIMIT 1
                `;
                break;
        case 18:
            sql = `
                SELECT iduser
                FROM learning_courseuser
                WHERE idcourse = 18
                  AND status = 2
                  ${dateClause}
                ORDER BY RAND()
                LIMIT 1
            `;
            break;
        default:
            sql = `
                SELECT iduser
                FROM learning_courseuser
                WHERE date_complete <= '2023-12-25 00:00:00'
                  AND date_inscr >= '2023-01-01 00:00:00'
                  AND idcourse = ?
                  ${clause}
                  AND iduser NOT IN (
                      SELECT iduser
                      FROM learning_courseuser
                      WHERE idcourse != ?
                  )
                  ${dateClause}
                  AND status = 2
                ORDER BY RAND()
                LIMIT 1
            `;
            queryParams = [...queryParams, courseId, courseId];
            break;
    }

    if (!sql) {
        return null;
    }

    const [rows] = await sourceConn.query(sql, queryParams);
    if (!rows || !rows.length) {
        return null;
    }

    const donorId = rows[0].iduser ?? rows[0].idUser;
    if (!donorId) {
        return null;
    }

    const testCourse = TEST_COURSE_MAP[courseId] ?? null;
    return {
        donorId,
        testCourse,
    };
}

async function fetchTargetUser(targetConn, idst) {
    const [rows] = await targetConn.query(
        "SELECT firstname, lastname FROM core_user WHERE idst = ? LIMIT 1",
        [idst]
    );
    return rows[0] || null;
}

async function fetchCourseData(sourceConn, donorId, courseId) {
    const safety = (text) => text || "";
    const trackingGeneralQuery = "SELECT * FROM learning_trackingeneral WHERE idCourse = ? AND iduser = ? ORDER BY idTrack ASC";
    const [trackingRows] = await sourceConn.query(trackingGeneralQuery, [courseId, donorId]);
    const [sessionRows] = await sourceConn.query(
        "SELECT * FROM learning_tracksession WHERE idCourse = ? AND iduser = ? ORDER BY identer ASC",
        [courseId, donorId]
    );
    const [scormItemsRows] = await sourceConn.query(
        `SELECT learning_scorm_items_track.*, learning_organization.idCourse AS org_course
         FROM learning_scorm_items_track
         JOIN learning_organization ON learning_organization.idOrg = learning_scorm_items_track.idreference
         WHERE learning_organization.idCourse = ?
           AND learning_scorm_items_track.iduser = ?
         ORDER BY learning_scorm_items_track.idscorm_tracking ASC`,
        [courseId, donorId]
    );
    const [materialsRows] = await sourceConn.query(
        `SELECT learning_materials_track.*, learning_organization.idCourse AS org_course
         FROM learning_materials_track
         JOIN learning_organization ON learning_organization.idOrg = learning_materials_track.idreference
         WHERE learning_organization.idCourse = ?
           AND learning_materials_track.iduser = ?`,
        [courseId, donorId]
    );
    const [scormTrackingRows] = await sourceConn.query(
        `SELECT learning_scorm_tracking.*
         FROM learning_scorm_tracking
         JOIN learning_organization ON learning_organization.idOrg = learning_scorm_tracking.idreference
         WHERE learning_organization.idCourse = ?
           AND learning_scorm_tracking.iduser = ?
         ORDER BY learning_scorm_tracking.idscorm_tracking ASC`,
        [courseId, donorId]
    );

    const testTrackWhere =
        courseId === 373
            ? "(373,378)"
            : courseId === 407
            ? "(407,408)"
            : courseId === 428
            ? "(428,429)"
            : `(${courseId})`;
    const [testTrackRows] = await sourceConn.query(
        `SELECT a.*
         FROM learning_testtrack a
         JOIN learning_organization b ON b.idResource = a.idtest
         WHERE objecttype = 'test'
           AND idCourse IN ${testTrackWhere}
           AND a.iduser = ?
         ORDER BY path ASC`,
        [donorId]
    );

    const [testTrackAnswerRows] = await sourceConn.query(
        `SELECT a.*
         FROM learning_testtrack_answer a
         JOIN learning_testtrack b ON b.idtrack = a.idtrack
         WHERE b.iduser = ?
         ORDER BY b.idtrack ASC`,
        [donorId]
    );

    const [pollTrackRows] = await sourceConn.query(
        `SELECT a.*
         FROM learning_polltrack a
         JOIN learning_organization b ON b.idResource = a.id_poll
         WHERE objecttype = 'poll'
           AND b.idCourse = ?
           AND a.id_user = ?
         ORDER BY path ASC`,
        [courseId, donorId]
    );

    const [commonTrackRows] = await sourceConn.query(
        `SELECT learning_commontrack.*
         FROM learning_commontrack
         JOIN learning_organization ON learning_organization.idOrg = learning_commontrack.idreference
         WHERE learning_organization.idCourse = ?
           AND learning_commontrack.iduser = ?
         ORDER BY idtrack ASC`,
        [courseId, donorId]
    );

    return {
        trackingRows,
        sessionRows,
        scormItemsRows,
        materialsRows,
        scormTrackingRows,
        testTrackRows,
        testTrackAnswerRows,
        pollTrackRows,
        commonTrackRows,
    };
}

async function copyCourseData({
    sourceConn,
    targetConn,
    donorId,
    courseId,
    targetUserId,
    targetDisplayName,
    log,
}) {
    log.push(`Copio dati corso ${courseId} per utente ${targetUserId}`);
    const data = await fetchCourseData(sourceConn, donorId, courseId);
    const ipAddress = randomIp();

    const insertedScormTracking = [];
    const insertedScormItems = [];
    const insertedMaterials = [];
    const insertedTestTracks = [];
    const insertedPollTracks = [];

    const trackingRows = data.trackingRows || [];
    const sessionRows = data.sessionRows || [];

    let tempNumOp = 0;

    for (const session of sessionRows) {
        const sessionId = randomSessionId(session.session_id);
        const numOp = Number(session.numop) || trackingRows.length - 1;
        const [sessionResult] = await targetConn.query(
            `INSERT INTO learning_tracksession
             (idCourse, idUser, session_id, enterTime, numOp, lastFunction, lastOp, lastTime, ip_address, active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [
                courseId,
                targetUserId,
                sessionId,
                ConvertToMysqlDateTime(session.entertime),
                numOp,
                session.lastfunction ?? "",
                session.lastop ?? "",
                ConvertToMysqlDateTime(session.lasttime),
                ipAddress,
            ]
        );
        const idEnter = sessionResult.insertId;

        const rangeStart = Math.min(tempNumOp, trackingRows.length);
        const rangeEnd = Math.min(Math.max(rangeStart, numOp), trackingRows.length - 1);

        for (let idx = rangeStart; idx <= rangeEnd; idx++) {
            const row = trackingRows[idx];
            if (!row) continue;
            await targetConn.query(
                `INSERT INTO learning_trackingeneral
                 (idEnter, idUser, idCourse, session_id, function, type, timeof, ip)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    idEnter,
                    targetUserId,
                    courseId,
                    sessionId,
                    row.function ?? "",
                    row.type ?? "",
                    ConvertToMysqlDateTime(row.timeof),
                    ipAddress,
                ]
            );
        }
        tempNumOp = rangeEnd + 1;
    }

    for (const row of data.scormTrackingRows || []) {
        const [result] = await targetConn.query(
            `INSERT INTO learning_scorm_tracking
             (idUser, idReference, idscorm_item, user_name, credit, lesson_status, lesson_location, total_time, session_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                targetUserId,
                row.idReference,
                row.idscorm_item,
                targetDisplayName,
                "no-credit",
                "completed",
                row.lesson_location ?? "",
                row.total_time ?? "",
                row.session_time ?? "",
            ]
        );
        insertedScormTracking.push({
            idscorm_tracking: result.insertId,
            idReference: row.idReference,
        });
    }

    for (let idx = 0; idx < (data.scormItemsRows || []).length; idx++) {
        const item = data.scormItemsRows[idx];
        const trackingId =
            insertedScormTracking[idx]?.idscorm_tracking ??
            insertedScormTracking[0]?.idscorm_tracking ??
            null;
        const [matResult] = await targetConn.query(
            `INSERT INTO learning_scorm_items_track
             (idscorm_organization, idscorm_item, idReference, idUser, idscorm_tracking, status, nChild, nChildCompleted, nDescendant, nDescendantCompleted)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                item.idscorm_organization,
                item.idscorm_item,
                item.idReference,
                targetUserId,
                trackingId,
                item.status ?? "",
                item.nChild ?? 0,
                item.nChildCompleted ?? 0,
                item.nDescendant ?? 0,
                item.nDescendantCompleted ?? 0,
            ]
        );
        insertedScormItems.push({
            idreference: item.idReference,
            idscorm_item_track: matResult.insertId,
        });
    }

    for (const row of data.materialsRows || []) {
        const [result] = await targetConn.query(
            `INSERT INTO learning_materials_track (idResource, idReference, idUser)
             VALUES (?, ?, ?)`,
            [row.idResource, row.idReference, targetUserId]
        );
        insertedMaterials.push({
            idreference: row.idReference,
            idtrack: result.insertId,
        });
    }

    for (const row of data.testTrackRows || []) {
        const [result] = await targetConn.query(
            `INSERT INTO learning_testtrack
             (idUser, idReference, idTest, date_attempt, date_end_attempt, last_page_seen, last_page_saved, number_of_save, number_of_attempt, score, bonus_score, score_status, comment, attempts_for_suspension)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                targetUserId,
                row.idReference,
                row.idTest,
                ConvertToMysqlDateTime(row.date_attempt),
                ConvertToMysqlDateTime(row.date_end_attempt),
                row.last_page_seen ?? "",
                row.last_page_saved ?? "",
                row.number_of_save ?? 0,
                row.number_of_attempt ?? 0,
                row.score ?? 0,
                row.bonus_score ?? 0,
                row.score_status ?? "",
                row.comment ?? "",
                row.attempts_for_suspension ?? 0,
            ]
        );
        insertedTestTracks.push({
            idtrack: result.insertId,
            idreference: row.idReference,
            idtest: row.idTest,
        });
    }

    for (const inserted of insertedTestTracks) {
        const [listIdRows] = await targetConn.query(
            "SELECT GROUP_CONCAT(idquest) AS listidquest FROM learning_testquest WHERE idtest = ?",
            [inserted.idtest]
        );
        const rawList = listIdRows?.[0]?.listidquest;
        const allowedIds = rawList
            ? rawList
                  .split(",")
                  .map((val) => Number(val))
                  .filter((val) => Number.isFinite(val))
            : [];

        const answers = (data.testTrackAnswerRows || []).filter((answer) =>
            allowedIds.length ? allowedIds.includes(Number(answer.idquest)) : true
        );

        for (const answer of answers) {
            await targetConn.query(
                `INSERT INTO learning_testtrack_answer
                 (idTrack, idQuest, idAnswer, score_assigned, more_info, manual_assigned, user_answer)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    inserted.idtrack,
                    answer.idquest,
                    answer.idanswer,
                    answer.score_assigned ?? 0,
                    "",
                    0,
                    1,
                ]
            );
        }
    }

    for (const row of data.pollTrackRows || []) {
        const [result] = await targetConn.query(
            `INSERT INTO learning_polltrack
             (id_user, id_reference, id_poll, date_attempt, status)
             VALUES (?, ?, ?, ?, ?)`,
            [
                targetUserId,
                row.id_reference,
                row.id_poll,
                ConvertToMysqlDateTime(row.date_attempt),
                row.status ?? "valid",
            ]
        );
        insertedPollTracks.push({
            id_track: result.insertId,
            id_reference: row.id_reference,
        });
    }

    for (const row of data.commonTrackRows || []) {
        let newIdTrack = null;

        switch ((row.objecttype || "").toLowerCase()) {
            case "test": {
                const match = insertedTestTracks.find(
                    (track) => track.idreference === row.idreference
                );
                newIdTrack = match?.idtrack ?? null;
                break;
            }
            case "poll": {
                const match = insertedPollTracks.find(
                    (poll) => poll.id_reference === row.idreference
                );
                newIdTrack = match?.id_track ?? null;
                break;
            }
            case "faq": {
                const [nextRows] = await targetConn.query(
                    "SELECT IFNULL(MAX(idtrack), 0) + 1 AS nextId FROM learning_commontrack"
                );
                newIdTrack = nextRows?.[0]?.nextId ?? 1;
                break;
            }
            case "scormorg": {
                const match = insertedScormItems.find(
                    (item) => item.idreference === row.idreference
                );
                newIdTrack = match?.idscorm_item_track ?? null;
                break;
            }
            case "item": {
                const match = insertedMaterials.find(
                    (item) => item.idreference === row.idreference
                );
                newIdTrack = match?.idtrack ?? null;
                break;
            }
            default: {
                const [nextRows] = await targetConn.query(
                    "SELECT IFNULL(MAX(idtrack), 0) + 1 AS nextId FROM learning_commontrack"
                );
                newIdTrack = nextRows?.[0]?.nextId ?? 1;
                break;
            }
        }

        if (!newIdTrack) {
            const [nextRows] = await targetConn.query(
                "SELECT IFNULL(MAX(idtrack), 0) + 1 AS nextId FROM learning_commontrack"
            );
            newIdTrack = nextRows?.[0]?.nextId ?? 1;
        }

        await targetConn.query(
            `INSERT INTO learning_commontrack
             (idReference, idUser, idTrack, objectType, firstAttempt, first_complete, last_complete, dateAttempt, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                row.idReference,
                targetUserId,
                newIdTrack,
                row.objecttype ?? "",
                ConvertToMysqlDateTime(row.firstattempt) ?? "0000-00-00 00:00:00",
                ConvertToMysqlDateTime(row.first_complete) ?? "0000-00-00 00:00:00",
                ConvertToMysqlDateTime(row.last_complete) ?? "0000-00-00 00:00:00",
                ConvertToMysqlDateTime(row.dateAttempt) ?? "0000-00-00 00:00:00",
                row.status ?? "",
            ]
        );
    }

    log.push(`Inseriti ${insertedTestTracks.length} test track, ${insertedPollTracks.length} poll track, ${insertedScormItems.length} elementi SCORM`);
}

router.post("/check", async (req, res) => {
    try {
        const {
            database,
            courseId,
            userIds = [],
            users = [],
            donorInscrFrom,
            donorInscrTo,
            donorCompleteFrom,
            donorCompleteTo,
        } = req.body;
        if (!database || !courseId) {
            return res.status(400).json({ success: false, error: "Parametri mancanti" });
        }

        const hasInput = (Array.isArray(userIds) && userIds.length) || (Array.isArray(users) && users.length);
        if (!hasInput) {
            return res.json({ success: true, data: [] });
        }

        if (!AVAILABLE_DBS.includes(database)) {
            return res.status(400).json({ success: false, error: "Database non disponibile" });
        }

        const conn = await getConnection(database);
        const courseNumeric = ensureCourseId(courseId);

        const resolvedUsers = Array.isArray(users) && users.length
            ? await resolveUsers(conn, users)
            : [];
        const numericUserEntries = (Array.isArray(userIds) ? userIds : [])
            .map((val) => Number(val))
            .filter((val) => Number.isFinite(val));

        const entries = resolvedUsers.length
            ? resolvedUsers
            : numericUserEntries.map((id) => ({ id, note: "" }));

        const targetIds = entries.map((entry) => entry.id).filter((id) => id);

        const donorFilters = {
            inscrFrom: normalizeDateFilter(donorInscrFrom),
            inscrTo: normalizeDateFilter(donorInscrTo, true),
            completeFrom: normalizeDateFilter(donorCompleteFrom),
            completeTo: normalizeDateFilter(donorCompleteTo, true),
        };
        const availableDonors = await countDonorCandidates(conn, courseNumeric, donorFilters);

        let rows = [];
        if (targetIds.length) {
            const placeholders = targetIds.map(() => "?").join(",");
            const [result] = await conn.query(
                `SELECT lcu.iduser, lcu.status,
                        DATE_FORMAT(lcu.date_first_access, '%Y-%m-%d %H:%i:%s') AS date_first_access,
                        DATE_FORMAT(lcu.date_inscr, '%Y-%m-%d %H:%i:%s') AS date_inscr,
                        DATE_FORMAT(lcu.date_complete, '%Y-%m-%d %H:%i:%s') AS date_complete,
                        c.code AS course_code,
                        c.name AS course_name,
                        cu.userid,
                        cu.firstname,
                        cu.lastname
                 FROM learning_courseuser lcu
                 JOIN learning_course c ON c.idCourse = lcu.idCourse
                 LEFT JOIN core_user cu ON cu.idst = lcu.iduser
                 WHERE lcu.idCourse = ?
                   AND lcu.iduser IN (${placeholders})`,
                [courseNumeric, ...targetIds]
            );
            rows = result;
        }

        let otherRows = [];
        if (targetIds.length) {
            const placeholders = targetIds.map(() => "?").join(",");
            const [resultOther] = await conn.query(
                `SELECT iduser, idcourse, status, DATE_FORMAT(date_inscr, '%Y-%m-%d %H:%i:%s') AS date_inscr
                 FROM learning_courseuser
                 WHERE iduser IN (${placeholders})
                   AND idcourse != ?`,
                [...targetIds, courseNumeric]
            );
            otherRows = resultOther;
        }

        const mapped = [];
        const excludedDonors = new Set();
        for (const entry of entries) {
            const id = entry.id ?? null;
            const match = id ? rows.find((row) => Number(row.iduser) === Number(id)) : null;
            const existing = otherRows
                .filter((row) => Number(row.iduser) === Number(id))
                .map((row) => `${row.idcourse} (${row.status})`)
                .join(", ");
            const baseNote = entry.note || "";
            const noteParts = [];
            if (baseNote) noteParts.push(baseNote);
            if (existing) noteParts.push(`Già iscritto ad altri corsi: ${existing}`);

            let master = null;
            const userStatus = match?.status !== undefined ? Number(match.status) : null;
            const shouldSearchMaster = Boolean(match && userStatus === 0 && match.date_inscr);
            if (shouldSearchMaster) {
                const masterFilters = {};
                const masterInscrRange = buildSameDayRange(match.date_inscr);
                if (masterInscrRange?.from) {
                    masterFilters.inscrFrom = masterInscrRange.from;
                }
                if (masterInscrRange?.to) {
                    masterFilters.inscrTo = masterInscrRange.to;
                }
                if (match.date_complete) {
                    const masterCompleteRange = buildSameDayRange(match.date_complete);
                    if (masterCompleteRange?.from) {
                        masterFilters.completeFrom = masterCompleteRange.from;
                    }
                    if (masterCompleteRange?.to) {
                        masterFilters.completeTo = masterCompleteRange.to;
                    }
                }
                const filtersForMaster =
                    Object.keys(masterFilters).length > 0 ? masterFilters : donorFilters;
                try {
                    const donor = await pickDonor({
                        sourceConn: conn,
                        courseId: courseNumeric,
                        excluded: Array.from(excludedDonors),
                        filters: filtersForMaster,
                    });
                    if (donor?.donorId) {
                        excludedDonors.add(donor.donorId);
                        const masterInfo = await describeDonor(conn, donor.donorId, courseNumeric);
                        master = masterInfo;
                    }
                } catch (err) {
                    console.warn("Impossibile trovare master per il report:", err.message || err);
                }
                if (!master) {
                    noteParts.push("Master non disponibile per la data richiesta");
                }
            }

            const nearCandidates = [];
            if (!master && match?.date_inscr) {
                for (const offset of NEAR_DAY_OFFSETS) {
                    const offsetFilters = buildOffsetDateFilters(match.date_inscr, offset);
                    if (!offsetFilters) continue;
                    try {
                        const donor = await pickDonor({
                            sourceConn: conn,
                            courseId: courseNumeric,
                            excluded: [],
                            filters: offsetFilters,
                        });
                        if (donor?.donorId) {
                            const candidateInfo = await describeDonor(conn, donor.donorId, courseNumeric);
                            nearCandidates.push({
                                offset,
                                master: candidateInfo,
                            });
                        }
                    } catch (err) {
                        console.warn("Impossibile trovare candidati vicini:", err.message || err);
                    }
                }
            }

            mapped.push({
                id,
                firstname: entry.firstname || null,
                lastname: entry.lastname || null,
                email: entry.email || null,
                registered: Boolean(match),
                started: Boolean(match && match.date_first_access),
                status: userStatus,
                date_inscr: match?.date_inscr ?? null,
                date_complete: match?.date_complete ?? null,
                userid: match?.userid ?? null,
                note: noteParts.join(" | ") || "—",
                course_code: match?.course_code ?? null,
                course_name: match?.course_name ?? null,
                master,
                nearCandidates,
                hasMaster: Boolean(master && master.iduser),
            });
        }

        return res.json({ success: true, data: mapped, availableDonors });
    } catch (err) {
        console.error("Errore simulazione check", err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/run", async (req, res) => {
    try {
        const {
            database,
            fromDatabase,
            toDatabase,
            courseId,
            userIds = [],
            diff = false,
            donorInscrFrom,
            donorInscrTo,
            donorCompleteFrom,
            donorCompleteTo,
        } = req.body;
        const selectedDb = database || fromDatabase || toDatabase;

        if (!selectedDb || !courseId || !Array.isArray(userIds) || !userIds.length) {
            return res.status(400).json({ success: false, error: "Parametri mancanti" });
        }

        if (!AVAILABLE_DBS.includes(selectedDb)) {
            return res.status(400).json({ success: false, error: "Database non disponibile" });
        }

        const sourceConn = await getConnection(selectedDb);
        const targetPool = await getConnection(selectedDb);
        const sanitizedCourseId = ensureCourseId(courseId);
        const donorFilters = {
            inscrFrom: normalizeDateFilter(donorInscrFrom),
            inscrTo: normalizeDateFilter(donorInscrTo, true),
            completeFrom: normalizeDateFilter(donorCompleteFrom),
            completeTo: normalizeDateFilter(donorCompleteTo, true),
        };
        const results = [];
        const excludedDonors = new Set();

        for (const rawId of userIds) {
            const targetUserId = Number(rawId);
            if (!targetUserId) continue;
            const log = [];
            const targetConn = await targetPool.getConnection();
            let targetUser = null;
            try {
                targetUser = await fetchTargetUser(targetConn, targetUserId);
                if (!targetUser) {
                    log.push("Utente target non trovato");
                    results.push({ targetUserId, success: false, log });
                    continue;
                }

                const donor = await pickDonor({
                    sourceConn,
                    courseId: sanitizedCourseId,
                    excluded: Array.from(excludedDonors),
                    filters: donorFilters,
                });
                if (!donor?.donorId) {
                    log.push("Nessun utente di riferimento disponibile");
                    results.push({ targetUserId, success: false, log });
                    continue;
                }

                excludedDonors.add(donor.donorId);
                excludedDonors.add(targetUserId);

                await targetConn.beginTransaction();
                await copyCourseData({
                    sourceConn,
                    targetConn,
                    donorId: donor.donorId,
                    courseId: sanitizedCourseId,
                    targetUserId,
                    targetDisplayName: `${targetUser.firstname} ${targetUser.lastname}`,
                    log,
                });

                if (donor.testCourse) {
                    await copyCourseData({
                        sourceConn,
                        targetConn,
                        donorId: donor.donorId,
                        courseId: donor.testCourse,
                        targetUserId,
                        targetDisplayName: `${targetUser.firstname} ${targetUser.lastname}`,
                        log,
                    });
                }

                await targetConn.commit();
                results.push({ targetUserId, success: true, log });
            } catch (err) {
                await targetConn.rollback().catch(() => {});
                console.error("Errore simulazione utente", targetUserId, err);
                log.push(err.message);
                results.push({ targetUserId, success: false, log });
            } finally {
                targetConn.release();
            }
        }

        return res.json({ success: true, data: results, diff });
    } catch (err) {
        console.error("Errore simulazione", err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
