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
            // Qui semplifico: in assenza di mappatura specifica, default IFAD/process.env.MYSQL_FORMA4
            segments = [{ range: [from, to], dbName: process.env.MYSQL_FORMA4 }];
        }

        const isFree = String(free).toLowerCase() === "true";
        const results = [];
        let total = 0;

        for (const seg of segments) {
            const conn = await getConnection(seg.dbName);
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

        const dbn = dbName || process.env.MYSQL_FORMA4;
        const conn = await getConnection(dbn);
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


// Regola default: 2011-2018 SITE/formazionein, 2018-2024 EFAD/newformazionein, 2025-... IFAD/process.env.MYSQL_FORMA4
function pickDbByDate(dISO) {
    const d = new Date(dISO);
    const y = d.getFullYear();
    if (y <= 2018) return { hostKey: "SITE", dbName: "formazionein" };
    if (y <= 2024) return { hostKey: "EFAD", dbName: "newformazionein" };
    return { hostKey: "IFAD", dbName: process.env.MYSQL_FORMA4 };
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
            dbName: process.env.MYSQL_FORMA4,
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

    if (y >= 2025) return { hostKey: "IFAD", dbName: process.env.MYSQL_FORMA4 };               // 2025+
    if (y >= 2018) return { hostKey: "EFAD", dbName: "newformazionein" };      // 2018-2024
    return { hostKey: "IFAD", dbName: "formazionein" };                        // 2011-2018
}
// /report/convenzione/corsi
router.get("/convenzione/corsi", requireConv, async (req, res) => {
    try {

        const { conv } = req;
        const connWp = await getConnection("wpacquisti");

        // Prendo SOLO i corsi dal listino
        const [tbl] = await connWp.query(
            `SELECT corso 
             FROM tblprezzi
             WHERE codice = ?
               AND prezzo != ''
               AND corso  != ''`,
            [conv.code]
        );

        if (!tbl.length) {
            console.log("⚠️ Nessun corso in convenzione");
            return res.json({ rows: [] });
        }

        const allCodes = tbl.map(r => r.corso);

        // Mappa gruppi
        const GROUPS = [
            {
                id: "codrev%",
                pattern: /^codrev/i,
                label: "Revisore della contabilità condominiale"
            },
            {
                id: "codammagg%",
                pattern: /^codammagg/i,
                label: " Aggiornamento per amministratore di condominio"
            },

            {
                id: "codamm%",
                pattern: /^codamm(?!agg)/i,
                label: "Prima formazione per amministratore di condominio"
            },
            { id: "cod15%", pattern: /^cod15/i, label: "Corso 15 Ore IVASS" },
            { id: "cod30%", pattern: /^cod30/i, label: "Corso 30 Ore IVASS" },
            { id: "cod45%", pattern: /^cod45/i, label: "Corso 45 Ore IVASS" },
            { id: "cod60%agg", pattern: /^cod60.*agg/i, label: "Corso 60 Ore Aggiornamento IVASS" },
            { id: "cod60%", pattern: /^cod60(?!.*agg)/i, label: "Corso 60 Ore Prima Iscrizione IVASS" },

            { id: "codag%", pattern: /^codAgenti/i, label: "Corso Preparatorio Agenti/Broker" },
            { id: "codan%", pattern: /^codAntiric/i, label: "Antiriciclaggio" },
            { id: "codsim%", pattern: /^codIVASS/i, label: "Simulazione IVASS" },

            { id: "codoama%", pattern: /^codOAMa/i, label: "Corso Agenti OAM" },
            { id: "codoampv%", pattern: /^codOAMpv/i, label: "Corso Prova Valutativa OAM" },
            { id: "codoam30%", pattern: /^codOAM(?!a|pv)/i, label: "Corso aggiornamento OAM 30" },
            { id: "codoam15%", pattern: /^codOAM(?!a|pv)/i, label: "Corso aggiornamento OAM 15" },
            { id: "codoam45%", pattern: /^codOAM(?!a|pv)/i, label: "Corso aggiornamento OAM 45" },

            { id: "codprivacy%", pattern: /^codPrivacy/i, label: "Corso Privacy" },
            { id: "codtrasp%", pattern: /^codTrasparenza/i, label: "Corso Trasparenza" },

            { id: "codsi%", pattern: /^codsi|^codsic/i, label: "Sicurezza Lavoro" },
            { id: "codre%", pattern: /^codrespantiric/i, label: "Responsabile Antiriciclaggio" }
        ];

        const groups = {};

        for (const c of allCodes) {
            for (const g of GROUPS) {
                if (g.pattern.test(c)) {
                    if (!groups[g.id]) {
                        groups[g.id] = {
                            idcourse: g.id,
                            label: g.label,
                            codes: []
                        };
                    }
                    groups[g.id].codes.push(c);
                }
            }
        }

        const rows = Object.values(groups);

        console.log("✅ Corsi raggruppati:", rows);

        return res.json({ rows });

    } catch (err) {
        console.error("❌ ERR /convenzione/corsi:", err);
        res.status(500).json({ error: err.message });
    }
});

// /report/convenzione
router.get("/convenzione", requireConv, async (req, res) => {
    try {
        const { conv } = req;
        const { from, to, idcourse } = req.query;

        if (!from || !to || !idcourse)
            return res.status(400).json({ error: "from/to/idcourse obbligatori" });
        if (!from) {
            from = "2000-01-01";
            console.log("📆 from NON specificato → imposto 2000-01-01");
        }
        // 1️⃣ Espando i codici reali
        const expandedCodes = await expandCodes(idcourse);


        if (!expandedCodes.length)
            return res.json({ rows: [], total: 0 });


        // 2️⃣ DB da interrogare
        let DBS = ["formazionein", "newformazionein", "forma4"];

        // 🚨 caso speciale RB Academy / formazionecondorb
        const isAmm = /^codAmm(?!Agg)/i.test(idcourse);
        const isAmmAgg = /^codAmmAgg/i.test(idcourse);
        const isCodRev = /^codRev/i.test(idcourse);

        if (isAmm || isAmmAgg || isCodRev) {
            console.log("🎯 Rilevato gruppo AMM / AMMAGG → uso SOLO formazionecondorb");
            DBS = ["formazionecondorb"];
        }
        let finalRows = [];

        for (const db of DBS) {
            console.log("🗄️ Interrogo DB:", db);

            const conn = await getConnection(db);

            const sql = `
                SELECT 
                    cu.idUser      AS iduser,
                    cu.idCourse    AS idcourse,
                    u.idst         AS id,
                    u.lastname     AS last_name,
                    u.firstname    AS first_name,
                    u.email,
                    cf_cf.user_entry AS cf,
                    cu.date_inscr,
                    cu.date_complete,
                    u.lastenter
                FROM learning_courseuser cu
                JOIN core_user u 
                    ON u.idst = cu.idUser
                JOIN learning_course c
                    ON c.idCourse = cu.idCourse

                -- JOIN CF
                LEFT JOIN core_field_userentry cf_cf
                    ON cf_cf.id_user = u.idst
                    AND cf_cf.id_common = 23

                -- JOIN CONVENZIONE
                LEFT JOIN core_field_userentry cf_conv
                    ON cf_conv.id_user = u.idst
                    AND cf_conv.id_common = 25

                WHERE cu.date_inscr BETWEEN ? AND ?
                AND cf_conv.user_entry = ?
                AND c.code IN (?)
                ORDER BY cu.date_inscr DESC
            `;

            const [rows] = await conn.query(sql, [
                from,
                to,
                conv.nome_convenzione,
                expandedCodes
            ]);

            console.log(`📦 ${db} → trovati ${rows.length} utenti`);
            finalRows = finalRows.concat(
                rows.map(r => ({
                    ...r,
                    source_db: db   // <<<<< aggiungi questo
                }))
            );
        }

        console.log("➡️ TOTALE UTENTI:", finalRows.length);

        // 3️⃣ Mappa stato/percentuale
        const mapped = finalRows.map(r => {
            let stato = "Iscritto";
            let percent = 0;

            if (r.date_complete) {
                percent = 100;
                stato = "Completato";
            }
            else if (r.lastenter) {
                percent = 50;
                stato = "In corso";
            }

            return { ...r, percent, stato };
        });

        return res.json({
            rows: mapped,
            total: mapped.length
        });

    } catch (err) {
        console.error("❌ ERR /convenzione:", err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Espande un ID corso di gruppo (es: cod60%, codAmm%, codAmmAgg%)
 * restituendo i codici reali trovati nei db.
 */
async function expandCodes(idcourse, connAmm) {
    let result = new Set();

    // 🔥 LISTA ESTENDIBILE → metti qui nuovi corsi AMM
    const AMM_PATTERNS = [
        /^codamm\d*/i,          // codAmm33, codAmm24 …
        /^codammagg\d*/i,       // codAmmAgg33 …
        /^codtestamm\d*/i,      // codTestAmm33 …
        /^codtestammagg\d*/i,
        /^codrev\d*/i,
        // codTestAmmAgg33 …
        // 👉 AGGIUNGI QUI IL TUO NUOVO CORSO:
        // /^codammxyz\d*/i
    ];

    const isAMM = AMM_PATTERNS.some(rx => rx.test(idcourse));

    // 1️⃣ Corsi AMM → ricerca SOLO in formazionecondorb
    if (isAMM) {

        const likeValue = idcourse.replace("%", "") + "%";
        const connAmm = await getConnection("formazionecondorb");


        const [corsibase] = await connAmm.query(
            "SELECT code FROM learning_course WHERE code LIKE ?",
            [likeValue]
        );

        corsibase.forEach(r => result.add(r.code));

        // 1b️⃣ Cerca i test corrispondenti: codTestAmm%% e codTestAmmAgg%%
        const [test] = await connAmm.query(
            "SELECT code FROM learning_course WHERE code LIKE ?",
            [
                idcourse.startsWith("codammagg")
                    ? "codTestAmmAgg%"
                    : "codTestAmm%"
            ]
        );

        test.forEach(r => result.add(r.code));

        return Array.from(result);
    }

    // 2️⃣ Tutti gli altri corsi → logica classica su 3 DB
    const DBS = ["formazionein", "newformazionein", "forma4"];

    for (const db of DBS) {
        const conn = await getConnection(db);

        const [rows] = await conn.query(
            "SELECT code FROM learning_course WHERE code LIKE ?",
            [idcourse]
        );

        rows.forEach(r => result.add(r.code));
    }

    let arr = Array.from(result);

    // 3️⃣ Regole speciali già previste

    // cod60% → solo corsi 60 ore BASE, niente agg, niente test
    if (idcourse === "cod60%") {
        arr = arr.filter(c =>
            !/agg/i.test(c) &&
            !/test$/i.test(c)
        );
    }

    // cod60%agg → solo corsi 60 ore aggiornamento
    if (idcourse === "cod60%agg") {
        arr = arr.filter(c => /agg/i.test(c));
    }

    return arr;
}
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
        const conn = await getConnection(dbName);
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
            landscape: true,
            printBackground: true,
            displayHeaderFooter: true,
            margin: { top: "40px", bottom: "60px", left: "20px", right: "20px" },
            headerTemplate: "<div></div>", // nessun header fisso (solo nel contenuto HTML principale)
            footerTemplate: `
    <div style="
      width: 100%;
      font-size: 9px;
      color: #444;
      padding: 6px 20px;
      border-top: 1px solid #ddd;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: Arial, sans-serif;
    ">
      <div style="width:80%">
        ${footerHtml}
      </div>
      <div style="text-align:right;width:20%">
        Pagina <span class="pageNumber"></span> / <span class="totalPages"></span>
      </div>
    </div>
  `,
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
        const conn = await getConnection(dbName);

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