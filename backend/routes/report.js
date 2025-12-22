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

async function fetchFiscalCodes(conn, userIds = []) {
    const cfMap = new Map();
    if (!Array.isArray(userIds) || !userIds.length) return cfMap;

    const chunkSize = 500;
    for (let i = 0; i < userIds.length; i += chunkSize) {
        const chunk = userIds.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => "?").join(",");
        const sql = `
            SELECT id_user, user_entry
            FROM core_field_userentry
            WHERE id_common = 23
              AND id_user IN (${placeholders})
        `;
        const [rows] = await conn.query(sql, chunk);
        rows.forEach(row => cfMap.set(row.id_user, row.user_entry));
    }

    return cfMap;
}

async function fetchOrderRevenueMap(orderIds = []) {
    const map = new Map();
    if (!orderIds.length) return map;
    const conn = await getConnection("newformazione");
    const chunkSize = 250;
    for (let i = 0; i < orderIds.length; i += chunkSize) {
        const chunk = orderIds.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => "?").join(",");
        const [orderRows] = await conn.query(
            `
            SELECT order_id, fatturato
            FROM wp_woocommerce_rb_ordini
            WHERE order_id IN (${placeholders})
              AND (nome_convenzione IS NULL OR nome_convenzione = '' OR nome_convenzione = '-')
            `,
            chunk,
        );
        orderRows.forEach((order) => {
            map.set(String(order.order_id), order.fatturato);
        });
    }
    return map;
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
            { id: "codoam30%", pattern: /^codOAM30/i, label: "Corso aggiornamento OAM 30" },
            { id: "codoam15%", pattern: /^codOAM15/i, label: "Corso aggiornamento OAM 15" },
            { id: "codoam45%", pattern: /^codOAM45/i, label: "Corso aggiornamento OAM 45" },

            { id: "codprivacy%", pattern: /^codPrivacy/i, label: "Corso Privacy" },
            { id: "codtrasp%", pattern: /^codTrasparenza/i, label: "Corso Trasparenza" },

            { id: "codsi%", pattern: /^codsi|^codsic/i, label: "Sicurezza Lavoro" },
            { id: "codre%", pattern: /^codrespantiric/i, label: "Responsabile Antiriciclaggio" },
            { id: "codOAMsp%", pattern: /^codOAMsp/i, label: "Corso OAM prima formazione servizi di pagamento" },
            { id: "codOAM9%", pattern: /^codOAM9/i, label: "Corso OAM aggiornamento servizi di pagamento" },
            { id: "codOCFA%", pattern: /^codOCFA/i, label: "Corso di aggiornamento per consulente finanziario" },
            { id: "codOCFA15%", pattern: /^codOCFA15/i, label: "Corso di aggiornamento per consulente finanziario 15h" },
            { id: "codOCFP%", pattern: /^codOCFP/i, label: "Corso di preparazione per consulente finanziario" },


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
        const overallStart = Date.now();

        const iduserParam = req.query.iduser ? Number(req.query.iduser) : null;
        for (const db of DBS) {
            console.log("🗄️ Interrogo DB:", db);

            const conn = await getConnection(db);
            const queryStart = Date.now();

            const idClause = iduserParam ? "AND cu.idUser = ?" : "";
            const sql = `
                SELECT 
                    cu.idUser      AS iduser,
                    cu.idCourse    AS idcourse,
                    u.idst         AS id,
                    u.lastname     AS last_name,
                    u.firstname    AS first_name,
                    u.email,
                    cu.date_inscr,
                    cu.date_complete,
                    u.lastenter
                FROM learning_courseuser cu
                JOIN core_user u 
                    ON u.idst = cu.idUser
                JOIN learning_course c
                    ON c.idCourse = cu.idCourse

                -- JOIN CONVENZIONE
                LEFT JOIN core_field_userentry cf_conv
                    ON cf_conv.id_user = u.idst
                    AND cf_conv.id_common = 25

                WHERE cu.date_inscr BETWEEN ? AND ?
                AND cf_conv.user_entry = ?
                ${idClause}
                AND c.code IN (?)
                ORDER BY cu.date_inscr DESC
            `;
            const params = [from, to, conv.nome_convenzione];
            if (iduserParam) {
                params.push(iduserParam);
            }
            params.push(expandedCodes);

            console.log("🧾 Report convenzione query:", {
                db,
                sql: sql.trim(),
                params,
            });
            const [rows] = await conn.query(sql, params);
            const durationMs = Date.now() - queryStart;
            console.log(`⏱️ Query ${db} completata in ${(durationMs / 1000).toFixed(2)}s`);

            const uniqueUserIds = [...new Set(rows.map(r => r.id))];
            const cfStart = Date.now();
            const cfMap = await fetchFiscalCodes(conn, uniqueUserIds);
            console.log(`⏱️ CF lookup ${db} (${uniqueUserIds.length} utenti) in ${((Date.now() - cfStart) / 1000).toFixed(2)}s`);

            rows.forEach(r => {
                r.cf = cfMap.get(r.id) || null;
            });

            // conteggio oggetti aperti per utente/corso
            const openItemsCombos = Array.from(
                new Set(rows.map((row) => `${row.iduser}::${row.idcourse}`))
            )
                .map((combo) => {
                    const [iduser, idcourse] = combo.split("::");
                    return {
                        iduser: Number(iduser),
                        idcourse: Number(idcourse),
                    };
                })
                .filter((combo) => Number.isFinite(combo.iduser) && Number.isFinite(combo.idcourse));

            const openItemsMap = new Map();
            if (openItemsCombos.length) {
                const tuplePlaceholders = openItemsCombos.map(() => "(?, ?)").join(", ");
                const params = openItemsCombos.flatMap((combo) => [combo.iduser, combo.idcourse]);

                const [openItemsRows] = await conn.query(
                    `
                    SELECT 
                        a.idUser AS iduser,
                        b.idCourse AS idcourse,
                        COUNT(*) AS noggettiopen
                    FROM learning_commontrack a
                    JOIN learning_organization b ON a.idReference = b.idOrg
                    WHERE (a.idUser, b.idCourse) IN (${tuplePlaceholders})
                    GROUP BY a.idUser, b.idCourse
                    `,
                    params
                );

                openItemsRows.forEach((row) => {
                    const key = `${row.iduser}::${row.idcourse}`;
                    openItemsMap.set(key, Number(row.noggettiopen || 0));
                });
            }

            rows.forEach((r) => {
                const key = `${r.iduser}::${r.idcourse}`;
                if (!openItemsMap.has(key)) openItemsMap.set(key, 0);
                const openCount = openItemsMap.get(key);
                r.openItems = openCount;
                r.noggettiopen = openCount;
            });

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
            } else {
                const openObjects = Number(r.openItems ?? r.noggettiopen ?? 0);
                if (openObjects > 0) {
                    percent = openObjects;
                    stato = "In corso";
                } else {
                    percent = 0;
                    stato = "Iscritto";
                }
            }

            return { ...r, percent, stato };
        });

        const totalDurationSec = ((Date.now() - overallStart) / 1000).toFixed(2);
        console.log(`⏱️ Ricerca totale completata in ${totalDurationSec}s`);
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

    if (!arr.length) {
        const resolved = await resolveCodeById(idcourse);
        if (resolved.length) return resolved;
    }

    return arr;
}

async function resolveCodeById(idcourse) {
    if (!idcourse) return [];
    const numericId = parseInt(String(idcourse), 10);
    if (Number.isNaN(numericId)) return [];

    const DBS = ["formazionein", "newformazionein", "forma4"];
    for (const db of DBS) {
        const conn = await getConnection(db);
        const [rows] = await conn.query(
            "SELECT code FROM learning_course WHERE idcourse = ? LIMIT 1",
            [numericId]
        );
        if (rows.length && rows[0].code) {
            return [rows[0].code];
        }
    }

    return [];
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
                a.iduser,
                s.firstname,
                s.lastname,
                c.name,
                c.code,
                a.date_inscr,
                a.order_id,
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
        const uniqueOrderIds = [...new Set(rows.map(r => (r.order_id || "").toString().trim()).filter(Boolean))];
        const orderRevenueMap = await fetchOrderRevenueMap(uniqueOrderIds);
        const enrichedRows = rows.map((row) => {
            const normalizedOrderId = (row.order_id || "").toString().trim();
            return {
                ...row,
                order_id: normalizedOrderId,
                order_fatturato: normalizedOrderId ? orderRevenueMap.get(normalizedOrderId) ?? null : null,
            };
        });
        const corsistiCount = new Set(rows.map(r => r.iduser).filter(Boolean)).size;
        const totalRevenue = [...orderRevenueMap.values()].reduce(
            (sum, value) => sum + (parseFloat(value) || 0),
            0,
        );

        return res.json({ success: true, rows: enrichedRows, totalRevenue, corsistiCount });
    } catch (err) {
        console.error("❌ Errore /api/report/data:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 📊 API: /api/report/fatturato-ordini
 * Report ordini senza convenzione (nome_convenzione vuoto o "-")
 */
router.get("/fatturato-ordini", async (req, res) => {
    try {
        const monthParam = (req.query.month || "").toString().trim();
        if (!monthParam) {
            return res.status(400).json({ success: false, error: "Parametro month richiesto" });
        }

        const monthStart = dayjs(`${monthParam}-01`);
        if (!monthStart.isValid()) {
            return res.status(400).json({ success: false, error: "Mese non valido" });
        }

        const from = monthStart.startOf("month").format("YYYY-MM-DD 00:00:00");
        const to = monthStart.endOf("month").format("YYYY-MM-DD 23:59:59");
        const segments = splitRangeByDb(from, to);
        const targetSegments = segments.length
            ? segments
            : [{ range: [from, to], hostKey: "IFAD", dbName: process.env.MYSQL_FORMA4 }];

        const orderMap = new Map();
        const orderIds = new Set();
        const corsistiSet = new Set();
        const orderConn = await getConnection("newformazione");
        const [orderRows] = await orderConn.query(
            `
            SELECT
                order_id,
                billing_nome,
                billing_cognome,
                billing_email,
                nome_convenzione,
                fatturato,
                order_status,
                metodo_di_pagamento,
                date_ins
            FROM wp_woocommerce_rb_ordini
            WHERE order_id IS NOT NULL
              AND order_id <> ''
              AND (nome_convenzione IS NULL OR nome_convenzione = '' OR nome_convenzione = '-')
              AND order_status = 'completed'
              AND date_ins BETWEEN ? AND ?
            `,
            [from, to],
        );

        orderRows.forEach((order) => {
            const normalized = String(order.order_id || "").trim();
            if (!normalized) return;
            orderIds.add(normalized);
            orderMap.set(normalized, order);
        });

        if (!orderIds.size) {
            return res.json({
                success: true,
                rows: [],
                month: monthParam,
                from,
                to,
                total: 0,
                totalRevenue: 0,
                corsistiCount: 0,
            });
        }

        const orderAggregates = new Map();

        const idsArray = Array.from(orderIds);
        const chunkSize = 250;
        for (const target of targetSegments) {
            const conn = await getConnection(target.dbName);
            for (let i = 0; i < idsArray.length; i += chunkSize) {
                const chunk = idsArray.slice(i, i + chunkSize);
                const placeholders = chunk.map(() => "?").join(",");
                const [rows] = await conn.query(
                    `
                    SELECT
                        cu.order_id,
                        cu.date_inscr,
                        cu.iduser,
                        cu.idcourse,
                        c.code,
                        c.name,
                        u.firstname,
                        u.lastname,
                        u.email
                    FROM learning_courseuser cu
                    LEFT JOIN learning_course c ON c.idCourse = cu.idCourse
                    LEFT JOIN core_user u ON u.idst = cu.iduser
                    WHERE cu.order_id IN (${placeholders})
                `,
                    chunk,
                );

                rows.forEach((row) => {
                    const orderId = String(row.order_id || "").trim();
                    if (!orderId) return;
                    corsistiSet.add(row.iduser);

                    if (!orderAggregates.has(orderId)) {
                        orderAggregates.set(orderId, {
                            orderId,
                            enrollmentAt: row.date_inscr,
                            billingNome: row.firstname || "",
                            billingCognome: row.lastname || "",
                            billingEmail: row.email || "",
                            courseCodes: new Set(),
                            courseNames: new Set(),
                            sourceDbs: new Set(),
                            itemCount: 0,
                        });
                    }

                    const aggregate = orderAggregates.get(orderId);
                    aggregate.itemCount += 1;
                    aggregate.sourceDbs.add(target.dbName);
                    if (row.code) aggregate.courseCodes.add(row.code.trim());
                    if (row.name) aggregate.courseNames.add(row.name.trim());
                    if (new Date(row.date_inscr) < new Date(aggregate.enrollmentAt)) {
                        aggregate.enrollmentAt = row.date_inscr;
                    }
                });
            }
        }

        idsArray.forEach((orderId) => {
            if (!orderAggregates.has(orderId)) {
                const orderInfo = orderMap.get(orderId);
                orderAggregates.set(orderId, {
                    orderId,
                    enrollmentAt: orderInfo?.date_ins || "",
                    billingNome: orderInfo?.billing_nome || "",
                    billingCognome: orderInfo?.billing_cognome || "",
                    billingEmail: orderInfo?.billing_email || "",
                    courseCodes: new Set(),
                    courseNames: new Set(),
                    sourceDbs: new Set(),
                    itemCount: 0,
                });
            }
        });

        const output = [];
        for (const aggregate of orderAggregates.values()) {
            const orderInfo = orderMap.get(aggregate.orderId);
            if (!orderInfo) continue;

            output.push({
                orderId: aggregate.orderId,
                orderPlacedAt: orderInfo.date_ins || aggregate.enrollmentAt,
                enrollmentAt: aggregate.enrollmentAt,
                billingNome: orderInfo.billing_nome || aggregate.billingNome,
                billingCognome: orderInfo.billing_cognome || aggregate.billingCognome,
                billingEmail: orderInfo.billing_email || aggregate.billingEmail,
                paymentMethod: orderInfo.metodo_di_pagamento || "",
                orderStatus: orderInfo.order_status || "",
                fatturato: parseFloat(orderInfo.fatturato) || 0,
                nomeConvenzione: orderInfo.nome_convenzione || "",
                courseCodes: Array.from(aggregate.courseCodes).filter(Boolean),
                courseNames: Array.from(aggregate.courseNames).filter(Boolean),
                itemCount: aggregate.itemCount,
                sourceDbs: Array.from(aggregate.sourceDbs).filter(Boolean),
            });
        }

        output.sort((a, b) => new Date(b.enrollmentAt).getTime() - new Date(a.enrollmentAt).getTime());
        const totalRevenue = output.reduce((sum, row) => sum + (parseFloat(row.fatturato) || 0), 0);

        return res.json({
            success: true,
            rows: output,
            total: output.length,
            totalRevenue,
            month: monthParam,
            from,
            to,
            corsistiCount: corsistiSet.size,
        });
    } catch (err) {
        console.error("❌ Errore /api/report/fatturato-ordini:", err);
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
