const express = require("express");
const router = express.Router();
const { getConnection } = require("../dbManager");
const { logwrite } = require("../utils/helper");

const normalizeMetaKey = (value) => {
    if (!value) return "";
    return value.toString().trim().toLowerCase();
};

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
    const key = normalizeMetaKey(req.params.key);
    if (!key) return res.status(404).send("");
    const conn = await getConnection("wpacquisti");
    try {
        const [rows] = await conn.query(
            "SELECT meta_value FROM impostazioni WHERE LOWER(meta_key) = ? LIMIT 1",
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
    const normalizedKey = normalizeMetaKey(key);
    if (!normalizedKey) return res.status(400).json({ success: false, error: "Chiave mancante" });

    const conn = await getConnection("wpacquisti");
    try {
        const [exists] = await conn.query(
            "SELECT 1 FROM impostazioni WHERE LOWER(meta_key) = ?",
            [normalizedKey],
        );
        if (exists.length)
            return res.json({ success: false, error: "Esiste già un template con questa chiave" });

        await conn.query(
            "INSERT INTO impostazioni (meta_key, meta_value, cat) VALUES (?, '<p>Nuovo template</p>', ?)",
            [normalizedKey, category || "Custom"],
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
    const key = normalizeMetaKey(req.params.key);
    const html = req.body;
    if (!key) {
        return res.status(400).json({ success: false, error: "Chiave mancante" });
    }
    console.log("📥 /api/mailformat POST key:", key, "payload-length:", html?.length ?? 0);
    const conn = await getConnection("wpacquisti");
    try {
        const [existingRows] = await conn.query(
            "SELECT meta_key FROM impostazioni WHERE LOWER(meta_key) = ? LIMIT 1",
            [key],
        );
        if (existingRows.length) {
            const actualKey = existingRows[0].meta_key || key;
            await conn.query("UPDATE impostazioni SET meta_value = ? WHERE meta_key = ?", [
                html,
                actualKey,
            ]);
            console.log("✅ /api/mailformat POST aggiornato:", actualKey);
        } else {
            await conn.query("INSERT INTO impostazioni (meta_key, meta_value) VALUES (?, ?)", [key, html]);
            console.log("✅ /api/mailformat POST inserito:", key);
        }
        res.json({ success: true, message: "Formato aggiornato correttamente" });
    } catch (err) {
        logwrite("Errore updateMailFormat: " + err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get("/:key/subject", async (req, res) => {
    const key = normalizeMetaKey(req.params.key);
    if (!key) return res.status(404).json({ success: false, error: "Chiave mancante" });
    const conn = await getConnection("wpacquisti");
    try {
        const [rows] = await conn.query(
            "SELECT subject FROM impostazioni WHERE LOWER(meta_key) = ? LIMIT 1",
            [key]
        );
        if (!rows.length || rows[0].subject === undefined) {
            return res.json({ success: true, subject: "" });
        }
        return res.json({ success: true, subject: rows[0].subject || "" });
    } catch (err) {
        logwrite("Errore getSubject: " + err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/:key/subject", express.json(), async (req, res) => {
    const key = normalizeMetaKey(req.params.key);
    const subject = (req.body?.subject || "").toString();
    if (!key) return res.status(400).json({ success: false, error: "Chiave mancante" });
    const conn = await getConnection("wpacquisti");
    try {
        const [existingRows] = await conn.query("SELECT meta_key FROM impostazioni WHERE LOWER(meta_key) = ? LIMIT 1", [key]);
        if (existingRows.length) {
            const actualKey = existingRows[0].meta_key || key;
            await conn.query("UPDATE impostazioni SET subject = ? WHERE meta_key = ?", [subject, actualKey]);
        } else {
            await conn.query("INSERT INTO impostazioni (meta_key, subject) VALUES (?, ?)", [key, subject]);
        }
        res.json({ success: true, subject });
    } catch (err) {
        logwrite("Errore updateSubject: " + err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
