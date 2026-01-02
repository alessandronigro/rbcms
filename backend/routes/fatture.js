// routes/fatture.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const https = require("https");
const url = require("url");
const archiver = require("archiver");
const { execFile } = require("child_process");
const { parseFatturaPA } = require("../utils/fatturaPA-parser");
const { fetchInvoiceXmlFromAruba } = require("../utils/arubaClient");
const router = express.Router();
const { getConnection } = require("../dbManager");

const rendererXslPath = path.join(__dirname, "..", "public", "fatture", "fatturaPA_v1.2.1.xsl");

async function transformWithXslt(xmlPath) {
    return new Promise((resolve, reject) => {
        execFile("xsltproc", [rendererXslPath, xmlPath], { maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                console.error("xsltproc stderr:", stderr);
                return reject(err);
            }
            resolve(stdout);
        });
    });
}

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

function logFatture(message) {
    try {
        const logPath = joinPublic("fatture", "fatturelog.log");
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, "utf-8");
    } catch (err) {
        console.warn("⚠️ Impossibile scrivere log fatture:", err.message);
    }
}

function sanitizeFileName(name, fallback = "attachment") {
    const trimmed = (name || "").toString().trim();
    const base = path.basename(trimmed).replace(/[\\/:*?"<>|]/g, "_");
    return base || fallback;
}

async function downloadUrl(urlString, headers = {}) {
    const parsed = url.parse(urlString);
    const options = {
        hostname: parsed.hostname,
        path: parsed.path,
        method: "GET",
        headers,
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (apiRes) => {
            const chunks = [];
            apiRes.on("data", (chunk) => chunks.push(chunk));
            apiRes.on("end", () => resolve(Buffer.concat(chunks)));
        });
        req.on("error", reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error("Timeout"));
        });
        req.end();
    });
}

function looksLikeHtmlOrNotFound(buffer) {
    const text = buffer.toString("utf-8").trim().slice(0, 200).toLowerCase();
    return (
        text.includes("<html") ||
        text.includes("<!doctype html") ||
        text.includes("file not found") ||
        text.includes("404")
    );
}

function looksLikeXml(buffer) {
    const text = buffer.toString("utf-8").trim().slice(0, 200);
    return text.startsWith("<") || text.startsWith("<?xml");
}

function isInvalidXmlPlaceholder(filePath) {
    try {
        if (!fs.existsSync(filePath)) return true;
        const buf = fs.readFileSync(filePath);
        if (!buf.length) return true;
        if (looksLikeHtmlOrNotFound(buf)) return true;
    } catch (err) {
        return true;
    }
    return false;
}

async function downloadInvoiceFile(invoice, src, filexml) {
    // 1) tenta downloadXml
    const xmlUrl = `https://fattura.gecotechsrl.it/fatturapa/interscambio/downloadXml?user=${src.sdi_user}&piva=${src.sdi_piva}&filename=${encodeURIComponent(filexml)}`;
    try {
        const buf = await downloadUrl(xmlUrl, { "Content-Type": "application/json" });
        if (buf && buf.length && !looksLikeHtmlOrNotFound(buf)) {
            return { buffer: buf, source: "downloadXml" };
        }
    } catch (err) {
        console.warn(`⚠️ downloadXml fallita (${filexml}): ${err.message}`);
    }

    // 2) fallback: download by id (potrebbe restituire p7m o HTML)
    const fileUrl = `https://fattura.gecotechsrl.it/fatturapa/interscambio/download/${invoice.id}?user=${src.sdi_user}&piva=${src.sdi_piva}`;
    try {
        const buf = await downloadUrl(fileUrl);
        if (buf && buf.length) {
            return { buffer: buf, source: "download" };
        }
    } catch (err) {
        console.warn(`⚠️ download fallback fallita (${invoice.id}): ${err.message}`);
    }

    throw new Error("Impossibile scaricare il file fattura");
}

function buildSyncStartDate(reference = new Date()) {
    if (reference.getMonth() === 0) {
        return `${reference.getFullYear() - 1}-01-01T11:05Z`;
    }
    const month = String(reference.getMonth()).padStart(2, "0");
    return `${reference.getFullYear()}-${month}-01T11:05Z`;
}

async function fetchListFromGecotech(apiUrl) {
    const parsedUrl = url.parse(apiUrl);
    const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.path,
        method: "GET",
        headers: { "Content-Type": "application/json" },
    };

    const data = await new Promise((resolve, reject) => {
        const req = https.request(options, (apiRes) => {
            const chunks = [];
            apiRes.on("data", (chunk) => chunks.push(chunk));
            apiRes.on("end", () => resolve(Buffer.concat(chunks)));
        });
        req.on("error", reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error("Timeout"));
        });
        req.end();
    });

    const text = data.toString("utf-8").trim();
    try {
        return JSON.parse(text);
    } catch (err) {
        const snippet = text.slice(0, 400).replace(/\s+/g, " ");
        console.error(`⚠️ Risposta non JSON da Gecotech (${apiUrl}): ${snippet}`);
        throw new Error("Risposta inattesa da Gecotech; controlla il log completo.");
    }
}

function parseDbAmount(value) {
    const sanitized = String(value || "").replace(",", ".");
    const num = Number(sanitized);
    return Number.isFinite(num) ? num : 0;
}

async function fetchPlainXmlBuffer(filexml, src) {
    try {
        const xmlUrl = `https://fattura.gecotechsrl.it/fatturapa/interscambio/downloadXml?user=${src.sdi_user}&piva=${src.sdi_piva}&filename=${encodeURIComponent(filexml)}`;
        const buffer = await downloadUrl(xmlUrl, { "Content-Type": "application/json" });
        const payload = buffer.toString("utf-8");
        try {
            const parsed = JSON.parse(payload);
            if (parsed?.file) return Buffer.from(parsed.file, "base64");
            if (typeof parsed === "string") return Buffer.from(parsed, "base64");
        } catch (err) {
            // non JSON, continue below
        }

        const trimmed = payload.trim();
        const base64Regex = /^[A-Za-z0-9+/=\n\r]+$/;
        if (trimmed && base64Regex.test(trimmed)) {
            return Buffer.from(trimmed, "base64");
        }

        return Buffer.from(payload, "utf-8");
    } catch (err) {
        console.warn(`⚠️ downloadXml fallita per ${filexml}: ${err.message}`);
        return null;
    }
}

async function ensureInvoiceRecord(invoice, src, conn, folderPath) {
    const filename = invoice.filename;
    const filePath = path.join(folderPath, filename);
    const baseName = path
        .basename(filename, path.extname(filename))
        .replace(/\.xml$/i, "");
    const filexml = `${baseName}.xml`;
    const filehtml = `${baseName}.html`;
    const tipoDoc = invoice.invoices?.[0]?.type || "TD01";
    const numeroFattura = invoice.invoices?.[0]?.number || "";
    const intestatario = invoice.sender?.description || "";
    const legacyXmlName = filename.replace(".p7m", ".xml");
    const normalizeXmlName = (value) => {
        if (!value) return "";
        const trimmed = String(value).trim();
        if (!trimmed) return "";
        const base = path.basename(trimmed).replace(/\.p7m$/i, "").replace(/\.xml$/i, "");
        return `${base}.xml`;
    };
    const xmlCandidates = [
        path.join(folderPath, filexml),
        path.join(folderPath, legacyXmlName),
        path.join(folderPath, `${baseName}.xml.p7m`),
        path.join(folderPath, filename),
    ];

    logFatture(
        `Gecotech -> file=${filename}, numero=${numeroFattura}, intestatario=${intestatario}, id=${invoice.id}, lastUpdate=${invoice.lastUpdate}`,
    );

    const candidateXmlNames = Array.from(
        new Set(
            [
                filexml,
                legacyXmlName,
                normalizeXmlName(filename),
                normalizeXmlName(filexml),
                normalizeXmlName(legacyXmlName),
                filename,
                filename.replace(/\.p7m$/i, ".xml"),
                `${baseName}.xml.p7m`,
            ].filter(Boolean),
        ),
    );
    const candidateLowerXml = Array.from(new Set(candidateXmlNames.map((n) => n.toLowerCase())));

    const lookupClauses = [];
    const params = [];
    if (candidateXmlNames.length) {
        // Usa confronto case-sensitive per evitare collisioni tra filename diversi solo per maiuscole/minuscole
        lookupClauses.push(`BINARY xml IN (${candidateXmlNames.map(() => "?").join(",")})`);
        params.push(...candidateXmlNames);
    }
    if (candidateLowerXml.length) {
        lookupClauses.push(`LOWER(xml) IN (${candidateLowerXml.map(() => "?").join(",")})`);
        params.push(...candidateLowerXml);
    }
    const numeroLower = (numeroFattura || "").trim().toLowerCase();
    const intestatarioLower = (intestatario || "").trim().toLowerCase();
    if (numeroLower && intestatarioLower) {
        lookupClauses.push("(LOWER(TRIM(numerofattura)) = ? AND LOWER(TRIM(intestatario)) = ?)");
        params.push(numeroLower, intestatarioLower);
    }

    const whereSql = lookupClauses.length ? lookupClauses.join(" OR ") : "0";
    const [existingRows] = await conn.query(
        `SELECT id, xml, nomeattachment, imponibile, IVA, importofattura, dataemissionefattura FROM ${src.table} 
         WHERE ${whereSql}
         LIMIT 1`,
        params,
    );
    const existing = existingRows[0];
    const attachmentNames = (existing?.nomeattachment || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    const attachmentsMissing = attachmentNames.some((att) =>
        !fs.existsSync(path.join(folderPath, att)),
    );
    const xmlValidExists = xmlCandidates.some((p) => fs.existsSync(p) && !isInvalidXmlPlaceholder(p));
    const needsDownload = !existing || !xmlValidExists || attachmentsMissing;
    const totalsAreZero = [
        existing?.imponibile,
        existing?.IVA,
        existing?.importofattura,
    ]
        .map(parseDbAmount)
        .every((value) => value === 0);
    const normalizeDateOnly = (value) => {
        if (!value) return "";
        const str = String(value).trim();
        const match = str.match(/\d{4}-\d{2}-\d{2}/);
        if (match) return match[0];
        const d = new Date(value);
        if (isNaN(d.getTime())) return "";
        return d.toISOString().slice(0, 10);
    };
    const existingXmlPath = xmlCandidates.find(
        (p) => fs.existsSync(p) && !isInvalidXmlPlaceholder(p) && !p.toLowerCase().endsWith(".p7m"),
    );
    const parsedExisting = existingXmlPath ? parseFatturaPA(existingXmlPath) : null;
    const xmlEmissione = parsedExisting?.dataDocumento || parsedExisting?.data || "";
    const dbDate = normalizeDateOnly(existing?.dataemissionefattura);
    const xmlDate = normalizeDateOnly(xmlEmissione);
    const dateMismatch = Boolean(existing && xmlDate && dbDate !== xmlDate);
    const shouldDownload = needsDownload || totalsAreZero;
    const shouldProcess = shouldDownload || dateMismatch;

    if (!shouldProcess) {
        console.log(`⏭️  Fattura già presente e file OK: ${numeroFattura} - ${intestatario}`);
        return { processed: false };
    }

    if (dateMismatch && !shouldDownload) {
        console.log(`🔁 Aggiorno data emissione da XML per ${numeroFattura}`);
    }

    if (totalsAreZero && !needsDownload) {
        console.log(`🔁 Ricalcolo importi da XML esistente per ${numeroFattura}`);
    }

    const plainXmlPath = path.join(folderPath, filexml);
    let fileData = null;
    let downloadSource = "";
    let xmlPlainBuffer = null;

    if (shouldDownload) {
        xmlPlainBuffer = await fetchPlainXmlBuffer(filexml, src);

        console.log(`📥 Download: ${filename}`);
        const downloadResult = await downloadInvoiceFile(invoice, src, filexml);
        fileData = downloadResult.buffer;
        downloadSource = downloadResult.source;
        fs.writeFileSync(filePath, fileData);
        console.log(`📁 Salvato ${filename} da ${downloadSource} in ${folderPath}`);

        // Se abbiamo un XML "pulito", salvalo; altrimenti, se il download è XML, usa quello
        if (xmlPlainBuffer && xmlPlainBuffer.length) {
            fs.writeFileSync(plainXmlPath, xmlPlainBuffer);
            console.log(`📄 Salvato XML pulito ${filexml}`);
        } else if (looksLikeXml(fileData)) {
            fs.writeFileSync(plainXmlPath, fileData);
            console.log(`📄 Salvato XML dal download ${filexml}`);
        }

        // 🛟 Fallback Aruba: se non abbiamo ancora un XML valido, prova a scaricarlo dalle API Aruba
        if (!fs.existsSync(plainXmlPath) || looksLikeHtmlOrNotFound(fs.readFileSync(plainXmlPath))) {
            try {
                console.log(`🛟 Aruba fallback attivato per ${numeroFattura} (${filename})`);
                logFatture(`Aruba fallback start -> file=${filexml} numero=${numeroFattura}`);
                const got = await fetchInvoiceXmlFromAruba({
                    invoiceNumber: numeroFattura,
                    invoiceFilename: filename,
                    outputPath: plainXmlPath,
                    invoiceDate: invoice.invoices?.[0]?.date || invoice.lastUpdate,
                });
                if (got) {
                    console.log(`🟢 Aruba fallback: scaricato XML per ${numeroFattura}`);
                    logFatture(`Aruba fallback OK -> file=${filexml} numero=${numeroFattura}`);
                } else {
                    console.warn(`⚠️ Aruba fallback: nessun XML trovato per ${numeroFattura}`);
                }
            } catch (err) {
                console.warn(`⚠️ Aruba fallback errore (${numeroFattura}): ${err.message}`);
            }
        }
    }
    let imponibile = 0;
    let iva = 0;
    let importo = 0;
    let nomeattachment = "";
    let savedAttachmentNames = [];

    let parseSource = null;
    if (fs.existsSync(plainXmlPath)) {
        parseSource = plainXmlPath;
    } else if (existingXmlPath) {
        parseSource = existingXmlPath;
    } else {
        parseSource = filePath;
    }
    const parsedData =
        parseSource === existingXmlPath && parsedExisting
            ? parsedExisting
            : parseFatturaPA(parseSource);
    logFatture(
        `XML parse -> file=${filexml} imp=${parsedData?.importi?.imponibile ?? "?"} iva=${parsedData?.importi?.iva ?? "?"} tot=${parsedData?.importi?.totale ?? "?"} allegati=${(parsedData?.allegati || []).join(",")}`,
    );

    // 📎 Estrae e salva gli allegati (se presenti nel XML)
    if (parsedData?.allegatiDettaglio?.length) {
        const attachmentPrefix = sanitizeFileName(baseName || path.basename(filename, path.extname(filename)), "fattura");
        parsedData.allegatiDettaglio.forEach((att, idx) => {
            if (!att?.base64) {
                console.warn(`   ⚠️  Allegato senza payload (${att?.nome || `#${idx + 1}`})`);
                return;
            }
            const cleanedName = sanitizeFileName(att.nome, `allegato_${idx + 1}`);
            const storedName = `${attachmentPrefix}__${cleanedName}`;
            const targetPath = path.join(folderPath, storedName);
            try {
                if (!fs.existsSync(targetPath)) {
                    fs.writeFileSync(targetPath, Buffer.from(att.base64, "base64"));
                    console.log(`   📎 Allegato salvato: ${storedName}`);
                } else {
                    console.log(`   📎 Allegato già presente: ${storedName}`);
                }
                savedAttachmentNames.push(storedName);
            } catch (err) {
                console.warn(`   ⚠️  Salvataggio allegato fallito (${storedName}): ${err.message}`);
            }
        });
    }

    if (parsedData && parsedData.importi) {
        imponibile = parsedData.importi.imponibile;
        iva = parsedData.importi.iva;
        importo = parsedData.importi.totale;
        console.log(
            `   💰 Importi estratti: €${importo.toFixed(2)} (Imp: €${imponibile.toFixed(
                2,
            )}, IVA: €${iva.toFixed(2)})`,
        );
    } else {
        console.warn("   ⚠️  Impossibile estrarre importi, uso valori a 0");
    }

    if (!savedAttachmentNames.length && parsedData?.allegati?.length) {
        // Nessun payload salvato ma presenti nomi allegati nel XML
        savedAttachmentNames = parsedData.allegati.map((name, idx) =>
            sanitizeFileName(name, `allegato_${idx + 1}`)
        );
    }
    if (savedAttachmentNames.length) {
        nomeattachment = savedAttachmentNames.join(", ");
    }

    const dataEmissione =
        parsedData?.dataDocumento ||
        parsedData?.data ||
        invoice.invoices?.[0]?.date ||
        invoice.lastUpdate;
    const symbol = tipoDoc === "TD04" ? "-" : "";

    const convertToMysqlDateTime = (dateStr) => {
        if (!dateStr) return null;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().slice(0, 19).replace("T", " ");
    };

    const escapeMySql = (str) => {
        if (!str) return "";
        return String(str).replace(/'/g, "''");
    };

    const values = [
        tipoDoc,
        convertToMysqlDateTime(dataEmissione),
        numeroFattura,
        escapeMySql(intestatario),
        `${symbol}${imponibile}`,
        `${iva}`,
        `${symbol}${importo}`,
        nomeattachment,
        convertToMysqlDateTime(invoice.lastUpdate),
        `<a target='blank' href='${src.folder}/${filexml}'>Fattura XML</a>`,
        filexml,
    ];

    logFatture(
        `DB write -> file=${filename} numero=${numeroFattura} imp=${imponibile} iva=${iva} tot=${importo} allegati=${nomeattachment}`,
    );

    if (existing && existing.id) {
        await conn.query(
            `UPDATE ${src.table} SET 
            tipodocumento = ?, 
            dataemissionefattura = ?, 
            numerofattura = ?, 
            intestatario = ?, 
            imponibile = ?, 
            IVA = ?, 
            importofattura = ?, 
            nomeattachment = ?, 
            sistemainterscambio = ?, 
            fatturaxml = ?, 
            xml = ?
            WHERE id = ?`,
            [...values, existing.id],
        );
    } else {
        await conn.query(
            `INSERT INTO ${src.table} 
            (tipodocumento, dataemissionefattura, numerofattura, intestatario, 
             imponibile, IVA, importofattura, nomeattachment, sistemainterscambio, 
             fatturaxml, xml) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            values,
        );
    }

    console.log(`✅ Fattura importata: ${filename}`);
    return { processed: true };
}

// -------- Helper: Sincronizza fatture in background
async function syncInvoicesInBackground(which, src) {
    try {
        const conn = await getConnection(src.dbName);

        // Calcola la data di inizio
        const startDate = buildSyncStartDate();
        const apiUrl = `https://fattura.gecotechsrl.it/fatturapa/interscambio/list/in?user=${src.sdi_user}&piva=${src.sdi_piva}&startDate=${startDate}&size=200`;
        const data = await fetchListFromGecotech(apiUrl);

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
                const result = await ensureInvoiceRecord(invoice, src, conn, folderPath);
                if (result.processed) {
                    processed++;
                }
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
        const folderPath = joinPublic("fatture", src.folder);

        const findActualFilename = (filename) => {
            if (!filename) return "";
            const safe = path.basename(filename);
            const full = path.join(folderPath, safe);
            if (fs.existsSync(full)) return safe;
            try {
                const target = safe.toLowerCase();
                const files = fs.readdirSync(folderPath);
                const match = files.find((f) => f.toLowerCase() === target || `${f.toLowerCase()}.p7m` === target);
                return match || safe;
            } catch {
                return safe;
            }
        };

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
             xml , fatturaxml , nomeattachment
      FROM ${src.table}
      ${whereSql}
      ORDER BY sistemainterscambio DESC, dataemissionefattura DESC, id DESC
      `,
            params
        );

        // normalizza: estrai filename da anchor (se il DB contiene <a href=...>)
        const extractFilename = (value) =>
            (value || "")
                .toString()
                .replace(/.*\/([^\/"']+)\s*["']?.*$/i, "$1");

        const buildLink = (type, filename, label) => {
            if (!filename) return "";
            const safeName = encodeURIComponent(filename);
            return `<a target='blank' href='/api/fatture/${which}/file/${type}/${safeName}'>${label}</a>`;
        };

        const data = (rows || []).map((r) => {
            const xmlFromDb = (r.xml || "").toString().trim();
            const xmlFromAnchor = extractFilename(r.fatturaxml);
            const xmlFileRaw = xmlFromDb || xmlFromAnchor;
            const xmlFile = findActualFilename(xmlFileRaw);
            const htmlFile = xmlFile ? `${path.basename(xmlFile, path.extname(xmlFile))}.html` : "";
            const xmlLink = buildLink("xml", xmlFile, "Fattura XML");
            const htmlLink = buildLink("html", findActualFilename(htmlFile), "Fattura HTML");
            const attachmentsFromNome = (r.nomeattachment || "")
                .toString()
                .split(",")
                .map((v) => extractFilename(v.trim()))
                .filter(Boolean);
            const allAttachments = Array.from(new Set([...attachmentsFromNome]));
            const attachmentsHtml = allAttachments
                .map((att) => {
                    const safeName = encodeURIComponent(att);
                    return `<a target='blank' href='/api/fatture/${which}/file/attachment/${safeName}'>${att}</a>`;
                })
                .join(", ");

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
                fatturaxml: xmlLink,
                fatturapdf: htmlLink, // compat per frontend: link HTML calcolato
                fatturahtml: htmlLink,
                nomeattachment: allAttachments.join(", "),
                allegati: allAttachments,
                allegati_html: attachmentsHtml || "",
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
      SELECT xml AS xml_file, nomeattachment
      FROM ${src.table}
      WHERE YEAR(dataemissionefattura)=? AND LPAD(MONTH(dataemissionefattura),2,'0')=?
      `,
            [Number(year), String(month).padStart(2, "0")]
        );

        const files = [];
        const clean = (v) => (v || "").toString().replace(/.*\/([^\/"']+)\s*["']?.*$/i, "$1");

        rows.forEach((r) => {
            const xml = r.xml_file ? r.xml_file.toString() : "";
            const html = xml ? `${path.basename(xml, path.extname(xml))}.html` : "";
            const attachmentsFromNome = (r.nomeattachment || "")
                .toString()
                .split(",")
                .map((v) => clean(v.trim()))
                .filter(Boolean);
            const attachments = Array.from(new Set([...attachmentsFromNome]));

            if (xml) files.push({ rel: path.join("fatture", src.folder, xml) });
            if (html) files.push({ rel: path.join("fatture", src.folder, html) });
            attachments.forEach((att) => {
                files.push({ rel: path.join("fatture", src.folder, att) });
            });
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
        const folderPath = joinPublic("fatture", folder);
        const rel =
            type === "xml" ? path.join(folderPath, safe)
                : type === "html" ? path.join(folderPath, safe)
                    : path.join(folderPath, safe); // fallback
        const candidates = [rel];
        if (!rel.toLowerCase().endsWith(".p7m")) {
            candidates.push(`${rel}.p7m`);
        }

        let existingPath = candidates.find((p) => fs.existsSync(p));

        // Se non trovato, prova match case-insensitive nel folder
        if (!existingPath) {
            try {
                const target = safe.toLowerCase();
                const targetBase = target.replace(/(\.xml|\.p7m|\.html)+$/g, "");
                const files = fs.readdirSync(folderPath);
                const match = files.find((f) => {
                    const lower = f.toLowerCase();
                    const lowerBase = lower.replace(/(\.xml|\.p7m|\.html)+$/g, "");
                    return (
                        lower === target ||
                        lower === `${target}.p7m` ||
                        `${lower}.p7m` === target ||
                        lowerBase === targetBase
                    );
                });
                if (match) existingPath = path.join(folderPath, match);
            } catch { /* ignore */ }
        }

        if (!existingPath) {
            const lower = safe.toLowerCase();
            // Evita errori console per riferimenti XSL/XSD non presenti negli XML
            if (lower.endsWith(".xsd") || lower.endsWith(".xsl")) {
                res.type("application/xml").status(200).send("");
                return;
            }
            return res.status(404).send("File non trovato");
        }
        // Per gli XML, rimuove l'xml-stylesheet per evitare richieste XSL/XSD mancanti e forzare il rendering
        if (type === "xml") {
            try {
                const raw = fs.readFileSync(existingPath, "utf-8");
                const cleaned = raw.replace(/<\?xml-stylesheet[^>]*\?>\s*/i, "");
                res.type("application/xml").send(cleaned);
                return;
            } catch {
                // fallback a sendFile se lettura fallisce
            }
        }
        res.sendFile(existingPath);
    } catch (err) {
        res.status(500).send("Errore lettura file");
    }
});

// -------- Renderizza XML in HTML al volo tramite XSL
router.get("/:which/render/:filename", async (req, res) => {
    try {
        const { which, filename } = req.params;
        const src = ensureSource(which);
        const safe = path.basename(filename);
        const folderPath = joinPublic("fatture", src.folder);
        const xmlBase = safe.toLowerCase().endsWith(".xml")
            ? safe
            : safe.replace(/\.p7m$/i, ".xml");
        const candidates = [
            path.join(folderPath, xmlBase),
            path.join(folderPath, safe),
            path.join(folderPath, safe.replace(/\.p7m$/i, ".xml")),
            path.join(folderPath, `${safe}.xml`),
        ];
        const existingPath = candidates.find((c) => fs.existsSync(c));
        if (!existingPath) return res.status(404).send("File XML non trovato");

        const fallbackHtml = () => {
            const parsed = parseFatturaPA(existingPath);
            const attachments = (parsed?.allegati || []).map((att) => `<li>${att}</li>`).join("") || "<li>– Nessun allegato –</li>";
            return `
                <!doctype html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>Fattura ${parsed?.numero || ""}</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 20px; }
                        h1 { font-size: 1.4rem; }
                        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
                        th, td { text-align: left; padding: 6px 8px; border: 1px solid #ddd; }
                    </style>
                </head>
                <body>
                    <h1>Fattura ${parsed?.numero || ""}</h1>
                    <div><strong>Data:</strong> ${parsed?.data || "-"}</div>
                    <div><strong>Importo totale:</strong> € ${Number(parsed?.importi?.totale || 0).toFixed(2)}</div>
                    <div><h2>Allegati</h2><ul>${attachments}</ul></div>
                </body>
                </html>
            `;
        };

        let html;
        try {
            html = await transformWithXslt(existingPath);
        } catch (err) {
            console.error("Errore render XML:", err);
            html = fallbackHtml();
        }

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(html);
    } catch (err) {
        console.error("Errore render XML:", err);
        res.status(500).send("Errore interno");
    }
});

// -------- Verifica se ci sono nuove fatture da sincronizzare
router.get("/:which/check-new", async (req, res) => {
    try {
        const { which } = req.params;
        const src = ensureSource(which);

        // Calcola la data di inizio (mese precedente o gennaio dell'anno precedente)
        const startDate = buildSyncStartDate();

        // Chiama l'API Gecotech
        const apiUrl = `https://fattura.gecotechsrl.it/fatturapa/interscambio/list/in?user=${src.sdi_user}&piva=${src.sdi_piva}&startDate=${startDate}&size=200`;
        const apiData = await fetchListFromGecotech(apiUrl);

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
        const startDate = buildSyncStartDate();
        const apiUrl = `https://fattura.gecotechsrl.it/fatturapa/interscambio/list/in?user=${src.sdi_user}&piva=${src.sdi_piva}&startDate=${startDate}&size=200`;

        console.log(`🔄 Sincronizzazione fatture ${which} da Gecotech...`);

        const data = await fetchListFromGecotech(apiUrl);

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
                const result = await ensureInvoiceRecord(invoice, src, conn, folderPath);
                if (result.processed) {
                    processed++;
                }
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
