// utils/generateCertificate.js
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const AdmZip = require("adm-zip");
const { logwrite } = require("./helper");

const TEMPLATES_BASE = "/var/www/rbcms/backend/templates/attestati/attestato";
const CERT_DIR = path.join(process.cwd(), "backend/certificati");
if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

/**
 * Risolve il file template .docx da usare
 * - Se code contiene "new" → AttestatoSceltaNew.docx
 * - Se esiste in una sotto-cartella “attestati_<variant>” (derivata dalla convenzione) → usa quello
 * - Altrimenti prova /attestati/<code>.docx
 */
function resolveTemplatePath({ code, convenzione }) {
    // caso speciale "new"
    if (typeof code === "string" && code.toLowerCase().includes("new")) {
        const p = path.join(TEMPLATES_BASE, "AttestatoSceltaNew.docx");
        if (fs.existsSync(p)) return p;
    }

    const conv = (convenzione || "").toLowerCase();
    const variants = {
        "covisian": "attestati_covisian",
        "multicampus": "attestati_multicampus",
        "novastudia": "attestati_novastudia",
        "assicomply": "attestati_novastudia",
        "mondial bony service srl": "attestati_mondialbony",
        "i-transfer money movers": "attestati_itransfer",
        "conaform": "attestati_conaform",
        "sna provinciale palermo": "attestati_sna",
    };

    // prova sotto-cartelle convenzione
    const key = Object.keys(variants).find(k => conv.includes(k));
    if (key) {
        const folder = path.join(TEMPLATES_BASE, variants[key]);
        const inVariant = path.join(folder, `${code}.docx`);
        if (fs.existsSync(inVariant)) return inVariant;
    }

    // fallback: radice
    const base = path.join(TEMPLATES_BASE, `${code}.docx`);
    if (fs.existsSync(base)) return base;

    throw new Error(`Template non trovato per code='${code}' (conv='${base}')`);
}

/**
 * Esegue replace letterale nei file XML del .docx (senza docxtemplater):
 * Cerca e sostituisce i placeholder EXACT MATCH nel document.xml, header/footer
 */
function replaceInDocxBinary(templatePath, replacements) {
    const zip = new AdmZip(templatePath);
    const entries = zip.getEntries();

    const TARGETS = [
        "word/document.xml",
        "word/header1.xml", "word/header2.xml", "word/header3.xml",
        "word/footer1.xml", "word/footer2.xml", "word/footer3.xml",
    ];

    for (const t of TARGETS) {
        const entry = entries.find(e => e.entryName === t);
        if (!entry) continue;

        let xml = entry.getData().toString("utf8");

        // sostituzioni letterali (attenzione a caratteri speciali già codificati in XML)
        for (const [needle, value] of Object.entries(replacements)) {
            if (!needle) continue;
            const safeVal = (value ?? "").toString();
            // replace all occurrences
            xml = xml.split(needle).join(safeVal);
        }

        zip.updateFile(t, Buffer.from(xml, "utf8"));
    }

    // crea un docx temporaneo con i placeholder sostituiti
    const outDocx = path.join(
        CERT_DIR,
        `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.docx`
    );
    zip.writeZip(outDocx);
    return outDocx;
}

/**
 * Converte DOCX → PDF(A) con LibreOffice.
 * - Prova PDF/A (PDF/A-1) con unoconv se presente
 * - fallback a soffice standard PDF
 */
function convertDocxToPdfA(inputDocx, outputPdf) {
    // 1) prova con unoconv PDF/A (se installato)
    try {
        const uno = spawnSync("unoconv", ["-f", "pdf", "-eSelectPdfVersion=1", "-o", outputPdf, inputDocx], {
            encoding: "utf8"
        });
        if (uno.status === 0 && fs.existsSync(outputPdf)) {
            return outputPdf;
        }
        logwrite(`unoconv fallback: code=${uno.status}, stderr=${uno.stderr}`);
    } catch (e) {
        // ignore, procederemo con soffice
    }

    // 2) soffice → PDF standard
    const outDir = path.dirname(outputPdf);
    const soff = spawnSync(
        "soffice",
        [
            "--headless",
            "--convert-to", "pdf:writer_pdf_Export",
            "--outdir", outDir,
            inputDocx
        ],
        { encoding: "utf8" }
    );

    if (soff.status !== 0) {
        throw new Error(`LibreOffice conversion failed: ${soff.stderr || soff.stdout}`);
    }

    const produced = path.join(outDir, path.basename(inputDocx, ".docx") + ".pdf");
    if (!fs.existsSync(produced)) {
        throw new Error("PDF non prodotto da LibreOffice");
    }

    // rinomina/muovi nel nome richiesto
    fs.renameSync(produced, outputPdf);
    return outputPdf;
}

/**
 * Genera certificato PDF a partire da un .docx (placeholders testuali).
 * @returns percorso assoluto del PDF generato
 */
async function generateCertificate({
    code,          // codice corso (es. "cod6034")
    corso,         // stringa corso (per filename VB)
    nominativo,    // "Nome Cognome"
    iduser,
    templateFolder, // ignorato: ora auto-risolviamo dalla convenzione
    data,          // mappa placeholder -> valore
    convenzione = "",
}) {
    // risolvi template
    const templatePath = resolveTemplatePath({ code, convenzione });

    // mappa placeholder coerente con i .docx originali (nessun {{ }}, sostituzione plain text)
    // NB: accettiamo chiavi data così come passate da attestati.js
    //     e aggiungiamo qui i due casi speciali presenti spesso nei template:
    const replacements = {
        ...data,
        "Firstname Lastname": data["firstname lastname"] ?? data["Firstname Lastname"] ?? nominativo,
        "username": "C.F.",
        "idst": data.idst || "", // in docx si trova spesso come "CF: idst" o "username: idst"
    };

    // crea un docx temporaneo con le sostituzioni
    const tmpDocx = replaceInDocxBinary(templatePath, replacements);

    // nome PDF finale fedele al VB (attenzione allo spazio prima di .pdf)
    const safeCorso = (corso || code || "Corso").replace(/[\\/:*?"<>|]/g, "_");
    const safeNominativo = (nominativo || "").replace(/[\\/:*?"<>|]/g, "_");
    const pdfFinal = path.join(
        CERT_DIR,
        `Attestato - ${safeCorso} - ${safeNominativo} - ${iduser} .pdf`
    );

    // converte in PDF (PDF/A se possibile)
    try {
        convertDocxToPdfA(tmpDocx, pdfFinal);
    } finally {
        // pulizia file temporaneo
        try { fs.unlinkSync(tmpDocx); } catch { }
    }

    logwrite(`PDF generato: ${pdfFinal}`);
    return pdfFinal;
}

module.exports = {
    generateCertificate,
};