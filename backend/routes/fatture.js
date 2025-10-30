// routes/fatture.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const archiver = require("archiver");
const router = express.Router();
const { getConnection } = require("../dbManager");

// Mappatura fonti (DB, tabella, cartella file, credenziali SDI)
const SOURCES = {
    ricevute: {
        label: "RB Consulenza",
        hostKey: "SITE",
        dbName: "newformazione",
        table: "fatturericevute",
        folder: "fatturericevute",
        sdi_user: "rbconsulting",
        sdi_piva: "05744121210",
    },
    ricevutenew: {
        label: "RB Intermediari",
        hostKey: "SITE",
        dbName: "newformazione",
        table: "fatturericevutenew",
        folder: "fatturericevutenew",
        sdi_user: "newrbconsulting",
        sdi_piva: "17044041006",
    },
};

// -------- Helpers
function ensureSource(which) {
    const src = SOURCES[which];
    if (!src) throw new Error(`Fonte non valida: ${which}`);
    return src;
}
function joinPublic(...p) {
    return path.join(process.cwd(), "public", ...p);
}

// -------- LISTA con filtri mese/anno + totale
router.get("/:which", async (req, res) => {
    try {
        const { which } = req.params;
        const { month = "", year = "" } = req.query;
        const src = ensureSource(which);
        const conn = await getConnection(src.hostKey, src.dbName);

        const where = [];
        const params = [];
        if (year) {
            where.push("YEAR(dataemissionefattura)=?");
            params.push(Number(year));
        }
        if (month) {
            where.push("LPAD(MONTH(dataemissionefattura),2,'0')=?");
            params.push(String(month).padStart(2, "0"));
        }
        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

        const [rows] = await conn.query(
            `
      SELECT id, tipodocumento, sistemainterscambio, dataemissionefattura, numerofattura,
             intestatario, imponibile, IVA, importofattura, readfatt,
             xml , fatturapdf , fatturaxml , nomeattachment
      FROM ${src.table}
      ${whereSql}
      ORDER BY sistemainterscambio DESC, dataemissionefattura DESC, id DESC
      `,
            params
        );

        // normalizza: estrai filename da anchor (se il DB contiene <a href=...>)
        const clean = (v) => (v || "").toString().replace(/.*\/([^\/"']+)\s*["']?.*$/i, "$1");
        const data = (rows || []).map((r) => {
            const xmlFromAnchor = clean(r.xml_anchor);
            const htmlFromAnchor = clean(r.html_anchor);
            const xmlFile = r.xml_file || xmlFromAnchor;
            const htmlFile = htmlFromAnchor || (xmlFile ? (path.basename(xmlFile, path.extname(xmlFile)) + ".html") : "");

            return {
                id: r.id,
                tipodocumento: r.tipodocumento,
                sistemainterscambio: r.sistemainterscambio,
                dataemissionefattura: r.dataemissionefattura,
                numerofattura: r.numerofattura,
                intestatario: r.intestatario,
                imponibile: Number(String(r.imponibile).replace(",", ".") || 0),
                IVA: Number(String(r.IVA).replace(",", ".") || 0),
                importofattura: Number(String(r.importofattura).replace(",", ".") || 0),
                readfatt: r.readfatt ? 1 : 0,
                xml_file: xmlFile,
                html_file: htmlFile,
                nomeattachment: r.nomeattachment || "",
                folder: src.folder,
            };
        });

        const totale = data.reduce((acc, r) => acc + (r.importofattura || 0), 0);

        res.json({
            source: src.label,
            month: month || null,
            year: year || null,
            total: data.length,
            totale,
            rows: data,
            sdi_user: src.sdi_user,
            sdi_piva: src.sdi_piva,
        });
    } catch (err) {
        console.error("GET fatture ERR:", err);
        res.status(500).json({ error: err.message });
    }
});

// -------- Segna letta
router.patch("/:which/:id/read", async (req, res) => {
    try {
        const { which, id } = req.params;
        const src = ensureSource(which);
        const conn = await getConnection(src.hostKey, src.dbName);
        await conn.query(`UPDATE ${src.table} SET readfatt=1 WHERE id=?`, [id]);
        res.json({ success: true });
    } catch (err) {
        console.error("PATCH read ERR:", err);
        res.status(500).json({ error: err.message });
    }
});

// -------- Zip mensile (XML + HTML + Allegati se presenti)
router.post("/:which/zip", async (req, res) => {
    try {
        const { which } = req.params;
        const { month, year } = req.body || {};
        if (!month || !year) return res.status(400).json({ error: "month e year sono obbligatori" });

        const src = ensureSource(which);
        const conn = await getConnection(src.hostKey, src.dbName);
        const [rows] = await conn.query(
            `
      SELECT xml AS xml_file, fatturapdf AS html_anchor, nomeattachment
      FROM ${src.table}
      WHERE YEAR(dataemissionefattura)=? AND LPAD(MONTH(dataemissionefattura),2,'0')=?
      `,
            [Number(year), String(month).padStart(2, "0")]
        );

        const files = [];
        const clean = (v) => (v || "").toString().replace(/.*\/([^\/"']+)\s*["']?.*$/i, "$1");

        rows.forEach((r) => {
            const xml = r.xml_file ? r.xml_file.toString() : "";
            const html = clean(r.html_anchor);
            const att = clean(r.nomeattachment);

            if (xml) files.push({ rel: path.join("fatture", src.folder, xml) });
            if (html) files.push({ rel: path.join("fatture", src.folder, html) });
            if (att) files.push({ rel: path.join("fatture", src.folder, att) });
        });

        const zipName = `fatture_${which}_${year}-${String(month).padStart(2, "0")}.zip`;
        const zipPath = joinPublic("temp", zipName);
        fs.mkdirSync(path.dirname(zipPath), { recursive: true });

        const output = fs.createWriteStream(zipPath);
        const archive = archiver("zip", { zlib: { level: 9 } });
        archive.pipe(output);

        files.forEach((f) => {
            const abs = joinPublic(f.rel);
            if (fs.existsSync(abs)) archive.file(abs, { name: path.basename(abs) });
        });

        await archive.finalize();

        output.on("close", () => {
            res.json({ success: true, zip_url: `/public/temp/${zipName}`, count: files.length });
        });
    } catch (err) {
        console.error("POST zip ERR:", err);
        res.status(500).json({ error: err.message });
    }
});

// -------- Serve file XML/HTML (proxy sicuro)
router.get("/:which/file/:type/:filename", async (req, res) => {
    try {
        const { which, type, filename } = req.params;
        const src = ensureSource(which);
        const folder = src.folder;
        const safe = path.basename(filename);
        const rel =
            type === "xml" ? path.join("fatture", folder, safe)
                : type === "html" ? path.join("fatture", folder, safe)
                    : path.join("fatture", folder, safe); // fallback
        const full = joinPublic(rel);
        if (!fs.existsSync(full)) return res.status(404).send("File non trovato");
        res.sendFile(full);
    } catch (err) {
        res.status(500).send("Errore lettura file");
    }
});

module.exports = router;