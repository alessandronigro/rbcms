/**
 * Script di prova: ricerca fatture ricevute via Aruba (findByUsername) e logga i risultati.
 * Usa le credenziali già presenti in .env/.env.production.
 */
const fs = require("fs");
const path = require("path");
const { arubaAuthenticate, findReceivedByUsername } = require("../utils/arubaClient");
// Carica .env, poi .env.production se presente
require("dotenv").config();
require("dotenv").config({ path: path.join(__dirname, "..", ".env.production") });

function log(message) {
    const logPath = path.join(process.cwd(), "public", "fatture", "fatturelog.log");
    try {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        const line = `[${new Date().toISOString()}] ${message}\n`;
        fs.appendFileSync(logPath, line, "utf-8");
        console.log(message);
    } catch (err) {
        console.error("Log write failed:", err.message);
    }
}

async function run() {
    const username = process.env.ARUBA_USERNAME;
    if (!username) {
        throw new Error("ARUBA_USERNAME non configurato");
    }

    log(`🔎 Aruba findByUsername start (user=${username})`);

    const token = await arubaAuthenticate();
    const pageSize = 100;
    let total = 0;

    for (let page = 0; page < 3; page++) {
        try {
            const res = await findReceivedByUsername({ token, username, page, size: pageSize });
            const content = res?.content || [];
            total += content.length;
            log(`Aruba page ${page}: trovate ${content.length} fatture`);
            content.forEach((inv) => {
                const num = inv?.invoiceNumber || inv?.numeroFattura || inv?.number || inv?.invoices?.[0]?.number;
                const fname = inv?.filename || inv?.fileName;
                log(` - ${num || "?"} | file=${fname || "?"} | id=${inv?.id || "?"}`);
            });
            if (!content.length || res?.last === true) break;
        } catch (err) {
            const status = err?.response?.status;
            const body = err?.response?.data;
            log(`⚠️  Aruba findByUsername errore page=${page} status=${status || "?"} body=${JSON.stringify(body || {})}`);
            if (status === 404) break;
            throw err;
        }
    }

    log(`🔚 Aruba findByUsername completata: totale righe loggate=${total}`);
}

run().catch((err) => {
    log(`❌ Aruba findByUsername errore: ${err.message}`);
    process.exit(1);
});
