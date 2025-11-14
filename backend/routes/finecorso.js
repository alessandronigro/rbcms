const express = require("express");
const router = express.Router();
const { getConnection } = require("../dbManager");
const { logwrite } = require("../utils/helper");

// ✅ Aggiorna stato evasione attestato o note
router.post("/evaso", async (req, res) => {
    try {
        const { db, iduser, idcourse, evaso, note } = req.body;
        const conn = await getConnection(db);

        let sql;

        // 🟢 Caso note (evaso = 2)
        if (evaso == 2) {
            sql = `
        UPDATE learning_certificate_assign 
        SET note = ? 
        WHERE id_user = ? AND id_course = ?
      `;
            await conn.query(sql, [note || "", iduser, idcourse]);
            return res.json({ success: true, message: "Modifica note!" });
        }

        // 🟢 Caso evaso = 1 o 0
        const now = new Date().toISOString().slice(0, 19).replace("T", " ");
        if (evaso == 1) {
            sql = `
        UPDATE learning_certificate_assign 
        SET evaso = 1, data_invio = ?
        WHERE id_user = ? AND id_course = ?
      `;
            await conn.query(sql, [now, iduser, idcourse]);
        } else {
            sql = `
        UPDATE learning_certificate_assign 
        SET evaso = 0, data_invio = NULL
        WHERE id_user = ? AND id_course = ?
      `;
            await conn.query(sql, [iduser, idcourse]);
        }

        // 🔁 Casi speciali (aggiornamento multiplo per corsi collegati)
        const groupMap = {
            378: [286, 378, 373, 407, 408, 428, 429, 73, 74, 85, 86],
            373: [286, 378, 373, 407, 408, 428, 429, 73, 74, 85, 86],
            407: [286, 378, 373, 407, 408, 428, 429, 73, 74, 85, 86],
            428: [286, 378, 373, 407, 408, 428, 429, 73, 74, 85, 86],
            73: [286, 378, 373, 407, 408, 428, 429, 73, 74, 85, 86],
            85: [286, 378, 373, 407, 408, 428, 429, 73, 74, 85, 86],
            20: [20, 9],
            21: [21, 18],
            299: [296, 299],
            415: [414, 415],
        };

        const group = groupMap[idcourse];
        if (group) {
            const sqlGroup = `
        UPDATE learning_certificate_assign
        SET evaso = ?, data_invio = ${evaso == 1 ? `'${now}'` : "NULL"}
        WHERE id_user = ? AND id_course IN (${group.join(",")})
      `;
            await conn.query(sqlGroup, [evaso, iduser]);
        }

        return res.json({ success: true, message: "Attestato Evaso!" });
    } catch (err) {
        logwrite("❌ Errore Aggiorna finecorso: " + err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});
// GET /api/finecorso/list
router.get("/list", async (req, res) => {
    const { db, anno, cat, filter, idsessione } = req.query;

    try {
        const conn = await getConnection(db);

        // 🔹 Imposta anno di default
        const year = anno && anno !== "undefined" ? anno : new Date().getFullYear();

        // 🔹 Costruzione filtro categoria
        let strsql = "";
        if (cat && cat !== "Tutti") {
            switch (cat) {
                case "ivass":
                    strsql = `AND a.id_course NOT IN (
            SELECT idcourse FROM learning_course 
            WHERE code='cod6031' OR code LIKE '%OAM%' OR idcategory IN (10,12)
          )`;
                    break;
                case "oam":
                    strsql = `AND a.id_course IN (
            SELECT idcourse FROM learning_course WHERE idcategory IN (10,12)
          )
          AND a.id_course NOT IN (296,367,299,414,415)`;
                    break;
                case "ivass60":
                    strsql = `AND a.id_course IN (234,279,286,373,407,428)`;
                    break;
                case "oamservizi":
                    strsql = `AND a.id_course IN (296,367,299,414,415)`;
                    break;
                default:
                    break;
            }
        }

        // 🔹 Filtro evaso/inviato
        let evasoFilter = "";
        if (filter && filter !== "Tutti") {
            evasoFilter = `AND (a.evaso = ${conn.escape(filter)} ${filter === "0" ? "OR a.evaso IS NULL" : ""
                })`;
        }

        // 🔹 Query base
        const sql = `
      SELECT 
        CONCAT(a.id_user, '-', a.id_course) AS id,
        b.firstname,
        b.lastname,
        a.senddistaccate,
        a.sendintermediario,
        a.sendsedi,
        a.note,
        c.user_entry AS convenzione,
        d.name AS corso,
        d.code,
        a.on_date,
        a.evaso,
        a.data_invio,
        c.id_user,
        a.id_course,
        (
          SELECT date_inscr 
          FROM learning_courseuser 
          WHERE iduser = a.id_user 
          AND idcourse = a.id_course 
          LIMIT 1
        ) AS date_inscr
      FROM learning_certificate_assign a
      JOIN core_user b ON b.idst = a.id_user
      JOIN core_field_userentry c ON c.id_user = b.idst
      LEFT JOIN learning_course d ON d.idcourse = a.id_course
      WHERE a.id_course NOT IN (270,273)
        AND a.on_date BETWEEN '${year}-01-01 00:00:00' AND '${year}-12-31 23:59:59'
        AND c.id_common = 25
        ${strsql}
        ${evasoFilter}
      ORDER BY CAST(a.on_date AS DATETIME) DESC
    `;

        const [rows] = await conn.query(sql);
        res.json({ success: true, rows });
    } catch (err) {
        logwrite("❌ Errore getFineCorso: " + err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;