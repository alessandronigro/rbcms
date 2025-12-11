// routes/fatture.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const archiver = require("archiver");
const router = express.Router();
const { getConnection } = require("../dbManager");
const { parseFatturaPA, formatAmount } = require("../utils/fatturaPA-parser");

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

// -------- Helper: Sincronizza fatture in background
async function syncInvoicesInBackground(which, src) {
    try {
        const conn = await getConnection(src.dbName);

        // Calcola la data di inizio
        const now = new Date();
        let startDate;
        if (now.getMonth() === 0) {
            startDate = `${now.getFullYear() - 1}-01-01T11:05Z`;
        } else {
            const month = String(now.getMonth()).padStart(2, '0');
            startDate = `${now.getFullYear()}-${month}-01T11:05Z`;
        }

        const apiUrl = `https://fattura.gecotechsrl.it/fatturapa/interscambio/list/in?user=${src.sdi_user}&piva=${src.sdi_piva}&startDate=${startDate}&size=100`;

        const https = require('https');
        const url = require('url');
        const parsedUrl = url.parse(apiUrl);

        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.path,
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        };

        const apiRequest = new Promise((resolve, reject) => {
            const req = https.request(options, (apiRes) => {
                let data = '';
                apiRes.on('data', chunk => data += chunk);
                apiRes.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Timeout'));
            });
            req.end();
        });

        const data = await apiRequest;

        if (!data.content || !Array.isArray(data.content)) {
            console.log(`📭 Nessuna fattura da sincronizzare per ${which}`);
            return { processed: 0, errors: 0 };
        }

        let processed = 0;
        let errors = 0;
        const folderPath = joinPublic("fatture", src.folder);

        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        for (const invoice of data.content) {
            try {
                const filename = invoice.filename;
                const filePath = path.join(folderPath, filename);

                // Estrai dati base prima del controllo duplicati
                const tipoDoc = invoice.invoices?.[0]?.type || 'TD01';
                const numeroFattura = invoice.invoices?.[0]?.number || '';
                const intestatario = invoice.sender?.description || '';

                // Verifica duplicati sia per XML che per numero fattura + intestatario
                const [existing] = await conn.query(
                    `SELECT COUNT(*) as count FROM ${src.table} 
                     WHERE xml = ? OR (numerofattura = ? AND intestatario = ?)`,
                    [filename.replace('.p7m', '.xml'), numeroFattura, intestatario]
                );

                if (existing[0].count > 0) {
                    console.log(`⏭️  Fattura già presente: ${numeroFattura} - ${intestatario}`);
                    continue;
                }

                console.log(`📥 Download fattura: ${filename}`);
                const fileUrl = `https://fattura.gecotechsrl.it/fatturapa/interscambio/download/${invoice.id}?user=${src.sdi_user}&piva=${src.sdi_piva}`;
                const fileUrlParsed = url.parse(fileUrl);

                const fileOptions = {
                    hostname: fileUrlParsed.hostname,
                    path: fileUrlParsed.path,
                    method: 'GET'
                };

                const fileData = await new Promise((resolve, reject) => {
                    const req = https.request(fileOptions, (apiRes) => {
                        const chunks = [];
                        apiRes.on('data', chunk => chunks.push(chunk));
                        apiRes.on('end', () => resolve(Buffer.concat(chunks)));
                    });
                    req.on('error', reject);
                    req.setTimeout(30000, () => {
                        req.destroy();
                        reject(new Error('Timeout'));
                    });
                    req.end();
                });

                fs.writeFileSync(filePath, fileData);

                // tipoDoc, numeroFattura e intestatario già estratti sopra
                const dataEmissione = invoice.invoices?.[0]?.date || invoice.lastUpdate;

                // Prova a parsare il XML per estrarre gli importi
                let imponibile = 0;
                let iva = 0;
                let importo = 0;
                let nomeattachment = '';

                const parsedData = parseFatturaPA(filePath);
                if (parsedData && parsedData.importi) {
                    imponibile = parsedData.importi.imponibile;
                    iva = parsedData.importi.iva;
                    importo = parsedData.importi.totale;
                    if (parsedData.allegati && parsedData.allegati.length > 0) {
                        nomeattachment = parsedData.allegati.join(', ');
                    }
                    console.log(`   💰 Importi estratti: €${importo.toFixed(2)} (Imp: €${imponibile.toFixed(2)}, IVA: €${iva.toFixed(2)})`);
                } else {
                    console.warn(`   ⚠️  Impossibile estrarre importi, uso valori a 0`);
                }

                const filexml = filename.replace('.p7m', '.xml');
                const filehtml = filename.replace('.p7m', '.html').replace('.xml', '.html');
                const symbol = tipoDoc === 'TD04' ? '-' : '';

                const convertToMysqlDateTime = (dateStr) => {
                    if (!dateStr) return null;
                    const d = new Date(dateStr);
                    if (isNaN(d.getTime())) return null;
                    return d.toISOString().slice(0, 19).replace('T', ' ');
                };

                const escapeMySql = (str) => {
                    if (!str) return '';
                    return String(str).replace(/'/g, "''");
                };

                await conn.query(
                    `INSERT INTO ${src.table} 
                    (tipodocumento, dataemissionefattura, numerofattura, intestatario, 
                     imponibile, IVA, importofattura, nomeattachment, sistemainterscambio, 
                     fatturapdf, fatturaxml, xml) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        tipoDoc,
                        convertToMysqlDateTime(dataEmissione),
                        numeroFattura,
                        escapeMySql(intestatario),
                        `${symbol}${imponibile}`,
                        `${iva}`,
                        `${symbol}${importo}`,
                        nomeattachment,
                        convertToMysqlDateTime(invoice.lastUpdate),
                        `<a target='blank' href='${src.folder}/${filehtml}'>Fattura HTML</a>`,
                        `<a target='blank' href='${src.folder}/${filexml}'>Fattura XML</a>`,
                        filexml
                    ]
                );

                processed++;
                console.log(`✅ Fattura importata: ${filename}`);

            } catch (err) {
                errors++;
                console.error(`❌ Errore importazione ${invoice.filename}:`, err.message);
            }
        }

        if (processed > 0) {
            console.log(`🔄 Sincronizzazione ${which}: ${processed} nuove fatture, ${errors} errori`);
        }

        return { processed, errors };

    } catch (err) {
        console.error(`❌ Errore sincronizzazione background ${which}:`, err.message);
        return { processed: 0, errors: 1 };
    }
}

// -------- LISTA con filtri mese/anno + totale (con sync automatica)
router.get("/:which", async (req, res) => {
    try {
        const { which } = req.params;
        const { month = "", year = "" } = req.query;
        const src = ensureSource(which);

        // 🔄 Sincronizza in background (non blocca la risposta)
        syncInvoicesInBackground(which, src).catch(err => {
            console.error(`⚠️ Sync background fallita per ${which}:`, err.message);
        });

        const conn = await getConnection(src.dbName);

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
        const conn = await getConnection(src.dbName);
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
        const conn = await getConnection(src.dbName);
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
            // Usa il backend URL dall'env o costruisci l'URL relativo
            const backendUrl = process.env.BACKEND_URL || '';
            const zipUrl = backendUrl ? `${backendUrl}/public/temp/${zipName}` : `/public/temp/${zipName}`;
            res.json({ success: true, zip_url: zipUrl, count: files.length });
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

// -------- Verifica se ci sono nuove fatture da sincronizzare
router.get("/:which/check-new", async (req, res) => {
    try {
        const { which } = req.params;
        const src = ensureSource(which);

        // Calcola la data di inizio (mese precedente o gennaio dell'anno precedente)
        const now = new Date();
        let startDate;
        if (now.getMonth() === 0) { // Gennaio
            startDate = `${now.getFullYear() - 1}-01-01T11:05Z`;
        } else {
            const month = String(now.getMonth()).padStart(2, '0');
            startDate = `${now.getFullYear()}-${month}-01T11:05Z`;
        }

        // Chiama l'API Gecotech
        const apiUrl = `https://fattura.gecotechsrl.it/fatturapa/interscambio/list/in?user=${src.sdi_user}&piva=${src.sdi_piva}&startDate=${startDate}&size=100`;

        const https = require('https');
        const url = require('url');
        const parsedUrl = url.parse(apiUrl);

        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.path,
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        };

        const apiRequest = new Promise((resolve, reject) => {
            const req = https.request(options, (apiRes) => {
                let data = '';
                apiRes.on('data', chunk => data += chunk);
                apiRes.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Timeout'));
            });
            req.end();
        });

        const apiData = await apiRequest;

        if (!apiData.content || !Array.isArray(apiData.content)) {
            return res.json({ hasNew: false, count: 0, total: 0 });
        }

        const conn = await getConnection(src.dbName);
        let newCount = 0;

        for (const invoice of apiData.content) {
            const [existing] = await conn.query(
                `SELECT COUNT(*) as count FROM ${src.table} WHERE xml = ?`,
                [invoice.filename]
            );
            if (existing[0].count === 0) {
                newCount++;
            }
        }

        res.json({
            hasNew: newCount > 0,
            count: newCount,
            total: apiData.content.length,
            source: src.label
        });

    } catch (err) {
        console.error("❌ Errore verifica nuove fatture:", err);
        res.status(500).json({ error: err.message });
    }
});

// -------- Sincronizza fatture da Gecotech
router.post("/:which/sync", async (req, res) => {
    try {
        const { which } = req.params;
        const src = ensureSource(which);
        const conn = await getConnection(src.dbName);

        // Calcola la data di inizio
        const now = new Date();
        let startDate;
        if (now.getMonth() === 0) {
            startDate = `${now.getFullYear() - 1}-01-01T11:05Z`;
        } else {
            const month = String(now.getMonth()).padStart(2, '0');
            startDate = `${now.getFullYear()}-${month}-01T11:05Z`;
        }

        const apiUrl = `https://fattura.gecotechsrl.it/fatturapa/interscambio/list/in?user=${src.sdi_user}&piva=${src.sdi_piva}&startDate=${startDate}&size=100`;

        console.log(`🔄 Sincronizzazione fatture ${which} da Gecotech...`);

        const https = require('https');
        const url = require('url');
        const parsedUrl = url.parse(apiUrl);

        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.path,
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        };

        const apiRequest = new Promise((resolve, reject) => {
            const req = https.request(options, (apiRes) => {
                let data = '';
                apiRes.on('data', chunk => data += chunk);
                apiRes.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Timeout'));
            });
            req.end();
        });

        const data = await apiRequest;

        if (!data.content || !Array.isArray(data.content)) {
            return res.json({
                success: true,
                message: "Nessuna fattura trovata",
                processed: 0
            });
        }

        let processed = 0;
        let errors = 0;
        const folderPath = joinPublic("fatture", src.folder);

        // Crea la cartella se non esiste
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        for (const invoice of data.content) {
            try {
                const filename = invoice.filename;
                const filePath = path.join(folderPath, filename);

                // Estrai dati base prima del controllo duplicati
                const tipoDoc = invoice.invoices?.[0]?.type || 'TD01';
                const numeroFattura = invoice.invoices?.[0]?.number || '';
                const intestatario = invoice.sender?.description || '';

                // Verifica duplicati sia per XML che per numero fattura + intestatario
                const [existing] = await conn.query(
                    `SELECT COUNT(*) as count FROM ${src.table} 
                     WHERE xml = ? OR (numerofattura = ? AND intestatario = ?)`,
                    [filename.replace('.p7m', '.xml'), numeroFattura, intestatario]
                );

                if (existing[0].count > 0) {
                    console.log(`⏭️  Fattura già presente: ${numeroFattura} - ${intestatario}`);
                    continue;
                }

                // Scarica il file XML
                console.log(`📥 Download: ${filename}`);
                const fileUrl = `https://fattura.gecotechsrl.it/fatturapa/interscambio/download/${invoice.id}?user=${src.sdi_user}&piva=${src.sdi_piva}`;
                const fileUrlParsed = url.parse(fileUrl);

                const fileOptions = {
                    hostname: fileUrlParsed.hostname,
                    path: fileUrlParsed.path,
                    method: 'GET'
                };

                const fileData = await new Promise((resolve, reject) => {
                    const req = https.request(fileOptions, (apiRes) => {
                        const chunks = [];
                        apiRes.on('data', chunk => chunks.push(chunk));
                        apiRes.on('end', () => resolve(Buffer.concat(chunks)));
                    });
                    req.on('error', reject);
                    req.setTimeout(30000, () => {
                        req.destroy();
                        reject(new Error('Timeout'));
                    });
                    req.end();
                });

                // Salva il file
                fs.writeFileSync(filePath, fileData);

                // tipoDoc, numeroFattura e intestatario già estratti sopra
                const dataEmissione = invoice.invoices?.[0]?.date || invoice.lastUpdate;

                // Prova a parsare il XML per estrarre gli importi
                let imponibile = 0;
                let iva = 0;
                let importo = 0;
                let nomeattachment = '';

                const parsedData = parseFatturaPA(filePath);
                if (parsedData && parsedData.importi) {
                    imponibile = parsedData.importi.imponibile;
                    iva = parsedData.importi.iva;
                    importo = parsedData.importi.totale;
                    if (parsedData.allegati && parsedData.allegati.length > 0) {
                        nomeattachment = parsedData.allegati.join(', ');
                    }
                    console.log(`   💰 Importi estratti: €${importo.toFixed(2)} (Imp: €${imponibile.toFixed(2)}, IVA: €${iva.toFixed(2)})`);
                } else {
                    console.warn(`   ⚠️  Impossibile estrarre importi, uso valori a 0`);
                }

                const filexml = filename.replace('.p7m', '.xml');
                const filehtml = filename.replace('.p7m', '.html').replace('.xml', '.html');

                const symbol = tipoDoc === 'TD04' ? '-' : '';

                const convertToMysqlDateTime = (dateStr) => {
                    if (!dateStr) return null;
                    const d = new Date(dateStr);
                    if (isNaN(d.getTime())) return null;
                    return d.toISOString().slice(0, 19).replace('T', ' ');
                };

                const escapeMySql = (str) => {
                    if (!str) return '';
                    return String(str).replace(/'/g, "''");
                };

                // Inserisci nel database
                await conn.query(
                    `INSERT INTO ${src.table} 
                    (tipodocumento, dataemissionefattura, numerofattura, intestatario, 
                     imponibile, IVA, importofattura, nomeattachment, sistemainterscambio, 
                     fatturapdf, fatturaxml, xml) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        tipoDoc,
                        convertToMysqlDateTime(dataEmissione),
                        numeroFattura,
                        escapeMySql(intestatario),
                        `${symbol}${imponibile}`,
                        `${iva}`,
                        `${symbol}${importo}`,
                        nomeattachment,
                        convertToMysqlDateTime(invoice.lastUpdate),
                        `<a target='blank' href='${src.folder}/${filehtml}'>Fattura HTML</a>`,
                        `<a target='blank' href='${src.folder}/${filexml}'>Fattura XML</a>`,
                        filexml
                    ]
                );

                processed++;
                console.log(`✅ Fattura importata: ${filename}`);

            } catch (err) {
                errors++;
                console.error(`❌ Errore importazione fattura ${invoice.filename}:`, err.message);
            }
        }

        res.json({
            success: true,
            message: `Sincronizzazione completata`,
            total: data.content.length,
            processed,
            errors,
            source: src.label
        });

    } catch (err) {
        console.error("❌ Errore sincronizzazione fatture:", err);
        res.status(500).json({
            error: err.message
        });
    }
});

module.exports = router;