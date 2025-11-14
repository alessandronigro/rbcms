const express = require("express");
const router = express.Router();
const { getConnection } = require("../dbManager");
const authAdmin = require("../middleware/authAdmin");

router.get("/stats", authAdmin, async (req, res) => {
    try {
        const { db = "forma4", mese } = req.query;
        const conn = await getConnection(db);

        const whereMese = mese ? `AND MONTH(date_inscr) = ${conn.escape(mese)}` : "";

        // 🔸 Filtro dinamico opzionale
        const filtroMese = mese && !isNaN(mese)
            ? `AND MONTH(u.date_inscr) = ${parseInt(mese)}`
            : "";

        // 📊 1️⃣ Iscritti / Itinere / Completati per mese corrente anno
        const [chart] = await conn.query(`
      SELECT 
        LPAD(mesi.mese_num, 2, '0') AS mese_num,
        mesi.mese_nome AS month,
        COUNT(u.idUser) AS iscritti,
        SUM(CASE WHEN u.status = 'inprogress' THEN 1 ELSE 0 END) AS itinere,
        SUM(CASE WHEN u.status = 'completed' THEN 1 ELSE 0 END) AS completati
      FROM (
        SELECT 1 AS mese_num, 'Gen' AS mese_nome UNION ALL
        SELECT 2, 'Feb' UNION ALL
        SELECT 3, 'Mar' UNION ALL
        SELECT 4, 'Apr' UNION ALL
        SELECT 5, 'Mag' UNION ALL
        SELECT 6, 'Giu' UNION ALL
        SELECT 7, 'Lug' UNION ALL
        SELECT 8, 'Ago' UNION ALL
        SELECT 9, 'Set' UNION ALL
        SELECT 10, 'Ott' UNION ALL
        SELECT 11, 'Nov' UNION ALL
        SELECT 12, 'Dic'
      ) mesi
      LEFT JOIN learning_courseuser u
        ON MONTH(u.date_inscr) = mesi.mese_num
        AND YEAR(u.date_inscr) = YEAR(CURDATE()) ${whereMese}
      GROUP BY mesi.mese_num, mesi.mese_nome
      ORDER BY mesi.mese_num;
    `);

        // 🎓 2️⃣ Completati per corso nel mese o anno corrente
        const [corsi] = await conn.query(`
      SELECT 
        c.name AS corso,
        COUNT(u.idUser) AS completati
      FROM learning_courseuser u
      JOIN learning_course c ON c.idCourse = u.idCourse
      WHERE u.status = 'completed'
        AND YEAR(u.date_complete) = YEAR(CURDATE())
        ${filtroMese}
      GROUP BY c.idCourse, c.name
      ORDER BY completati DESC;
    `);

        // ⏰ 3️⃣ Scadenze prossime (entro 15 giorni)
        const [scadenze] = await conn.query(`
  SELECT COUNT(*) AS tot
  FROM learning_courseuser
  WHERE date_expire_validity BETWEEN CURDATE() AND LAST_DAY(CONCAT(YEAR(CURDATE()), '-12-31'));
`);

        res.json({
            success: true,
            chart,
            corsi,
            scadenze: scadenze[0]?.tot || 0,
        });
    } catch (err) {
        console.error("❌ Errore /api/admin/stats:", err);
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

module.exports = router;