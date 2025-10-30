
const express = require("express");
const router = express.Router();
const axios = require("axios");
const { getConnection } = require("../dbManager");
const authAdmin = require("../middleware/authAdmin");
router.get("/stats", authAdmin, async (req, res) => {
    try {
        if (!req.user || req.user.role !== "admin")
            return res.status(403).json({ error: "Unauthorized" });

        const { periodo = "M3" } = req.query;

        const months = {
            "M1": 1,
            "M3": 3,
            "M6": 6,
            "Y1": 12
        }[periodo] || 3;

        const conn = await getConnection("IFAD", "forma4");

        const [[{ iscritti }]] = await conn.query(`
            SELECT COUNT(*) AS iscritti FROM core_user
        `);

        const [[{ completati }]] = await conn.query(`
            SELECT COUNT(*) AS completati
            FROM learning_courseuser WHERE status='completed'
        `);

        const [chart] = await conn.query(`
            SELECT DATE_FORMAT(date_inscr,'%Y-%m') AS month,
                   COUNT(*) AS iscritti
            FROM learning_courseuser
            WHERE date_inscr >= DATE_SUB(NOW(), INTERVAL ${months} MONTH)
            GROUP BY YEAR(date_inscr), MONTH(date_inscr)
            ORDER BY month ASC
        `);

        const [[{ scadenze }]] = await conn.query(`
            SELECT COUNT(*) AS scadenze
            FROM learning_courseuser
            WHERE status=2
            AND date_complete <= DATE_SUB(NOW(), INTERVAL 23 MONTH)
        `);

        res.json({
            iscritti,
            completati,
            corsi: [],
            chart,
            scadenze
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Errore server" });
    }
});

module.exports = router;