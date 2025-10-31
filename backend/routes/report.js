// routes/report.js
const express = require("express");
const router = express.Router();
const { getConnection } = require("../dbManager");
const { requireConv } = require("../middleware/authConv");

const path = require("path");
const fs = require("fs");
const dayjs = require("dayjs");
const XLSX = require("xlsx");
const puppeteer = require("puppeteer");
const { logwrite } = require("../utils/helper");

// --- helper: mapping convenzioni -> host/db già noto in progetto (se lo hai in un modulo, importalo)
const { resolvePlatformFromHost } = require("../utils/helper"); // opzionale, se già esiste

router.get("/questionari", async (req, res) => {
    try {
        let { from, to, idcourse = "[-]", convenzione = "", free = "false" } = req.query;

        if (!from || !to) {
            // default: oggi intero
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const end = new Date(start); end.setDate(end.getDate() + 1); end.setMilliseconds(-1);
            from = start.toISOString();
            to = end.toISOString();
        }

        // Se c'è convenzione specifica e contiene host/db, la usiamo come unica sorgente
        // Altrimenti splittiamo per range (SITE/EFAD/IFAD)
        let segments = [];
        if (!convenzione) {
            segments = splitRangeByDb(from, to);
        } else {
            // Se dall'esterno ci arriva "host=dbip|piattaforma|..." usa mapping preesistente
            // Qui semplifico: in assenza di mappatura specifica, default IFAD/forma4
            segments = [{ range: [from, to], hostKey: "IFAD", dbName: "forma4" }];
        }

        const isFree = String(free).toLowerCase() === "true";
        const results = [];
        let total = 0;

        for (const seg of segments) {
            const conn = await getConnection(seg.hostKey, seg.dbName);
            if (isFree) {
                const { sql, outParams } = sqlFreeAnswers({ idcourse, convenzione });
                const params = [seg.range[0], seg.range[1], ...outParams];
                const [rows] = await conn.query(sql, params);
                rows.forEach(r => results.push({
                    type: "free",
                    date_attempt: r.date_attempt,
                    id_track: r.id_track,
                    firstname: r.firstname,
                    lastname: r.lastname,
                    email: r.email,
                    coursename: r.coursename,
                    more_info: r.more_info,
                    attiva: r.attiva ? 1 : 0,
                    hostKey: seg.hostKey,
                    dbName: seg.dbName,
                }));
                total += rows.length;
            } else {
                const { sqlTracks, sqlQuestions, sqlAnswers, outParams } = sqlFullDetails({ idcourse, convenzione });
                const params = [seg.range[0], seg.range[1], ...outParams];
                const [tracks] = await conn.query(sqlTracks, params);

                for (const t of tracks) {
                    // domande
                    const [quests] = await conn.query(sqlQuestions, [t.id_poll]);
                    const detail = [];
                    for (const q of quests) {
                        const [ans] = await conn.query(sqlAnswers, [t.id_track, q.id_quest]);
                        detail.push({
                            id_quest: q.id_quest,
                            title_quest: q.title_quest,
                            answers: ans.map(a => ({
                                id_answer: a.id_answer,
                                text: a.answer,
                                scelta: a.scelta,
                                more_info: a.more_info,
                                attiva: a.attiva ? 1 : 0,
                            })),
                        });
                    }
                    results.push({
                        type: "full",
                        date_attempt: t.date_attempt,
                        id_track: t.id_track,
                        firstname: t.firstname,
                        lastname: t.lastname,
                        email: t.email,
                        coursename: t.coursename,
                        detail,
                        hostKey: seg.hostKey,
                        dbName: seg.dbName,
                    });
                }
                total += tracks.length;
            }
        }

        res.json({
            success: true,
            mode: isFree ? "free" : "full",
            total,
            from,
            to,
            idcourse,
            convenzione,
            rows: results,
        });
    } catch (err) {
        console.error("GET /api/report/questionari ERR:", err);
        res.status(500).json({ error: err.message });
    }
});

router.patch("/questionari/attiva", async (req, res) => {
    try {
        const { id_track, attiva, hostKey, dbName } = req.body || {};
        if (!id_track) {
            return res.status(400).json({ error: "id_track e id_quest richiesti" });
        }
        // hostKey/dbName possono arrivare dal client dalla riga; altrimenti default 2025+:
        const hk = hostKey || "IFAD";
        const dbn = dbName || "forma4";
        const conn = await getConnection(hk, dbn);
        await conn.query(
            `UPDATE learning_polltrack_answer SET attiva = ? WHERE id_track = ? `,
            [attiva ? 1 : 0, id_track]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("PATCH /api/report/questionari/attiva ERR:", err);
        res.status(500).json({ error: err.message });
    }
});


// Regola default: 2011-2018 SITE/formazionein, 2018-2024 EFAD/newformazionein, 2025-... IFAD/forma4
function pickDbByDate(dISO) {
    const d = new Date(dISO);
    const y = d.getFullYear();
    if (y <= 2018) return { hostKey: "SITE", dbName: "formazionein" };
    if (y <= 2024) return { hostKey: "EFAD", dbName: "newformazionein" };
    return { hostKey: "IFAD", dbName: "forma4" };
}

// Dato un range, restituisce i segmenti DB da interrogare in ordine di priorità
function splitRangeByDb(fromISO, toISO) {
    const segs = [];
    const from = new Date(fromISO);
    const to = new Date(toISO);

    // limiti "logici"
    const end2018 = new Date("2018-12-31T23:59:59Z");
    const end2024 = new Date("2024-12-31T23:59:59Z");

    // 1) fino a 2018
    if (from <= end2018) {
        const a = from;
        const b = new Date(Math.min(to.getTime(), end2018.getTime()));
        segs.push({
            range: [a.toISOString(), b.toISOString()],
            hostKey: "SITE",
            dbName: "formazionein",
        });
    }
    // 2) 2019-2024
    if (to > end2018 && from <= end2024) {
        const a = new Date(Math.max(from.getTime(), end2018.getTime() + 1));
        const b = new Date(Math.min(to.getTime(), end2024.getTime()));
        segs.push({
            range: [a.toISOString(), b.toISOString()],
            hostKey: "EFAD",
            dbName: "newformazionein",
        });
    }
    // 3) 2025+
    const start2025 = new Date("2025-01-01T00:00:00Z");
    if (to >= start2025) {
        const a = new Date(Math.max(from.getTime(), start2025.getTime()));
        const b = to;
        segs.push({
            range: [a.toISOString(), b.toISOString()],
            hostKey: "IFAD",
            dbName: "forma4",
        });
    }
    return segs;
}

function sqlFreeAnswers({ idcourse, convenzione }) {
    // Risposte libere (more_info != '')
    // more_info sta in learning_polltrack_answer (alias pta), attiva sta lì
    // join su learning_polltrack (pt), learning_organization (org), core_user (u), learning_course (lc)
    const filterCourse = idcourse && idcourse !== "[-]" ? " AND org.idCourse = ? " : "";
    const filterConv = convenzione ? " AND u.idst IN (SELECT id_user FROM core_field_userentry WHERE id_common=25 AND user_entry = ?) " : "";

    const sql = `
    SELECT 
      pt.date_attempt,
      pt.id_poll,
      pt.id_reference,
      pt.id_user,
      pt.id_track,
      u.firstname,
      u.lastname,
      u.email,
      CONCAT(lc.code,' ',lc.name) AS coursename,
      COALESCE(pta.more_info,'') AS more_info,
      COALESCE(pta.attiva,0) AS attiva
    FROM learning_polltrack pt
    JOIN core_user u ON pt.id_user = u.idst
    LEFT JOIN learning_organization org ON org.idOrg = pt.id_reference
    LEFT JOIN learning_course lc ON lc.idCourse = org.idCourse
    LEFT JOIN learning_polltrack_answer pta ON pta.id_track = pt.id_track
    WHERE COALESCE(pta.more_info,'') <> ''
      AND pt.date_attempt >= ?
      AND pt.date_attempt <= ?
      ${filterCourse}
      ${filterConv}
    ORDER BY pt.date_attempt DESC
  `;
    const params = [null, null];
    const outParams = [];
    // verranno pushate le date runtime
    if (idcourse && idcourse !== "[-]") outParams.push(idcourse);
    if (convenzione) outParams.push(convenzione);
    return { sql, outParams };
}

function sqlFullDetails({ idcourse, convenzione }) {
    // Elenco track + per ogni track elenco Q/A
    const filterCourse = idcourse && idcourse !== "[-]" ? " AND org.idCourse = ? " : "";
    const filterConv = convenzione ? " AND u.idst IN (SELECT id_user FROM core_field_userentry WHERE id_common=25 AND user_entry = ?) " : "";

    const sqlTracks = `
    SELECT 
      pt.id_poll,
      pt.id_reference,
      pt.id_user,
      pt.id_track,
      pt.date_attempt,
      u.firstname,
      u.lastname,
      u.email,
      (SELECT CONCAT(code,' ',name) FROM learning_course WHERE idCourse = org.idCourse) AS coursename
    FROM learning_polltrack pt
    JOIN core_user u ON pt.id_user = u.idst
    JOIN learning_organization org ON org.idOrg = pt.id_reference
    WHERE pt.date_attempt >= ?
      AND pt.date_attempt <= ?
      ${filterCourse}
      ${filterConv}
    ORDER BY pt.date_attempt DESC
  `;

    const sqlQuestions = `
    SELECT id_quest, title_quest
    FROM learning_pollquest
    WHERE id_poll = ?
    ORDER BY sequence ASC, id_quest ASC
  `;

    const sqlAnswers = `
    SELECT 
      a.id_quest,
      a.id_answer,
      a.answer,
      pta.id_answer AS scelta,
      COALESCE(pta.more_info,'') AS more_info,
      COALESCE(pta.attiva,0) AS attiva
    FROM learning_pollquestanswer a
    RIGHT JOIN learning_polltrack_answer pta ON a.id_quest = pta.id_quest
    WHERE pta.id_track = ?
      AND pta.id_quest = ?
    ORDER BY a.sequence ASC, a.id_answer ASC
  `;

    const params = [null, null];
    const outParams = [];
    if (idcourse && idcourse !== "[-]") outParams.push(idcourse);
    if (convenzione) outParams.push(convenzione);

    return { sqlTracks, sqlQuestions, sqlAnswers, outParams };
}


// Mapping periodo → DB/host (regola confermata)
function pickDbByDates(fromISO, toISO) {
    const to = new Date(toISO || Date.now());
    const y = to.getUTCFullYear();

    if (y >= 2025) return { hostKey: "IFAD", dbName: "forma4" };               // 2025+
    if (y >= 2018) return { hostKey: "EFAD", dbName: "newformazionein" };      // 2018-2024
    return { hostKey: "IFAD", dbName: "formazionein" };                        // 2011-2018
}

// --- CORSI della convenzione nel periodo ---
router.get("/convenzione/corsi", requireConv, async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) return res.status(400).json({ error: "from/to obbligatori (ISO)" });

        const { hostKey, dbName } = pickDbByDates(from, to);
        const conn = await getConnection(hostKey, dbName);

        // Corsi con almeno una iscrizione nel periodo
        const [rows] = await conn.query(
            `
      SELECT DISTINCT c.idCourse, c.code, c.name
      FROM learning_courseuser cu
      JOIN learning_course c ON c.idCourse = cu.idCourse
      WHERE cu.date_inscr BETWEEN ? AND ?
      ORDER BY c.code ASC, c.name ASC
      `,
            [from, to]
        );

        return res.json({
            source: `${hostKey}/${dbName}`,
            rows: rows.map(r => ({ idcourse: r.idCourse, code: r.code, name: r.name })),
        });
    } catch (err) {
        console.error("GET /report/convenzione/corsi ERR:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- ISCRITTI al corso selezionato + stato/percent ---
router.get("/convenzione", requireConv, async (req, res) => {
    try {
        const { from, to, idcourse } = req.query;
        if (!from || !to || !idcourse) return res.status(400).json({ error: "from, to, idcourse obbligatori" });

        const { hostKey, dbName } = pickDbByDates(from, to);
        const conn = await getConnection(hostKey, dbName);

        // NB: percent reale dipende dalla tua piattaforma; qui fallback coerente con WFStatistichenew:
        // - 100 se date_complete non null
        // - 0 se nessun accesso (lastenter NULL o 0)
        // - altrimenti "in corso"  (50)
        const [rows] = await conn.query(
            `
      SELECT
        cu.idUser    AS iduser,
        cu.idCourse  AS idcourse,
        u.idst       AS id,
        u.lastname   AS last_name,
        u.firstname  AS first_name,
        u.email,
        -- CF: opzionale (se noto un id_common per CF, sostituisci 6 con quello corretto)
        (SELECT user_entry FROM core_field_userentry WHERE id_user = u.idst AND id_common = 23 LIMIT 1) AS cf,
        cu.date_inscr,
        cu.date_complete,
        u.lastenter
      FROM learning_courseuser cu
      JOIN core_user u ON u.idst = cu.idUser
      WHERE cu.idCourse = ? AND cu.date_inscr BETWEEN ? AND ?
      ORDER BY cu.date_inscr DESC
      `,
            [idcourse, from, to]
        );

        const mapped = rows.map(r => {
            const isCompleted = !!r.date_complete;
            const hasEntered = !!r.lastenter;
            const percent = isCompleted ? 100 : hasEntered ? 50 : 0;
            let stato = "";
            if (isCompleted) stato = "Completato";
            else if (!hasEntered) stato = "Iscritto";
            else stato = "In corso";
            return {
                id: r.id,
                iduser: r.iduser,
                idcourse: r.idcourse,
                last_name: r.last_name,
                first_name: r.first_name,
                email: r.email,
                cf: r.cf || null,
                percent,
                date_inscr: r.date_inscr,
                date_complete: r.date_complete,
                stato,
            };
        });

        return res.json({
            source: `${hostKey}/${dbName}`,
            rows: mapped,
            total: mapped.length,
        });
    } catch (err) {
        console.error("GET /report/convenzione ERR:", err);
        res.status(500).json({ error: err.message });
    }
});


/**
 * 📊 API: /api/report/data
 * Report Fatturato Corsi — compatibile con il nuovo frontend React
 */
router.get("/data", async (req, res) => {
    try {
        const { datequest, datequest2, idcourse, idcat } = req.query;
        if (!datequest || !datequest2) {
            return res.status(400).json({ success: false, error: "Parametri mancanti" });
        }


        const from = dayjs(datequest).format("YYYY-MM-DD 00:00:00");
        const to = dayjs(datequest2).format("YYYY-MM-DD 23:59:59");

        const { hostKey, dbName } = pickDbByDates(from, to);
        const conn = await getConnection(hostKey, dbName);
        let filter = "";

        // Filtro corso (singolo o lista)
        if (idcourse && idcourse !== "[-]") {
            filter += ` AND a.idCourse IN (${idcourse}) `;
        }

        // Filtro categoria (come in ASPX)
        if (idcat && idcat !== "Seleziona Categoria") {
            filter += ` AND c.idCategory IN (${idcat}) `;
        }

        // Query coerente con VB.NET originale
        const sql = `
            SELECT 
                s.firstname,
                s.lastname,
                c.name,
                c.code,
                a.date_inscr,
                ROUND(c.price * 1.22, 2) AS fatturato
            FROM learning_courseuser a
            JOIN core_field_userentry b ON a.iduser = b.id_user
            JOIN learning_course c ON a.idCourse = c.idCourse
            JOIN core_user s ON s.idst = a.iduser
            WHERE b.id_common = 25
              AND (b.user_entry IN ('Formazione intermediari', 'RB INTERMEDIARI'))
              AND c.price > 0
              AND ((c.name NOT LIKE '%simul%' AND c.name NOT LIKE '%test%') OR c.price != '')
              ${filter}
              AND (a.date_inscr BETWEEN ? AND ?)
            ORDER BY a.date_inscr DESC
        `;

        const [rows] = await conn.query(sql, [from, to]);


        return res.json({ success: true, rows });
    } catch (err) {
        console.error("❌ Errore /api/report/data:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 📤 API: /api/report/export (Excel o PDF)
 */
router.post("/export", async (req, res) => {
    try {
        const { format, rows: providedRows, db, from, to, idcourse, idcat } = req.body || {};
        let rows = providedRows;

        // 🔄 Se i dati non sono stati passati dal frontend, richiamali internamente
        if (!rows || !rows.length) {
            const backendUrl = `${process.env.BACKEND_URL || "http://localhost:3000"}/api/report/data?db=${db}&datequest=${from}&datequest2=${to}&idcourse=${idcourse || "[-]"}&idcat=${idcat || "Seleziona Categoria"}`;
            const resp = await fetch(backendUrl);
            const json = await resp.json();
            if (json.success) rows = json.rows;
        }

        if (!rows || !rows.length) {
            return res.status(404).json({ success: false, error: "Nessun dato da esportare." });
        }

        // === 🟢 EXPORT EXCEL ===
        if (format === "excel") {
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Report");
            const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

            res.setHeader("Content-Disposition", "attachment; filename=report_fatturato.xlsx");
            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
            return res.send(buf);
        }

        // === 🟣 EXPORT PDF ===
        const html = `
            <html>
            <head>
                <meta charset="utf-8" />
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    h2 { text-align: center; }
                    table { border-collapse: collapse; width: 100%; margin-top: 20px; font-size: 12px; }
                    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
                    th { background: #f2f2f2; }
                    td:last-child, th:last-child { text-align: right; }
                    tfoot td { font-weight: bold; background: #fafafa; }
                </style>
            </head>
            <body>
                <h2>Report Corsi / Fatturato</h2>
                <p><b>Periodo:</b> ${dayjs(from).format("DD/MM/YYYY")} - ${dayjs(to).format("DD/MM/YYYY")}</p>
                <table>
                    <thead>
                        <tr>
                            <th>Data iscrizione</th>
                            <th>Nome</th>
                            <th>Cognome</th>
                            <th>Codice corso</th>
                            <th>Nome corso</th>
                            <th>Fatturato (€)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows
                .map(
                    (r) => `
                                <tr>
                                    <td>${dayjs(r.date_inscr).format("DD/MM/YYYY")}</td>
                                    <td>${r.firstname || ""}</td>
                                    <td>${r.lastname || ""}</td>
                                    <td>${r.code || ""}</td>
                                    <td>${r.name || ""}</td>
                                    <td>${parseFloat(r.fatturato || 0).toLocaleString("it-IT", {
                        minimumFractionDigits: 2,
                    })}</td>
                                </tr>`
                )
                .join("")}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="5">Totale</td>
                            <td>€ ${rows
                .reduce((sum, r) => sum + (parseFloat(r.fatturato) || 0), 0)
                .toLocaleString("it-IT", { minimumFractionDigits: 2 })}</td>
                        </tr>
                    </tfoot>
                </table>
            </body>
            </html>
        `;

        const browser = await puppeteer.launch({
            headless: "new",
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });

        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "load" });
        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            landscape: true,
        });
        await browser.close();

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", 'attachment; filename="report.pdf"');
        return res.end(pdfBuffer);

    } catch (err) {
        logwrite("❌ Errore export report: " + err.message);
        console.error("Errore export:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 📋 API: /api/report/filters
 */
router.get("/filters", async (req, res) => {
    try {

        const { from, to } = req.query;
        const { hostKey, dbName } = pickDbByDates(from, to);
        const conn = await getConnection(hostKey, dbName);

        const [courses] = await conn.query(
            `
    SELECT idcourse,price,concat(code,' - ', name) as name 
    FROM learning_course 
    WHERE price != 0
      AND idcourse IN (
          SELECT DISTINCT a.idCourse
          FROM learning_courseuser a
          JOIN core_field_userentry b ON a.iduser = b.id_user
          WHERE b.id_common=25 and b.user_entry IN ('Formazione intermediari','RB INTERMEDIARI')
      )
    ORDER BY idcategory ASC
    `
        );


        res.json({ success: true, courses });
    } catch (err) {
        logwrite("❌ Errore filters report: " + err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;