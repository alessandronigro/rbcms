// routes/attestati.js
const path = require("path");
const { getConnection } = require("../dbManager");
const { generateCertificate } = require("./generateCertificate");
const { logwrite } = require("./helper");
const CERT_PATH = path.join(process.cwd(), "certificati");
/**
 * 🔎 Ritorna l’ultimo corso “60 ore” completato
 */
async function getCorso60(conn, iduser) {
    try {
        const [rows] = await conn.query(
            `
      SELECT idcourse 
      FROM learning_courseuser 
      WHERE iduser = ? 
        AND idcourse IN (373,407,286,428,429,73,74,85,86,79,4)
      ORDER BY date_complete DESC 
      LIMIT 1
    `,
            [iduser]
        );
        return rows?.[0]?.idcourse || null;
    } catch (err) {
        logwrite("Errore getCorso60: " + err.message);
        return null;
    }
}
// --- helper date locali (aggiungere in cima al file utils/attestati.js) ---
function pad2(n) {
    return String(n).padStart(2, "0");
}

/**
 * DD/MM/YYYY  (es: 24/10/2025)
 */
function formatDate(date) {
    if (!date) return "";
    const d = new Date(date);
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * HH:mm  (es: 09:30)
 */
function formatTime(date) {
    if (!date) return "";
    const d = new Date(date);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * GGMMAAAA (senza separatori, es: 24102025)
 * Se ti serve in qualche placeholder/CF specifico.
 */
function formatDateGGMMAAAA(date) {
    if (!date) return "";
    const d = new Date(date);
    return `${pad2(d.getDate())}${pad2(d.getMonth() + 1)}${d.getFullYear()}`;
}

/* ──────────────────────────────────────────────────────────
   📁 Scelta cartella template in base alla convenzione
   ────────────────────────────────────────────────────────── */
function resolveTemplateFolder(convenzione) {
    if (!convenzione) return "attestato";
    const conv = convenzione.toLowerCase();
    if (conv.includes("covisian")) return "attestato_covisian";
    if (conv === "multicampus") return "attestato_multicampus";
    if (["novastudia", "assicomply"].includes(conv)) return "attestato_novastudia";
    if (conv === "mondial bony service srl") return "attestato_mondialbony";
    if (conv === "i-transfer money movers") return "attestato_itransfer";
    if (conv === "conaform") return "attestato_conaform";
    if (conv === "sna provinciale palermo") return "attestato_sna";
    return "attestato";
}

/* ──────────────────────────────────────────────────────────
   🧾 Attestato Servizi di Pagamento (VB: AttestatoServizidipagamento)
   ────────────────────────────────────────────────────────── */
async function attestatoServiziDiPagamento({
    conn,
    iduser,
    nome,
    cognome,
    username, // non usato nei placeholder
    date_complete,
    voto,
    cf,
    tipocorso,
    convenzione = "",
    corso,
    hostUrl,
}) {
    try {
        let templateFolder = "attestato";
        if ((convenzione || "").trim() === "Mondial Bony Service Srl") {
            templateFolder = "attestato_mondialbony";
        }

        const nominativo = `${nome} ${cognome}`.trim();
        const cfUp = (cf || "").toUpperCase();

        const data = {
            "Firstname Lastname": nominativo,
            idst: cfUp,                // stampa come C.F.
            txtvoto: voto || "",
            DATECERT: formatDateDDMMYYYY(date_complete),
        };

        const pdfPath = await generateCertificate({
            code: tipocorso,
            corso,
            nominativo,
            iduser,
            templateFolder,
            data,
            cf: cfUp,
        });

        const url = `${hostUrl}/certificati/${path.basename(pdfPath)}`;
        logwrite(`✅ Attestato Servizi di Pagamento creato: ${url}`);
        return url;
    } catch (err) {
        logwrite("❌ Errore attestatoServiziDiPagamento: " + err.message);
        throw err;
    }
}

/* ──────────────────────────────────────────────────────────
   🧾 Attestato IVASS TEST (VB: AttestatoIvassTest)
   ────────────────────────────────────────────────────────── */
async function attestatoIvassTest({
    conn,
    db,
    iduser,
    idcorso,
    nome,
    cognome,
    username, // non usato nei placeholder
    date_complete,
    voto,
    indirizzotest,
    delegato,
    cf,
    tipocorso,
    convenzione = "",
    corso,
    hostUrl,
}) {
    try {
        // Determina tipocorso in base al corso 60 ore
        const corso60 = await getCorso60(conn, iduser);
        if (corso60 === 74) tipocorso = "cod6036";
        else if (corso60 === 86) tipocorso = "cod6035a";
        else tipocorso = "cod6034";

        // Cartella template in base alla convenzione e db
        let templateFolder = "attestato";
        const convLow = (convenzione || "").toLowerCase();
        if (convLow.includes("covisian")) {
            templateFolder = "attestato_covisian";
        } else if (convLow === "conaform") {
            templateFolder = "attestato_conaform";
        } else if (convLow === "assicomply") {
            templateFolder = "attestato_novastudia";
        } else if (db === "efadnovastudia") {
            templateFolder = "attestato_novastudia";
        }

        const nominativo = `${nome} ${cognome}`.trim();
        const cfUp = (cf || "").toUpperCase();

        const data = {
            "Firstname Lastname": nominativo,
            "[DELEGATO]": delegato || "",
            "[DATECOMPLETE]": formatDateDDMMYYYY(date_complete),
            "[ORA]": formatTimeHHmm(date_complete),
            "[CF]": cf || "",
            "[INDIRIZZOTEST]": indirizzotest || "",
            "[VOTO]": voto ? `${voto}/200` : "",
            idst: cfUp, // C.F.
            datecert: formatDateDDMMYYYY(date_complete),
            "[TODAY]": formatDateDDMMYYYY(new Date()),
        };

        const pdfPath = await generateCertificate({
            code: tipocorso,
            corso,
            nominativo,
            iduser,
            templateFolder,
            data,
            cf: cfUp,
        });

        const url = `${hostUrl}/certificati/${path.basename(pdfPath)}`;
        logwrite(`✅ Attestato IVASS Test creato: ${url}`);
        return url;
    } catch (err) {
        logwrite("❌ Errore attestatoIvassTest: " + err.message);
        throw err;
    }
}

/* ──────────────────────────────────────────────────────────
   🧾 Attestato IVASS (non Test) (VB: AttestatoIvass)
   ────────────────────────────────────────────────────────── */
async function attestatoIvass({
    conn,
    db,
    iduser,
    idcorso,
    nome,
    cognome,
    username, // non usato nei placeholder
    date_complete,
    voto,
    indirizzotest,
    delegato,
    cf,
    tipocorso,
    convenzione = "",
    corso,
    hostUrl,
}) {
    try {
        // Cartella template in base alla convenzione / db
        let templateFolder = "attestato";
        const convLow = (convenzione || "").toLowerCase();
        if (convLow.includes("covisian")) {
            templateFolder = "attestato_covisian";
        } else if (convLow === "conaform") {
            templateFolder = "attestato_conaform";
        } else if (convLow === "multicampus") {
            templateFolder = "attestato_multicampus";
        } else if (convLow === "assicomply") {
            templateFolder = "attestato_novastudia";
        } else if (db === "efadnovastudia" || db === "forma4") {
            templateFolder = "attestato_novastudia";
        }

        const nominativo = `${nome} ${cognome}`.trim();
        const cfUp = (cf || "").toUpperCase();

        const data = {
            "Firstname Lastname": nominativo,
            "[DELEGATO]": delegato || "",
            "[DATECOMPLETE]": formatDateDDMMYYYY(date_complete),
            "[ORA]": formatTimeHHmm(date_complete),
            "[CF]": cf || "",
            "[INDIRIZZOTEST]": indirizzotest || "",
            "[VOTO]": voto || "",
            idst: cfUp, // C.F.
            datecert: formatDateDDMMYYYY(date_complete),
            "[TODAY]": formatDateDDMMYYYY(new Date()),
        };

        const pdfPath = await generateCertificate({
            code: tipocorso,
            corso,
            nominativo,
            iduser,
            templateFolder,
            data,
            cf: cfUp,
        });

        const url = `${hostUrl}/certificati/${path.basename(pdfPath)}`;
        logwrite(`✅ Attestato IVASS creato: ${url}`);
        return url;
    } catch (err) {
        logwrite("❌ Errore attestatoIvass: " + err.message);
        throw err;
    }
}

/* ──────────────────────────────────────────────────────────
   🧾 Attestato Generico (fallback)
   - Se il code contiene “new”, forza template AttestatoSceltaNew.docx
   - Altrimenti {code}.docx
   ────────────────────────────────────────────────────────── */
async function attestatoGenerico({
    conn,
    iduser,
    nome,
    cognome,
    cf,
    code,
    descrizione,
    voto,
    date_complete,
    convenzione,
    corso, // display name
    annoriferimento = "2024",
    hostUrl,
    docenti = "",          // opzionale
    programma = "",        // opzionale, verrà splittato in [programma1..4]
}) {
    try {
        const nominativo = `${nome} ${cognome}`.trim();
        const templateFolder = resolveTemplateFolder(convenzione);
        const cfUp = (cf || "").toUpperCase();

        // Se “new” nel codice → usa template fisso AttestatoSceltaNew.docx
        const isNew = /new/i.test(code);
        const templateCode = isNew ? "AttestatoSceltaNew" : code;

        // Split programma in blocchi (max ~1000 char per sicurezza)
        const chunk = (str, size) =>
            (str || "").match(new RegExp(`.{1,${size}}`, "g")) || [];
        const parts = chunk(programma, 1000);

        const data = {
            "firstname lastname": nominativo,
            "coursename": code,
            "[hour]": descrizione || "",
            "idst": cf.toUpperCase(),
            "datecert": formatDate(date_complete),
            "[ANNORIFERIMENTO]": annoriferimento,
            "[DATECOMPLETE]": formatDate(date_complete),
            "[ORA]": formatTime(date_complete),
            "[CF]": cf,
            "[TODAY]": formatDate(new Date()),
            "[VOTO]": voto || "",
        };
        pdfPath = await generateCertificate({
            code,
            corso,
            nominativo,
            iduser,
            data,
            convenzione,
        });
        const url = `${hostUrl}/certificati/${path.basename(pdfPath)}`;
        logwrite(`✅ Attestato generico creato: ${url}`);
        return url;
    } catch (err) {
        logwrite("❌ Errore attestatoGenerico: " + err.message);
        throw err;
    }
}

module.exports = {
    attestatoIvass,
    attestatoIvassTest,
    attestatoServiziDiPagamento,
    attestatoGenerico,
    getCorso60,
};