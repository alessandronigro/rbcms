const express = require("express");
const dayjs = require("dayjs");
const fs = require("fs");
const path = require("path");
const router = express.Router();

const { getConnection } = require("../dbManager");
const {
    toMySQLDateTime,
    getMailFormat,
    getBCC,
    piedinodidattica,
    piedinorbacademy
} = require("../utils/helper");
const { invioMail } = require("../utils/mailerBrevo");

const CALENDAR_CONTEXT = {
    "60h": {
        key: "60h",
        sessionDb: "rb60h",
        learningDb: process.env.MYSQL_FORMA4,
        label: "Calendario 60h"
    },
    amm: {
        key: "amm",
        sessionDb: "rbamministratore",
        learningDb: process.env.MYSQL_formazionecondorb,
        label: "Calendario AMM"
    }
};

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const DEFAULT_DAY_WINDOWS = {
    monday: [{ start: "09:00", end: "13:00" }, { start: "14:00", end: "18:00" }],
    tuesday: [{ start: "09:00", end: "13:00" }, { start: "14:00", end: "18:00" }],
    wednesday: [{ start: "09:00", end: "13:00" }, { start: "14:00", end: "18:00" }],
    thursday: [{ start: "09:00", end: "13:00" }, { start: "14:00", end: "18:00" }],
    friday: [{ start: "09:00", end: "13:00" }, { start: "14:00", end: "18:00" }],
    saturday: [],
    sunday: []
};

const DEFAULT_SETTINGS = {
    slotMinutes: 60,
    weeksAhead: 2,
    days: deepClone(DEFAULT_DAY_WINDOWS),
    closedDays: []
};

const HOST_PATTERNS = {
    fi: ["formazioneintermediari.com"],
    rb: ["rb-academy.it"]
};

let settingsTableReady = false;
const anagraficaSchemaCache = {};

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function parseJSON(value, fallback) {
    try {
        if (!value) return deepClone(fallback);
        const parsed = JSON.parse(value);
        if (typeof parsed !== "object" || parsed === null) return deepClone(fallback);
        return parsed;
    } catch {
        return deepClone(fallback);
    }
}

async function ensureSettingsTable() {
    if (settingsTableReady) return;
    const conn = await getConnection("wpacquisti");
    await conn.query(`
        CREATE TABLE IF NOT EXISTS public_slot_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            calendar VARCHAR(16) NOT NULL UNIQUE,
            slot_minutes INT NOT NULL DEFAULT 60,
            weeks_ahead INT NOT NULL DEFAULT 2,
            days_json LONGTEXT NOT NULL,
            closed_days_json LONGTEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    settingsTableReady = true;
}

async function loadSettings(calendar = "60h") {
    const key = CALENDAR_CONTEXT[calendar] ? calendar : "60h";
    await ensureSettingsTable();
    const conn = await getConnection("wpacquisti");
    const [rows] = await conn.query(
        `SELECT slot_minutes, weeks_ahead, days_json, closed_days_json, updated_at
         FROM public_slot_settings
         WHERE calendar=?
         LIMIT 1`,
        [key]
    );

    if (!rows.length) {
        return {
            ...deepClone(DEFAULT_SETTINGS),
            calendar: key,
            updatedAt: null
        };
    }

    const cfg = rows[0];
    const parsedDays = parseJSON(cfg.days_json, DEFAULT_DAY_WINDOWS);
    const parsedClosed = parseJSON(cfg.closed_days_json, []);

    return {
        calendar: key,
        slotMinutes: Math.max(15, Number(cfg.slot_minutes) || 60),
        weeksAhead: Math.min(12, Math.max(1, Number(cfg.weeks_ahead) || 2)),
        days: normalizeDays(parsedDays),
        closedDays: Array.isArray(parsedClosed) ? parsedClosed : [],
        updatedAt: cfg.updated_at || null
    };
}

async function saveSettings(calendar, settings) {
    await ensureSettingsTable();
    const conn = await getConnection("wpacquisti");
    await conn.query(
        `INSERT INTO public_slot_settings
            (calendar, slot_minutes, weeks_ahead, days_json, closed_days_json)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            slot_minutes = VALUES(slot_minutes),
            weeks_ahead = VALUES(weeks_ahead),
            days_json = VALUES(days_json),
            closed_days_json = VALUES(closed_days_json)`,
        [
            calendar,
            settings.slotMinutes,
            settings.weeksAhead,
            JSON.stringify(settings.days || {}),
            JSON.stringify(settings.closedDays || [])
        ]
    );
}

function normalizeDays(days) {
    const normalized = deepClone(DEFAULT_DAY_WINDOWS);
    for (const day of Object.keys(normalized)) {
        const dayRanges = Array.isArray(days?.[day]) ? days[day] : [];
        normalized[day] = dayRanges
            .map((range) => ({
                start: sanitizeTime(range.start),
                end: sanitizeTime(range.end)
            }))
            .filter((range) => range.start && range.end && range.start < range.end);
    }
    return normalized;
}

function sanitizeTime(value) {
    if (!value) return "";
    const match = /^([0-1]\d|2[0-3]):([0-5]\d)$/.exec(String(value).trim());
    return match ? `${match[1]}:${match[2]}` : "";
}

function detectCalendar(req, fallback, hostInfo) {
    const forced = String(fallback || req.query?.calendar || req.body?.calendar || "")
        .trim()
        .toLowerCase();
    if (forced && CALENDAR_CONTEXT[forced]) return forced;

    const info = hostInfo || getHostInfo(req);
    if (info.allowed) {
        return info.type === "rb" ? "amm" : "60h";
    }

    const header = String(req.headers["rb-academy"] || req.headers["x-rb-academy"] || "")
        .trim()
        .toLowerCase();
    if (["1", "true", "yes"].includes(header)) return "amm";

    const host = String(
        req.headers["x-forwarded-host"] ||
        req.headers["host"] ||
        req.headers["origin"] ||
        ""
    )
        .trim()
        .toLowerCase();

    if (host.includes("rb-academy")) return "amm";
    return "60h";
}

function getHostInfo(req) {
    const hostHeader = String(
        req.headers["x-forwarded-host"] ||
        req.headers["host"] ||
        req.headers["origin"] ||
        ""
    )
        .trim()
        .toLowerCase();

    if (!hostHeader) {
        return { allowed: false, type: null, host: "" };
    }

    const matches = (patterns) =>
        patterns.some((pattern) => hostHeader.includes(pattern));

    if (matches(HOST_PATTERNS.rb)) {
        return { allowed: true, type: "rb", host: hostHeader };
    }
    if (matches(HOST_PATTERNS.fi)) {
        return { allowed: true, type: "fi", host: hostHeader };
    }

    return { allowed: false, type: null, host: hostHeader };
}

function ensureAllowedPublicRequest(req, res) {
    const info = getHostInfo(req);
    if (!info.allowed) {
        res.status(403).json({
            success: false,
            error: "Dominio non autorizzato per questa risorsa"
        });
        return null;
    }
    return info;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
}

function isSlotFree(slotStart, slotEnd, busy) {
    return !busy.some((interval) => overlaps(slotStart, slotEnd, interval.start, interval.end));
}

async function fetchBusyIntervals(rangeStart, rangeEnd, slotMinutes) {
    const startStr = toMySQLDateTime(rangeStart);
    const endStr = toMySQLDateTime(rangeEnd);
    const durationMs = Math.max(slotMinutes, 60) * 60 * 1000;

    const busy = [];
    for (const ctx of Object.values(CALENDAR_CONTEXT)) {
        const conn = await getConnection(ctx.sessionDb);
        const [rows] = await conn.query(
            `SELECT dataesame, dataprova
             FROM sessioni
             WHERE (dataesame BETWEEN ? AND ?)
                OR (dataprova BETWEEN ? AND ?)`,
            [startStr, endStr, startStr, endStr]
        );

        for (const row of rows) {
            if (row.dataesame) addBusyInterval(row.dataesame, durationMs, busy);
            if (row.dataprova) addBusyInterval(row.dataprova, durationMs, busy);
        }
    }
    return busy;
}

function addBusyInterval(value, durationMs, collector) {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return;
    const end = new Date(dt.getTime() + durationMs);
    collector.push({ start: dt, end });
}

function generateSlots(config, busy, now = new Date()) {
    const slots = [];
    const today = dayjs(now).startOf("day");
    const limit = today.add(config.weeksAhead * 7, "day").endOf("day");

    for (let day = today; day.isBefore(limit); day = day.add(1, "day")) {
        const dayKey = DAY_KEYS[day.day()];
        const dateStr = day.format("YYYY-MM-DD");
        if (config.closedDays.includes(dateStr)) continue;

        const ranges = config.days?.[dayKey] || [];
        if (!ranges.length) continue;

        for (const range of ranges) {
            const rangeStart = dayjs(`${dateStr}T${range.start}`);
            const rangeEnd = dayjs(`${dateStr}T${range.end}`);
            if (!rangeStart.isValid() || !rangeEnd.isValid()) continue;

            let slotStart = rangeStart;
            while (slotStart.add(config.slotMinutes, "minute").valueOf() <= rangeEnd.valueOf()) {
                const slotEnd = slotStart.add(config.slotMinutes, "minute");
                if (slotStart.isBefore(now)) {
                    slotStart = slotEnd;
                    continue;
                }

                if (isSlotFree(slotStart.toDate(), slotEnd.toDate(), busy)) {
                    slots.push({
                        id: `slot-${slotStart.format("YYYYMMDDHHmm")}`,
                        start: slotStart.toISOString(),
                        end: slotEnd.toISOString(),
                        day: dayKey,
                        label: slotStart.format("dddd DD/MM HH:mm")
                    });
                }

                slotStart = slotEnd;
            }
        }
    }
    return slots;
}

function validateSlot(config, slotStart) {
    const dayKey = DAY_KEYS[slotStart.getDay()];
    const windows = config.days?.[dayKey] || [];
    if (!windows.length) return false;

    const dateStr = dayjs(slotStart).format("YYYY-MM-DD");
    if (config.closedDays.includes(dateStr)) return false;
    if (dayjs(slotStart).isBefore(dayjs(), "minute")) return false;

    return windows.some((window) => {
        const windowStart = dayjs(`${dateStr}T${window.start}`);
        const windowEnd = dayjs(`${dateStr}T${window.end}`);
        if (!windowStart.isValid() || !windowEnd.isValid()) return false;

        const slotEnd = dayjs(slotStart).add(config.slotMinutes, "minute");
        if (slotEnd.valueOf() > windowEnd.valueOf()) return false;
        if (windowStart.isAfter(slotStart)) return false;

        const diff = dayjs(slotStart).diff(windowStart, "minute");
        return diff % config.slotMinutes === 0;
    });
}

async function createSlotSession({ calendar, start, note, iduser, idcourse }) {
    const ctx = CALENDAR_CONTEXT[calendar] || CALENDAR_CONTEXT["60h"];
    const connSession = await getConnection(ctx.sessionDb);
    const connLearning = await getConnection(ctx.learningDb);

    const startDate = new Date(start);
    const startStr = toMySQLDateTime(startDate);
    const nowStr = toMySQLDateTime(new Date());
    const nomesessione = `Slot pubblico ${ctx.label}`;
    const noteValue = (note || "").trim();

    const [existing] = await connSession.query(
        `SELECT id FROM sessioni WHERE dataesame = ? LIMIT 1`,
        [startStr]
    );
    if (existing.length) {
        throw new Error("Slot già occupato");
    }

    const [sessionRes] = await connSession.query(
        `INSERT INTO sessioni
            (maxposti, Postidisponibili, dataesame, dataprova, nomesessione, domicilio, note,
             visible, attivo, idstudio, indirizzosessione, datainvio, flagconferma)
         VALUES (1, 0, ?, ?, ?, '', ?, 1, 1, 1, '', ?, 1)`,
        [startStr, startStr, nomesessione, noteValue, nowStr]
    );
    const idsessione = sessionRes.insertId;

    await connSession.query(
        `INSERT INTO prenotazioni (idsessione, iduser, idcourse, db, data_prenotazione)
         VALUES (?,?,?,?,?)`,
        [idsessione, iduser, idcourse, ctx.learningDb || "", nowStr]
    );

    await syncAnagrafica(ctx, iduser);

    await connLearning.query(
        `UPDATE learning_certificate_assign
         SET flagevent = 1
         WHERE id_user = ? AND id_course = ?`,
        [iduser, idcourse]
    ).catch(() => { });

    await sendConfirmationEmail(calendar, iduser, idsessione);

    return idsessione;
}

async function syncAnagrafica(ctx, iduser) {
    if (!iduser) return;
    const connSession = await getConnection(ctx.sessionDb);
    const connLearning = await getConnection(ctx.learningDb);

    const [rows] = await connLearning.query(
        `SELECT firstname, lastname, email
         FROM core_user
         WHERE idst = ?
         LIMIT 1`,
        [iduser]
    );
    if (!rows.length) return;
    const user = rows[0];
    const extraFields = await fetchUserCustomFields(connLearning, iduser);
    const codiceFiscale = extraFields.codicefiscale || user.codicefiscale || "";
    const telefono = extraFields.telefono || user.telefono || "";
    const schema = await getAnagraficaSchema(ctx, connSession);
    const columns = [];
    const updates = [];
    const values = [];
    const addColumn = (key, value, update = true, optional = false) => {
        if (optional && !schema.has(key)) return;
        const columnName = schema.resolve(key);
        columns.push(columnName);
        values.push(value);
        if (update) updates.push(columnName);
    };

    addColumn("id", iduser, false);
    addColumn("nome", sanitizeUserField(user.firstname));
    addColumn("cognome", sanitizeUserField(user.lastname));
    addColumn("email", sanitizeUserField(user.email));
    addColumn("codicefiscale", sanitizeUserField(codiceFiscale), true, true);
    addColumn("telefono", sanitizeUserField(telefono), true, true);

    const placeholders = columns.map(() => "?").join(",");
    const insertCols = columns.map((col) => `\`${col}\``).join(",");
    const updateClause = updates.map((col) => `\`${col}\`=VALUES(\`${col}\`)`).join(", ");
    const query = `
        INSERT INTO anagrafiche (${insertCols})
        VALUES (${placeholders})
        ON DUPLICATE KEY UPDATE ${updateClause}
    `;
    await connSession.query(query, values);
}

async function getAnagraficaSchema(ctx, connSession) {
    if (anagraficaSchemaCache[ctx.sessionDb]) {
        return anagraficaSchemaCache[ctx.sessionDb];
    }
    const info = { columns: Object.create(null) };
    try {
        const [rows] = await connSession.query(
            `SHOW COLUMNS FROM anagrafiche`
        );
        rows.forEach((row) => {
            if (!row?.Field) return;
            info.columns[row.Field.toLowerCase()] = row.Field;
        });
    } catch (err) {
        console.warn("⚠️ public-slots anagrafiche schema check failed:", err.message);
    }
    info.has = (name) => Boolean(info.columns[String(name).toLowerCase()]);
    info.resolve = (name) => info.columns[String(name).toLowerCase()] || name;
    anagraficaSchemaCache[ctx.sessionDb] = info;
    return info;
}

function sanitizeUserField(value) {
    if (typeof value === "string") return value.trim();
    if (value === null || typeof value === "undefined") return "";
    return String(value);
}

async function fetchUserCustomFields(conn, iduser) {
    const info = { codicefiscale: "", telefono: "" };
    if (!iduser) return info;
    try {
        const [rows] = await conn.query(
            `SELECT id_common, user_entry
             FROM core_field_userentry
             WHERE id_user = ?
               AND id_common IN (23, 20, 14)`,
            [iduser]
        );
        for (const row of rows) {
            const value = sanitizeUserField(row.user_entry);
            if (!value) continue;
            const commonId = Number(row.id_common);
            if (commonId === 23 && !info.codicefiscale) {
                info.codicefiscale = value;
            } else if ((commonId === 20 || commonId === 14) && !info.telefono) {
                info.telefono = value;
            }
        }
    } catch (err) {
        console.warn("⚠️ public-slots custom field fetch failed:", err.message);
    }
    return info;
}

async function sendConfirmationEmail(calendar, iduser, idsessione) {
    try {
        const ctx = CALENDAR_CONTEXT[calendar] || CALENDAR_CONTEXT["60h"];
        const connSession = await getConnection(ctx.sessionDb);
        const [rows] = await connSession.query(
            `SELECT a.email, a.nome, a.cognome, s.dataesame, s.dataprova
             FROM anagrafiche a
             JOIN prenotazioni p ON a.id = p.iduser
             JOIN sessioni s ON p.idsessione = s.id
             WHERE p.iduser = ? AND p.idsessione = ?
             LIMIT 1`,
            [iduser, idsessione]
        );

        if (!rows.length) return;

        const info = rows[0];
        const templateKey = calendar === "amm" ? "mailformatAmmconferma2" : "mailformat60hconferma2";
        const piedino = calendar === "amm" ? piedinorbacademy : piedinodidattica;
        const from = calendar === "amm" ? "info@rb-academy.it" : "didattica@formazioneintermediari.com";
        const subject = calendar === "amm"
            ? "Test finale Amministratore di condominio: conferma"
            : "Test finale 60h IVASS: conferma";

        let body = await getMailFormat(templateKey);
        body = (body || "")
            .replace("[NOME]", info.nome || "")
            .replace("[COGNOME]", info.cognome || "")
            .replace("[DATAESAME]", info.dataesame ? new Date(info.dataesame).toLocaleDateString("it-IT") : "")
            .replace("[ORA]", info.dataesame ? new Date(info.dataesame).toLocaleTimeString("it-IT") : "")
            .replace("[DATAPROVA]", info.dataprova ? new Date(info.dataprova).toLocaleDateString("it-IT") : "")
            .replace("[ORAPROVA]", info.dataprova ? new Date(info.dataprova).toLocaleTimeString("it-IT") : "");
        body += "<br>" + piedino;

        const dir = path.join(process.cwd(), "public/temp");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `slot_${calendar}_${iduser}.ics`);
        const ics =
            `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:${info.dataprova ? new Date(info.dataprova).toISOString().replace(/[-:]/g, "").split(".")[0] : ""}
SUMMARY:Prova test
END:VEVENT
BEGIN:VEVENT
DTSTART:${info.dataesame ? new Date(info.dataesame).toISOString().replace(/[-:]/g, "").split(".")[0] : ""}
SUMMARY:Test Finale
END:VEVENT
END:VCALENDAR`;

        fs.writeFileSync(filePath, ics);

        const bcc = await getBCC(iduser);
        await invioMail({
            to: info.email,
            from,
            subject,
            html: body,
            bcc,
            attachments: [filePath]
        });

        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        await connSession.query(
            `UPDATE prenotazioni SET flagmail = 1 WHERE iduser=? AND idsessione=?`,
            [iduser, idsessione]
        );
    } catch (err) {
        console.error("❌ public-slot mail ERR:", err.message);
    }
}

router.get("/availability", async (req, res) => {
    try {
        const hostInfo = ensureAllowedPublicRequest(req, res);
        if (!hostInfo) return;
        const calendar = detectCalendar(req, undefined, hostInfo);
        const config = await loadSettings(calendar);
        const today = new Date();
        const rangeEnd = dayjs(today).add(config.weeksAhead * 7, "day").endOf("day").toDate();

        const busy = await fetchBusyIntervals(today, rangeEnd, config.slotMinutes);
        const slots = generateSlots(config, busy, today);

        res.json({
            success: true,
            calendar,
            slotMinutes: config.slotMinutes,
            weeksAhead: config.weeksAhead,
            closedDays: config.closedDays,
            timezone: "Europe/Rome",
            slots
        });
    } catch (err) {
        console.error("❌ public-slots availability ERR:", err.message);
        res.status(500).json({ success: false, error: "Errore calcolo disponibilità" });
    }
});

router.get("/context", async (req, res) => {
    try {
        const hostInfo = ensureAllowedPublicRequest(req, res);
        if (!hostInfo) return;
        const iduser = Number(req.query.iduser);
        const idcourse = Number(req.query.idcourse);

        if (!Number.isFinite(iduser) || !Number.isFinite(idcourse)) {
            return res.status(400).json({ success: false, error: "Parametri mancanti" });
        }

        const calendar = detectCalendar(req, req.query?.calendar, hostInfo);
        const ctx = CALENDAR_CONTEXT[calendar] || CALENDAR_CONTEXT["60h"];
        const connLearning = await getConnection(ctx.learningDb);

        const [userRows] = await connLearning.query(
            `SELECT firstname, lastname FROM core_user WHERE idst = ? LIMIT 1`,
            [iduser]
        );
        const [courseRows] = await connLearning.query(
            `SELECT name FROM learning_course WHERE idcourse = ? LIMIT 1`,
            [idcourse]
        );

        if (!userRows.length || !courseRows.length) {
            return res.status(404).json({ success: false, error: "Utente o corso non trovati" });
        }

        res.json({
            success: true,
            calendar,
            user: {
                firstname: userRows[0].firstname || "",
                lastname: userRows[0].lastname || ""
            },
            course: {
                name: courseRows[0].name || ""
            }
        });
    } catch (err) {
        console.error("❌ public-slots context ERR:", err.message);
        res.status(500).json({ success: false, error: "Errore recupero dati" });
    }
});

router.get("/settings", async (_req, res) => {
    try {
        const configs = {};
        for (const key of Object.keys(CALENDAR_CONTEXT)) {
            configs[key] = await loadSettings(key);
        }
        res.json({ success: true, configs });
    } catch (err) {
        console.error("❌ public-slots settings ERR:", err.message);
        res.status(500).json({ success: false, error: "Errore caricamento impostazioni" });
    }
});

router.put("/settings", async (req, res) => {
    try {
        const calendar = detectCalendar(req, req.body?.calendar);
        const payload = req.body?.config || {};
        const normalized = {
            slotMinutes: Math.max(15, Math.min(240, Number(payload.slotMinutes) || 60)),
            weeksAhead: Math.max(1, Math.min(12, Number(payload.weeksAhead) || 2)),
            days: normalizeDays(payload.days || {}),
            closedDays: Array.isArray(payload.closedDays)
                ? payload.closedDays.filter(Boolean)
                : []
        };

        await saveSettings(calendar, normalized);
        res.json({ success: true });
    } catch (err) {
        console.error("❌ public-slots save ERR:", err.message);
        res.status(500).json({ success: false, error: "Salvataggio impostazioni fallito" });
    }
});

router.post("/book", async (req, res) => {
    try {
        const hostInfo = ensureAllowedPublicRequest(req, res);
        if (!hostInfo) return;
        const calendar = detectCalendar(req, req.body?.calendar, hostInfo);
        const config = await loadSettings(calendar);
        const { slotStart, iduser, idcourse, note } = req.body || {};
        if (!slotStart || !iduser || !idcourse) {
            return res.status(400).json({ success: false, error: "Dati prenotazione incompleti" });
        }

        const slotDate = new Date(slotStart);
        if (Number.isNaN(slotDate.getTime())) {
            return res.status(400).json({ success: false, error: "Data slot non valida" });
        }

        if (!validateSlot(config, slotDate)) {
            return res.status(400).json({ success: false, error: "Slot non disponibile" });
        }

        const dayBoundsStart = dayjs(slotDate).startOf("day").toDate();
        const dayBoundsEnd = dayjs(slotDate).endOf("day").toDate();
        const busy = await fetchBusyIntervals(dayBoundsStart, dayBoundsEnd, config.slotMinutes);
        const slotEnd = new Date(slotDate.getTime() + config.slotMinutes * 60 * 1000);
        if (!isSlotFree(slotDate, slotEnd, busy)) {
            return res.status(409).json({ success: false, error: "Slot già occupato" });
        }

        const sessionId = await createSlotSession({
            calendar,
            start: slotDate,
            note,
            iduser,
            idcourse
        });

        res.json({
            success: true,
            calendar,
            sessionId,
            slotStart: slotDate.toISOString()
        });
    } catch (err) {
        console.error("❌ public-slots book ERR:", err.message);
        res.status(500).json({ success: false, error: err.message || "Prenotazione fallita" });
    }
});

module.exports = router;
