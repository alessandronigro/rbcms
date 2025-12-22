/**
 * Client Aruba Fatturazione Elettronica - fallback per download XML fatture ricevute.
 */
const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

let cachedToken = null;
let cachedTokenTs = 0;
const TOKEN_TTL_MS = 50 * 60 * 1000; // 50 minuti

function logAruba(message) {
    try {
        const logPath = path.join(process.cwd(), "public", "fatture", "fatturelog.log");
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, "utf-8");
    } catch (err) {
        console.warn("⚠️ Aruba log write failed:", err.message);
    }
}

function extractFileBuffer(resData) {
    if (!resData) return null;
    try {
        const text = Buffer.isBuffer(resData) ? resData.toString("utf-8") : String(resData);
        try {
            const json = JSON.parse(text);
            const b64 = json.file || json.unsignedFile || json.base64 || json.FatturaBase64;
            if (b64) return Buffer.from(b64, "base64");
        } catch (e) {
            // not JSON, continue
        }
        const trimmed = text.trim();
        const base64Regex = /^[A-Za-z0-9+/=\n\r]+$/;
        if (trimmed && base64Regex.test(trimmed)) {
            return Buffer.from(trimmed, "base64");
        }
    } catch (err) {
        // ignore and fallback
    }
    return Buffer.isBuffer(resData) ? resData : Buffer.from(resData);
}

async function arubaAuthenticate() {
    if (!process.env.ARUBA_USERNAME || !process.env.ARUBA_PASSWORD) {
        throw new Error("Credenziali Aruba mancanti: imposta ARUBA_USERNAME e ARUBA_PASSWORD");
    }
    const now = Date.now();
    if (cachedToken && now - cachedTokenTs < TOKEN_TTL_MS) return cachedToken;

    const params = new URLSearchParams();
    params.append("grant_type", "password");
    params.append("username", process.env.ARUBA_USERNAME);
    params.append("password", process.env.ARUBA_PASSWORD);

    console.log("🔐 Aruba auth: signin...");
    logAruba("Aruba auth start");
    const res = await axios.post(`${process.env.ARUBA_AUTH_URL}/auth/signin`, params, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    cachedToken = res.data?.access_token;
    cachedTokenTs = Date.now();
    if (!cachedToken) throw new Error("Token Aruba non ricevuto");
    console.log("✅ Aruba auth OK");
    logAruba("Aruba auth OK");
    return cachedToken;
}

async function searchReceivedInvoices({ token, fromDate, toDate, page = 0, size = 50 }) {
    const res = await axios.get(`${process.env.ARUBA_API_URL}/services/invoice/in/find`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { fromDate, toDate, page, size },
    });
    return res.data;
}

async function downloadReceivedInvoiceXml({ token, invoiceId, outputPath }) {
    const res = await axios.get(`${process.env.ARUBA_API_URL}/services/invoice/in/download`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { id: invoiceId, formato: "XML" },
        responseType: "arraybuffer",
    });
    const buf = extractFileBuffer(res.data);
    fs.writeFileSync(outputPath, buf);
    return outputPath;
}

async function downloadReceivedInvoiceByFilename({ token, filename, outputPath }) {
    const res = await axios.get(`${process.env.ARUBA_API_URL}/services/invoice/in/getByFilename`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { filename, formato: "XML" },
        responseType: "arraybuffer",
        validateStatus: (status) => status === 200 || status === 404,
    });
    if (res.status === 404) {
        console.warn(`⚠️  Aruba getByFilename 404 per filename=${filename}`);
        return false;
    }
    const buf = extractFileBuffer(res.data);
    fs.writeFileSync(outputPath, buf);
    return true;
}

async function findReceivedByUsername({ token, username, page = 0, size = 100 }) {
    if (!username) throw new Error("username richiesto per findByUsername");
    const res = await axios.get(`${process.env.ARUBA_API_URL}/services/invoice/in/findByUsername`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { username, page, size },
    });
    return res.data;
}

/**
 * Trova una fattura per numero e ne scarica l'XML su disco.
 * Ritorna true se scaricata, false se non trovata.
 */
async function fetchInvoiceXmlFromAruba({
    invoiceNumber,
    invoiceFilename,
    outputPath,
    invoiceDate,
    daysBack = 120,
    pageSize = 100,
}) {
    if (!process.env.ARUBA_AUTH_URL || !process.env.ARUBA_API_URL) {
        console.warn("⚠️  Aruba non configurato (ARUBA_AUTH_URL / ARUBA_API_URL assenti)");
        return false;
    }
    const token = await arubaAuthenticate();

    const now = new Date();
    const baseDate = invoiceDate ? new Date(invoiceDate) : now;
    const from = new Date(baseDate.getTime() - daysBack * 24 * 60 * 60 * 1000);
    const fmt = (d) => d.toISOString().slice(0, 10);
    const fromDate = fmt(from);
    const toDate = fmt(now);

    const matchesNumber = (inv) => {
        const num =
            inv?.numeroFattura ||
            inv?.number ||
            inv?.invoiceNumber ||
            inv?.invoice?.number ||
            inv?.invoices?.[0]?.number;
        return num && String(num).trim() === String(invoiceNumber).trim();
    };

    const maxPages = 5;

    // 0) Tentativo diretto per filename, se disponibile
    if (invoiceFilename) {
        try {
            console.log(`📂 Aruba getByFilename filename=${invoiceFilename}`);
            const byFilename = await downloadReceivedInvoiceByFilename({
                token,
                filename: invoiceFilename,
                outputPath,
            });
            if (byFilename) {
                console.log(`🟢 Aruba download by filename OK (${invoiceFilename})`);
                return true;
            }
        } catch (err) {
            if (err.response?.status === 404) {
                console.warn(`⚠️  Aruba getByFilename 404 per ${invoiceFilename}`);
            } else {
                console.warn(`⚠️  Aruba getByFilename errore per ${invoiceFilename}: ${err.message}`);
            }
        }
    }

    for (let page = 0; page < maxPages; page++) {
        console.log(`🔎 Aruba search page=${page} from=${fromDate} to=${toDate} numero=${invoiceNumber}`);
        const list = await searchReceivedInvoices({
            token,
            fromDate,
            toDate,
            page,
            size: pageSize,
        });
        const content = list?.content || [];
        const found = content.find(matchesNumber);
        if (found?.id) {
            try {
                await downloadReceivedInvoiceXml({ token, invoiceId: found.id, outputPath });
                console.log(`🟢 Aruba download OK numero=${invoiceNumber} id=${found.id}`);
                return true;
            } catch (err) {
                if (err.response?.status === 404) {
                    console.warn(`⚠️  Aruba download 404 per invoiceId ${found.id} (numero ${invoiceNumber})`);
                    return false;
                }
                throw err;
            }
        }
        if (!content.length || (list?.last && list.last === true)) break;
    }
    console.warn(`⚠️  Aruba: nessuna fattura trovata per numero=${invoiceNumber} nell'intervallo ${fromDate} -> ${toDate}`);
    return false;
}

module.exports = {
    arubaAuthenticate,
    searchReceivedInvoices,
    downloadReceivedInvoiceXml,
    downloadReceivedInvoiceByFilename,
    findReceivedByUsername,
    fetchInvoiceXmlFromAruba,
};
