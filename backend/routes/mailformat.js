const express = require("express");
const router = express.Router();
const { getConnection } = require("../dbManager");
const { logwrite } = require("../utils/helper");

/**
 * 📋 Elenco formati raggruppati per categoria
 */
router.get("/list", async (req, res) => {
    const conn = await getConnection("wpacquisti");
    try {
        const [rows] = await conn.query(`
            SELECT meta_key, cat
            FROM impostazioni
            WHERE cat IS NOT NULL
            ORDER BY cat ASC, meta_key ASC
        `);

        // Raggruppa per categoria
        const grouped = rows.reduce((acc, row) => {
            if (!acc[row.cat]) acc[row.cat] = [];
            acc[row.cat].push(row.meta_key);
            return acc;
        }, {});

        res.json({ success: true, data: grouped });
    } catch (err) {
        logwrite("Errore /mailformat/list: " + err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 📖 Recupera il contenuto HTML di un format
 */
router.get("/:key", async (req, res) => {
    const { key } = req.params;
    const conn = await getConnection("wpacquisti");
    try {
        const [rows] = await conn.query(
            "SELECT meta_value FROM impostazioni WHERE meta_key = ? LIMIT 1",
            [key]
        );
        if (!rows.length) return res.status(404).send("");
        res.type("html").send(rows[0].meta_value || "");
    } catch (err) {
        logwrite("Errore getMailFormat: " + err.message);
        res.status(500).send("Errore interno");
    }
});


/**
 * ➕ Crea un nuovo template
 * Body: { key, category }
 */
router.post("/new", async (req, res) => {
    const { key, category } = req.body;
    if (!key) return res.status(400).json({ success: false, error: "Chiave mancante" });

    const conn = await getConnection("wpacquisti");
    try {
        const [exists] = await conn.query("SELECT 1 FROM impostazioni WHERE meta_key = ?", [key]);
        if (exists.length)
            return res.json({ success: false, error: "Esiste già un template con questa chiave" });

        await conn.query(
            "INSERT INTO impostazioni (meta_key, meta_value, cat) VALUES (?, '<p>Nuovo template</p>', ?)",
            [key, category || "Custom"]
        );

        res.json({ success: true, message: "Nuovo template creato" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
/**
 * 💾 Salva (update/insert) un format HTML
 */
router.post("/:key", express.text({ type: "*/*" }), async (req, res) => {
    const { key } = req.params;
    const html = req.body;
    const conn = await getConnection("wpacquisti");
    try {
        await conn.query(
            `
            INSERT INTO impostazioni (meta_key, meta_value)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)
            `,
            [key, html]
        );
        res.json({ success: true, message: "Formato aggiornato correttamente" });
    } catch (err) {
        logwrite("Errore updateMailFormat: " + err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;