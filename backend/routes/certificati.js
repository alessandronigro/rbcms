const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");

const { getConnection } = require("../dbManager");
const { logwrite } = require("../utils/helper");
const BACKEND_URL = process.env.BACKEND_URL;

const TEMPLATES_BASE = "/var/www/rbcms/backend/templates/attestato";
const CERT_DIR = path.join(process.cwd(), "/public/certificati/");
if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });
const CERT_PATH = path.join(process.cwd(), "backend/public/certificati");
if (!fs.existsSync(CERT_PATH)) fs.mkdirSync(CERT_PATH, { recursive: true });

/* -----------------------------------------------------
   PLACEHOLDERS (UGUALI AI TUOI)
------------------------------------------------------*/
const PLACEHOLDERS = {
    nomeCompleto: "||FN||",
    codiceFiscale: "||CD||",
    voto: "||VT||",
    delegato: "||DL||",
    indirizzoTest: "||ND||",
    dataCompletamento: "||DT||",
    oraCompletamento: "||HR||",
    oggi: "||TD||",
    dataCertificato: "||DC||",
    corso: "||CS||",
    annoriferimento: "||ANR||",
    sedelegale: "||LS||",
    programma: "||PRG||",
    docenti: "||DCN||",
    durata: "||DR||",
};

/* -----------------------------------------------------
   1️⃣ Se il corso è un test → risalgo al principale
------------------------------------------------------*/
function resolveMainCourseFromTest(ctx) {
    const code = ctx.code.toLowerCase();

    if (!code.endsWith("test")) return ctx;

    // rimuovo il suffisso "test"
    ctx.code = ctx.code.replace(/test$/i, "");
    return ctx;
}

/* -----------------------------------------------------
   Helpers per voto
------------------------------------------------------*/
async function getScoreFromIdTest(ctx, idtest) {
    const [rows] = await ctx.conn.query(`
        SELECT score,
               (SELECT score_max FROM learning_test WHERE idtest=?) AS score_max
        FROM learning_testtrack 
        WHERE iduser=? AND idtest=?
        ORDER BY idtrack DESC
        LIMIT 1
    `, [idtest, ctx.iduser, idtest]);

    if (!rows.length) return null;
    return `${rows[0].score}/${rows[0].score_max}`;
}

async function getScoreFromCourseTest(ctx, idCorsoTest) {
    const [org] = await ctx.conn.query(`
        SELECT idresource 
        FROM learning_organization 
        WHERE idcourse=? AND isterminator=1
        LIMIT 1
    `, [idCorsoTest]);

    if (!org.length) return null;

    return await getScoreFromIdTest(ctx, org[0].idresource);
}

/* -----------------------------------------------------
   2️⃣ Logica voto UNIFICATA
------------------------------------------------------*/
async function getUnifiedScore(ctx) {
    const conn = ctx.conn;
    const code = ctx.code.toLowerCase();

    /* ---------------------------------------------------
       1️⃣ CORSI cod60% → test gemello cod60%test
    --------------------------------------------------- */
    if (code.startsWith("cod60")) {
        const [row] = await conn.query(
            "SELECT idcourse FROM learning_course WHERE code = CONCAT(?, 'test') LIMIT 1",
            [ctx.code]
        );
        if (row.length) return await getScoreFromCourseTest(ctx, row[0].idcourse);
    }

    /* ---------------------------------------------------
       2️⃣ CORSI codOAMsp% → test gemello codOAMsp%test
    --------------------------------------------------- */
    if (code.startsWith("codoamsp")) {
        const [row] = await conn.query(
            "SELECT idcourse FROM learning_course WHERE code = CONCAT(?, 'test') LIMIT 1",
            [ctx.code]
        );
        if (row.length) return await getScoreFromCourseTest(ctx, row[0].idcourse);
    }

    /* ---------------------------------------------------
       3️⃣ CORSI codAmmAgg%% → codTestAmmAgg%%
    --------------------------------------------------- */
    if (code.startsWith("codammagg")) {
        const suffix = ctx.code.substring("codAmmAgg".length);
        const mappedCode = `codTestAmmAgg${suffix}`;

        const [row] = await conn.query(
            "SELECT idcourse FROM learning_course WHERE code = ? LIMIT 1",
            [mappedCode]
        );

        if (row.length) {
            return await getScoreFromCourseTest(ctx, row[0].idcourse);
        }
    }
    /* ---------------------------------------------------
   3️⃣ BIS — CORSI codAmm%% → codTestAmm%%
   (es. codAmm24 → codTestAmm24)
--------------------------------------------------- */
    if (code.startsWith("codamm") && !code.startsWith("codammagg")) {
        const suffix = ctx.code.substring("codAmm".length);
        const mappedCode = `codTestAmm${suffix}`;

        const [row] = await conn.query(
            "SELECT idcourse FROM learning_course WHERE code = ? LIMIT 1",
            [mappedCode]
        );

        if (row.length) {
            return await getScoreFromCourseTest(ctx, row[0].idcourse);
        }
    }

    /* ---------------------------------------------------
       4️⃣ LOGICA STANDARD → oggetto terminator del corso
    --------------------------------------------------- */
    const [org] = await conn.query(`
        SELECT idresource 
        FROM learning_organization 
        WHERE idcourse=? AND isterminator=1
        LIMIT 1
    `, [ctx.idcorso]);

    if (!org.length) return null;

    return await getScoreFromIdTest(ctx, org[0].idresource);
}

/* -----------------------------------------------------
   3️⃣ Costruzione placeholder unificati
------------------------------------------------------*/
function buildPlaceholders(ctx) {

    const d = ctx.date_complete ? new Date(ctx.date_complete) : null;

    const raw = {
        FN: `${ctx.firstname} ${ctx.lastname}`,
        CD: (ctx.cf || "").toUpperCase(),
        VT: ctx.voto || "",

        DT: d ? d.toLocaleDateString("it-IT") : "",
        HR: d ? d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "",
        DC: d ? d.toLocaleDateString("it-IT") : "",
        TD: new Date().toLocaleDateString("it-IT"),

        CS: ctx.nomecorso,
        ANR: ctx.annoriferimento || "2025",

        PRG: ctx.programma || "",
        DCN: ctx.docenti || "",
        DR: ctx.durata || "",

        DL: "",
        ND: "",
        LS: "Via Crescenzio 25, 00193 Roma (RM)",
    };

    return raw;
}

/* -----------------------------------------------------
   4️⃣ Generatore PDF unico
------------------------------------------------------*/
async function generateCertificateUnified({ templatePath, data, iduser, corso, code, nominativo }) {

    const tmpDocx = fillDocxTemplate(templatePath, data);
    const tmpPdf = convertDocxToPdf(tmpDocx, CERT_PATH);
    // 3️⃣ Nome finale
    const safeCorso = (corso || code || "Corso").replace(/[\\/:*?"<>|]/g, "_");
    const safeNominativo = (nominativo || "").replace(/[\\/:*?"<>|]/g, "_");
    const pdfFinal = path.join(
        CERT_DIR,
        `Attestato - ${safeCorso} - ${safeNominativo} - ${iduser}.pdf`
    );


    logwrite(`✅ PDF generato: ${pdfFinal}`);

    fs.renameSync(tmpPdf, pdfFinal);
    fs.unlinkSync(tmpDocx);

    return pdfFinal;
}


async function getDocenti(code, dbName) {
    try {
        const conn = await getConnection(dbName);

        const [rows] = await conn.query(
            "SELECT docenti FROM corsiascelta WHERE codice = ? LIMIT 1",
            [code]
        );

        if (!rows.length) return "-";

        return rows[0].docenti || "-";
    } catch (err) {
        console.error("getDocenti ERR:", err);
        return "--";
    }
}

async function getProgramma(code, dbName) {
    try {
        const conn = await getConnection(dbName);

        const [rows] = await conn.query(
            "SELECT programma FROM corsiascelta WHERE codice = ? LIMIT 1",
            [code]
        );

        if (!rows.length) return "-";

        return rows[0].programma || "-";
    } catch (err) {
        console.error("getProgramma ERR:", err);
        return "--";
    }
}


/* ──────────────────────────────────────────────
   📘 Risolve il percorso del file template DOCX
   ────────────────────────────────────────────── */
function resolveTemplatePath({ code, convenzione }) {
    const conv = (convenzione || "").toLowerCase();

    // 🔹 Template DEFAULT ASSOLUTO
    const defaultTemplate = path.join(TEMPLATES_BASE, "AttestatoGenerico.docx");

    // 1️⃣ Caso speciale per template "NEW"
    if (typeof code === "string" && code.toLowerCase().includes("new")) {
        const p = path.join(TEMPLATES_BASE, "AttestatoSceltaNew.docx");
        if (fs.existsSync(p)) return p;

        console.warn(`⚠️ Template NEW mancante, uso default: ${defaultTemplate}`);
        return defaultTemplate;
    }

    // 2️⃣ Mappa cartelle per convenzione
    const variants = {
        "covisian": "attestati_covisian",
        "multicampus": "attestati_multicampus",
        "novastudia": "attestati_novastudia",
        "assicomply": "attestati_novastudia",
        "rb-academy": "attestati_rbacademy",
        "mondial bony service srl": "attestati_mondialbony",
        "i-transfer money movers": "attestati_itransfer",
        "conaform": "attestati_conaform",
        "sna provinciale palermo": "attestati_sna",
    };

    // 3️⃣ Cerco template nella cartella della convenzione
    const key = Object.keys(variants).find(k => conv.includes(k));

    if (key) {
        const folder = path.join(TEMPLATES_BASE, variants[key]);
        const specific = path.join(folder, `${code}.docx`);

        if (fs.existsSync(specific)) {
            console.log(`📄 Template specifico usato: ${specific}`);
            return specific;
        }

        console.warn(`⚠️ Template NON trovato in ${variants[key]}: ${specific}`);
        console.warn(`→ Cerco nella cartella generale...`);
    }

    // 4️⃣ Cerco template nella cartella generale /attestati
    const general = path.join(TEMPLATES_BASE, `${code}.docx`);

    if (fs.existsSync(general)) {
        console.log(`📄 Template generale usato: ${general}`);
        return general;
    }

    // 5️⃣ Nessun template trovato → uso default
    console.error(`❌ Template NON trovato per code="${code}" → uso default: ${defaultTemplate}`);

    return defaultTemplate;
}


/* ──────────────────────────────────────────────
   🧩 Sostituzione dei placeholder con Docxtemplater
   ────────────────────────────────────────────── */
function fillDocxTemplate(templatePath, replacements) {
    const content = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(content);

    const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: {
            start: "||",
            end: "||"
        }
    });
    console.log(replacements);
    // docxtemplater accetta placeholder come {{FIRSTNAME}}, non [FIRSTNAME]
    const normalized = {};
    for (const [key, value] of Object.entries(replacements)) {
        const cleanKey = key.replace(/\[|\]/g, "").trim();
        normalized[cleanKey] = value;
    }

    doc.render(normalized);

    const buf = doc.getZip().generate({ type: "nodebuffer" });
    const outDocx = path.join(
        CERT_DIR,
        `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.docx`
    );
    fs.writeFileSync(outDocx, buf);
    return outDocx;
}

/* ──────────────────────────────────────────────
   🧾 Converte DOCX → PDF/A-1b con LibreOffice
   ────────────────────────────────────────────── */
function convertDocxToPdf(inputDocx, outputDir) {
    const args = [
        "--headless",
        "--nologo",
        "--norestore",
        "--invisible",
        "--nolockcheck",
        "--convert-to",
        "pdf:writer_pdf_Export:SelectPdfVersion=1", // PDF/A-1b
        "--outdir",
        outputDir,
        inputDocx,
    ];

    console.log("▶️  LibreOffice:", "soffice", args.join(" "));

    const proc = spawnSync("soffice", args, { encoding: "utf8" });
    if (proc.error) throw proc.error;
    if (proc.status !== 0) {
        console.error(proc.stdout || proc.stderr);
        throw new Error(`LibreOffice errore ${proc.status}`);
    }

    const producedPdf = path.join(
        outputDir,
        path.basename(inputDocx, path.extname(inputDocx)) + ".pdf"
    );

    if (!fs.existsSync(producedPdf)) {
        throw new Error("PDF non prodotto da LibreOffice");
    }

    return producedPdf;
}
/* -----------------------------------------------------
   ROUTE: /certificati/generate  (Nuovo sistema)
------------------------------------------------------*/
router.post("/generate", async (req, res) => {
    const { iduser, idcorso, webdb } = req.body;

    if (!iduser || !idcorso || !webdb) {
        return res.status(400).json({ error: "Parametri mancanti" });
    }

    try {
        const conn = await getConnection(webdb);

        // dati utente + corso
        const [rows] = await conn.query(`
            SELECT a.firstname, a.lastname, a.userid,
                   b.date_complete,
                   c.description AS durata,
                   c.name AS nomecorso,
                   c.code,
                   (SELECT user_entry FROM core_field_userentry 
                        WHERE id_common=23 AND id_user=a.idst) AS cf,
                   (SELECT user_entry FROM core_field_userentry 
                        WHERE id_common=25 AND id_user=a.idst) AS convenzione
            FROM core_user a
            JOIN learning_courseuser b ON a.idst=b.iduser
            JOIN learning_course c ON b.idcourse=c.idcourse
            WHERE a.idst=? AND b.idcourse=?
            LIMIT 1
        `, [iduser, idcorso]);

        if (!rows.length) {
            return res.status(404).json({ error: "Utente o corso non trovato" });
        }

        let ctx = rows[0];
        ctx.iduser = iduser;
        ctx.idcorso = idcorso;
        ctx.webdb = webdb;
        ctx.conn = conn;
        ctx.annoriferimento = "2025";

        // se è un test → risalgo
        ctx = resolveMainCourseFromTest(ctx);

        // voto unificato
        ctx.voto = await getUnifiedScore(ctx);

        // programma + docenti
        ctx.programma = await getProgramma(ctx.code, webdb);
        ctx.docenti = await getDocenti(ctx.code, webdb);

        // placeholder
        const data = buildPlaceholders(ctx);

        // template path (UGUALE al tuo)
        const templatePath = resolveTemplatePath({
            code: ctx.code,
            convenzione: ctx.convenzione
        });

        // generazione PDF
        const finalPdf = await generateCertificateUnified({
            templatePath,
            data,
            iduser,
            nomecorso: ctx.nomecorso,
            code: ctx.code,

            nomeCompleto: `${ctx.firstname} ${ctx.lastname}`
        });

        return res.json({
            success: true,
            file: `${BACKEND_URL}/backend/public/certificati/${path.basename(finalPdf)}`,
            debug: { data }
        });

    } catch (err) {
        await logwrite("❌ ERRORE certificati/generate: " + err.message);
        return res.status(500).json({ error: err.message });
    }
});

// --------------------------------------------------------
//  📧 INVIO ATTESTATO + REPORT + TEST
// --------------------------------------------------------
router.post("/sendcertificate", async (req, res) => {
    const { iduser, idcorso, webdb } = req.body;

    if (!iduser || !idcorso || !webdb) {
        return res.status(400).json({ error: "Parametri mancanti" });
    }

    try {
        const conn = await getConnection(webdb);

        // 1️⃣ DATI BASE
        const [rows] = await conn.query(`
            SELECT a.firstname, a.lastname, a.userid, a.email,
                   c.name AS nomecorso, c.code,
                   (SELECT user_entry 
                    FROM core_field_userentry 
                    WHERE id_common=25 AND id_user=a.idst) AS convenzione
            FROM core_user a
            JOIN learning_courseuser b ON a.idst=b.iduser
            JOIN learning_course c ON b.idcourse=c.idcourse
            WHERE a.idst=? AND b.idcourse=?
            LIMIT 1
        `, [iduser, idcorso]);

        if (!rows.length) throw new Error("Utente o corso non trovato");

        const u = rows[0];
        const nominativo = `${u.firstname} ${u.lastname}`;
        const convenzione = u.convenzione || "";

        const BASE_URL = process.env.BACKEND_URL;

        // 2️⃣ GESTIONE "già evaso"
        const [ev] = await conn.query(
            "SELECT evaso2 FROM learning_certificate_assign WHERE id_user=? AND id_course=?",
            [iduser, idcorso]
        );

        if (ev.length && ev[0].evaso2 == 1) {
            await logwrite(`⚠️ Attestato già evaso → user=${iduser} corso=${idcorso}`);
            // Non fermiamo il flusso, re-inviamo comunque se richiesto
        }

        // 3️⃣ GENERA ATTESTATO (NUOVO SISTEMA)
        const attRes = await fetch(`${BASE_URL}/api/attestati/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ iduser, idcorso, webdb })
        }).then(r => r.json());

        if (!attRes.success) throw new Error(attRes.error || "Errore generazione attestato");

        const attestatoUrl = attRes.file;

        // in locale → genero percorso file
        const attestatoPath = path.join(
            process.cwd(),
            "backend/public/certificati",
            path.basename(attestatoUrl)
        );

        let attachments = [attestatoPath];

        // --------------------------------------------------------
        // 4️⃣ REPORT (GETTIME)
        // --------------------------------------------------------
        try {
            const report = await gettime(
                iduser,
                idcorso,
                u.firstname,
                u.lastname,
                webdb,
                true,
                "",
                null
            );

            if (report && fs.existsSync(report)) {
                attachments.push(report);
            } else {
                console.warn("⚠️ Report non trovato:", report);
            }
        } catch (err) {
            await logwrite(`gettime ERR: ${err.message}`);
        }

        // --------------------------------------------------------
        // 5️⃣ TEST FINALE (GETLASTTEST)
        // --------------------------------------------------------
        try {
            const testFile = await getLastTest(
                iduser,
                idcorso,
                u.firstname,
                u.lastname,
                webdb,
                true,
                "",
                null
            );

            if (testFile && fs.existsSync(testFile)) {
                attachments.push(testFile);
            } else {
                console.warn("⚠️ Test finale non trovato:", testFile);
            }
        } catch (err) {
            await logwrite(`getlasttest ERR: ${err.message}`);
        }

        // --------------------------------------------------------
        // 6️⃣ UPDATE DB
        // --------------------------------------------------------
        await conn.query(`
            UPDATE learning_certificate_assign
            SET pathattestato=?, evaso2=1, data_invio=NOW()
            WHERE id_user=? AND id_course=?
        `, [attestatoUrl, iduser, idcorso]);

        await conn.query(`
            UPDATE learning_courseuser
            SET status=3, data_invio=NOW()
            WHERE iduser=? AND idcourse=?
        `, [iduser, idcorso]);

        // --------------------------------------------------------
        // 7️⃣ INVIO EMAIL
        // --------------------------------------------------------
        const bcc = await getBCC(iduser);

        const sendRes = await SaveAndSend({
            idcourse: idcorso,
            file: attachments.join(";"),
            nominativo,
            email: u.email,
            pec: "",
            code: u.code,
            convenzione,
            nomecorso: u.nomecorso,
            bcc,
            format: "attestato"
        });

        await logwrite(`📨 Email inviata a ${u.email}: ${sendRes.esito || "OK"}`);

        return res.json({
            success: true,
            message: "Attestato inviato correttamente",
            allegati: attachments
        });

    } catch (err) {
        await logwrite("❌ sendcertificate ERR: " + err.message);
        return res.status(500).json({ error: err.message });
    }
});

router.get("/generate-all", async (req, res) => {
    const DBS = ["newformazionein", "formazionein", "forma4"]; // puoi aggiungere altri db

    let risultati = [];
    let erroriGlobali = [];

    for (const webdb of DBS) {
        let conn;

        try {
            conn = await getConnection(webdb);
        } catch (err) {
            erroriGlobali.push({ webdb, errore: "Connessione fallita: " + err.message });
            continue;
        }

        // 1️⃣ recupero corsi realmente completati
        let corsi = [];
        try {
            const [rows] = await conn.query(`
                SELECT DISTINCT idcourse 
                FROM learning_courseuser 
                WHERE status = 2
                ORDER BY idcourse ASC
            `);
            corsi = rows.map(r => r.idcourse);
        } catch (err) {
            erroriGlobali.push({ webdb, errore: "Query corsi fallita: " + err.message });
            continue;
        }

        let certificati = [];
        let errori = [];

        // 2️⃣ ciclo tutti i corsi
        for (const idcorso of corsi) {
            try {
                // prendiamo un utente reale che lo ha completato
                const [users] = await conn.query(`
                    SELECT iduser 
                    FROM learning_courseuser 
                    WHERE idcourse=? AND status=2 
                    LIMIT 1
                `, [idcorso]);

                if (!users.length) {
                    errori.push({
                        webdb,
                        idcorso,
                        errore: "Nessun utente completante"
                    });
                    continue;
                }

                const iduser = users[0].iduser;

                // 🔥 chiamiamo la nuova funzione unificata
                const result = await generateSingleCertificate({
                    iduser,
                    idcorso,
                    webdb,
                    conn
                });

                certificati.push({
                    webdb,
                    idcorso,
                    iduser,
                    file: result.url
                });

            } catch (err) {
                errori.push({
                    webdb,
                    idcorso,
                    errore: err.message
                });
            }
        }

        risultati.push({
            database: webdb,
            certificatiGenerati: certificati.length,
            certificati,
            errori
        });
    }

    res.json({
        success: true,
        risultati,
        erroriGlobali
    });
});

async function generateSingleCertificate({ iduser, idcorso, webdb, conn }) {

    // recupero dati principali
    const [rows] = await conn.query(`
        SELECT a.firstname, a.lastname, a.userid,
               b.date_complete,
               c.description AS durata,
               c.name AS nomecorso,
               c.code,
               (SELECT user_entry FROM core_field_userentry 
                    WHERE id_common=23 AND id_user=a.idst) AS cf,
               (SELECT user_entry FROM core_field_userentry 
                    WHERE id_common=25 AND id_user=a.idst) AS convenzione
        FROM core_user a
        JOIN learning_courseuser b ON a.idst=b.iduser
        JOIN learning_course c ON b.idcourse=c.idcourse
        WHERE a.idst=? AND b.idcourse=?
        LIMIT 1
    `, [iduser, idcorso]);

    if (!rows.length) throw new Error("utente corso non trovato");

    let ctx = rows[0];
    ctx.iduser = iduser;
    ctx.idcorso = idcorso;
    ctx.webdb = webdb;
    ctx.conn = conn;
    ctx.annoriferimento = "2025";

    // se è test → corso principale
    ctx = resolveMainCourseFromTest(ctx);

    // voto
    ctx.voto = await getUnifiedScore(ctx);

    // docente + programma
    ctx.programma = await getProgramma(ctx.code, webdb);
    ctx.docenti = await getDocenti(ctx.code, webdb);

    // placeholder
    const data = buildPlaceholders(ctx);

    // template
    const templatePath = resolveTemplatePath({
        code: ctx.code,
        convenzione: ctx.convenzione
    });

    // pdf
    const finalPdf = await generateCertificateUnified({
        templatePath,
        data,
        iduser,
        nomecorso: ctx.nomecorso,
        nomeCompleto: `${ctx.firstname} ${ctx.lastname}`
    });

    const url = `${BACKEND_URL}/backend/public/certificati/${path.basename(finalPdf)}`;

    return { url, ctx };
}

module.exports = router;