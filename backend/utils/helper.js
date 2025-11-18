/**
 * utils/helper.js
 * 🧰 Raccolta di funzioni comuni usate nel progetto
 */

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const axios = require("axios");
const crypto = require("crypto");
const dayjs = require("dayjs");
const { getConnection } = require("../dbManager");
const { invioMail, invioMailPEC } = require("../utils/mailerBrevo");
const { ConversationsAgentOnlinePingPostRequest } = require("@getbrevo/brevo");


const BASE_DIR = path.resolve(__dirname, "..");

// Percorsi assoluti e garantiti esistenti
const PATHS = {
    CERTIFICATI: path.join(BASE_DIR, "public/certificati"),
    REPORTS: path.join(BASE_DIR, "public/reports"),
    TESTFINALI: path.join(BASE_DIR, "public/ultimotest"),
    LOG: path.join(BASE_DIR, "public/log"),
    TEMP: path.join(BASE_DIR, "public/temp"),
    DEBUG_DIR: path.join(BASE_DIR, "public/debug"),
};

// Creazione automatica se non esistono
for (const dir of Object.values(PATHS)) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}


/* =======================================================
   🔹 PIEDINI HTML GLOBALI
   ======================================================= */

// RB Intermediari
global.piedino = `
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<span style="font-size:14.0pt"><span style="font-family:'Times New Roman',serif">
<span style="color:#00314c">Segreteria Didattica</span></span></span></span></span>
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<strong><em>&nbsp; &nbsp; &nbsp;&nbsp;</em></strong></span></span></p><br>
<img src="cid:companylogo">
<p style="margin-left:0cm; margin-right:0cm">
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<strong><em><span style="font-size:12.0pt">
<span style="font-family:'Times New Roman',serif">
<span style="color:#00314c">RB Intermediari<br> Progetto di RB Consulting S.r.l.</span>
</span></span></em></strong></span></span><br />
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<em><span style="font-size:12.0pt">
<span style="font-family:'Times New Roman',serif">
<span style="color:#00314c">Via Crescenzio, 25</span></span></span></em></span></span><br />
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<em><span style="font-size:12.0pt">
<span style="font-family:'Times New Roman',serif">
<span style="color:#00314c">00193 Roma (RM)</span></span></span></em></span></span><br />
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<em><span style="font-size:12.0pt">
<span style="font-family:'Times New Roman',serif">
<span style="color:#00314c">800.69.99.92</span></span></span></em></span></span><br />
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<em><u><span style="font-size:12.0pt">
<span style="font-family:'Times New Roman',serif">
<span style="color:#0563c1">
<a href="mailto:info@formazioneintermediari.com" style="color:#0563c1; text-decoration:underline">
info@formazioneintermediari.com</a></span></span></span></u></em></span></span><br />
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<em><u><span style="font-size:12.0pt">
<span style="font-family:'Times New Roman',serif">
<span style="color:#0563c1">
<a href="https://www.formazioneintermediari.com" style="color:#0563c1; text-decoration:underline">
www.formazioneintermediari.com</a></span></span></span></u></em></span></span><br />
`;

// RB Academy
global.piedinorbacademy = `
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<span style="font-size:14.0pt"><span style="font-family:'Times New Roman',serif">
<span style="color:#00314c">Segreteria Didattica</span></span></span></span></span>
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<strong><em>&nbsp; &nbsp; &nbsp;&nbsp;</em></strong></span></span></p><br>
<img src="cid:companylogo">
<p style="margin-left:0cm; margin-right:0cm">
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<strong><em><span style="font-size:12.0pt">
<span style="font-family:'Times New Roman',serif">
<span style="color:#00314c">RB Academy<br> Progetto di RB Consulting S.r.l.</span>
</span></span></em></strong></span></span><br />
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<em><span style="font-size:12.0pt"><span style="font-family:'Times New Roman',serif">
<span style="color:#00314c">Via Crescenzio, 25</span></span></span></em></span></span><br />
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<em><span style="font-size:12.0pt"><span style="font-family:'Times New Roman',serif">
<span style="color:#00314c">00193 Roma (RM)</span></span></span></em></span></span><br />
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<em><span style="font-size:12.0pt"><span style="font-family:'Times New Roman',serif">
<span style="color:#00314c">800.69.99.92</span></span></span></em></span></span><br />
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<em><u><span style="font-size:12.0pt"><span style="font-family:'Times New Roman',serif">
<span style="color:#0563c1">
<a href="mailto:info@rb-academy.it" style="color:#0563c1; text-decoration:underline">
info@rb-academy.it</a></span></span></span></u></em></span></span><br />
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<em><u><span style="font-size:12.0pt"><span style="font-family:'Times New Roman',serif">
<span style="color:#0563c1">
<a href="https://www.rb-academy.it" style="color:#0563c1; text-decoration:underline">
www.rb-academy.it</a></span></span></span></u></em></span></span><br />
`;

// NOVASTUDIA Academy
global.piedinonovastudia = `
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<span style="font-size:14.0pt"><span style="font-family:'Times New Roman',serif">
<span style="color:#00314c">Segreteria Didattica</span></span></span></span></span>
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<strong><em>&nbsp; &nbsp; &nbsp;&nbsp;</em></strong></span></span></p><br>
<img src="cid:companylogo">
<p style="margin-left:0cm; margin-right:0cm">
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<strong><em><span style="font-size:12.0pt">
<span style="font-family:'Times New Roman',serif">
<span style="color:#00314c">NOVASTUDIA ACADEMY</span></span></span></em></strong></span></span><br />
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<em><span style="font-size:12.0pt"><span style="font-family:'Times New Roman',serif">
<span style="color:#00314c">Via Quadronno, 4 - 20122 Milano</span></span></span></em></span></span><br />
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<em><span style="font-size:12.0pt"><span style="font-family:'Times New Roman',serif">
<span style="color:#00314c">02 58315358</span></span></span></em></span></span><br />
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<em><u><span style="font-size:12.0pt"><span style="font-family:'Times New Roman',serif">
<span style="color:#0563c1">
<a href="mailto:info@novastudia.academy" style="color:#0563c1; text-decoration:underline">
info@novastudia.academy</a></span></span></span></u></em></span></span><br />
<span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
<em><u><span style="font-size:12.0pt"><span style="font-family:'Times New Roman',serif">
<span style="color:#0563c1">
<a href="https://www.novastudia.academy" style="color:#0563c1; text-decoration:underline">
www.novastudia.academy</a></span></span></span></u></em></span></span><br />
`;

global.piedinodidattica = `
<img src="cid:companylogo">
<p style="margin-left:0cm; margin-right:0cm">
  <span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
    <strong><em><span style="font-size:12.0pt">
      <span style="font-family:'Times New Roman',serif"><span style="color:#00314c">
        RB Intermediari<br> Progetto di RB Consulting S.r.l.
      </span></span>
    </span></em></strong>
  </span></span><br />
  <span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
    <em><span style="font-size:12.0pt"><span style="font-family:'Times New Roman',serif">
      <span style="color:#00314c">Via Crescenzio, 25</span>
    </span></span></em>
  </span></span><br />
  <span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
    <em><span style="font-size:12.0pt"><span style="font-family:'Times New Roman',serif">
      <span style="color:#00314c">00193 Roma (RM)</span>
    </span></span></em>
  </span></span><br />
  <span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
    <em><span style="font-size:12.0pt"><span style="font-family:'Times New Roman',serif">
      <span style="color:#00314c">800.69.99.92</span>
    </span></span></em>
  </span></span><br />
  <span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
    <em><u><span style="font-size:12.0pt"><span style="font-family:'Times New Roman',serif">
      <span style="color:#0563c1">
        <a href="mailto:didattica@formazioneintermediari.com" style="color:#0563c1; text-decoration:underline">
          didattica@formazioneintermediari.com
        </a>
      </span>
    </span></span></u></em>
  </span></span><br />
  <span style="font-size:14pt"><span style="font-family:Calibri,sans-serif">
    <em><u><span style="font-size:12.0pt"><span style="font-family:'Times New Roman',serif">
      <span style="color:#0563c1">
        <a href="https://www.formazioneintermediari.com" style="color:#0563c1; text-decoration:underline">
          www.formazioneintermediari.com
        </a>
      </span>
    </span></span></u></em>
  </span></span><br />
`;


// --- TEMPLATE MODE SWITCH ----------------------------------------------------
let __TEMPLATE_MODE__ = "raw"; // "raw" (A) = identico VB.NET, "clean" (B) = HTML pulito
function setTemplateMode(mode = "raw") {
    __TEMPLATE_MODE__ = mode === "clean" ? "clean" : "raw";
}
function getTemplateMode() {
    return __TEMPLATE_MODE__;
}

// Utility minime
function fixTyposRaw(s) {
    // Solo correzioni ortografiche palesi senza cambiare struttura o link
    return s
        .replace(/smarthphone/gi, "smartphone")
        .replace(/nvoastudia/gi, "novastudia")
        .replace(/Elearning/gi, "E-learning")
        .replace(/d’/g, "d'")
        .replace(/\s+/g, " ")
        .trim();
}

// parser esito invii per restituire flag ok/bcc/pec
function parseEsitoInvii(esito) {
    const lower = (esito || "").toLowerCase();
    return {
        emailOk: /errore invio email/i.test(esito) ? false : /@/.test(esito),
        bccOk: /bcc/i.test(lower),
        pecOk: /pec/i.test(lower) || /@pec\./i.test(lower),
    };
}

async function reinviamail(iduser, idcourse, email, firstname, lastname, userid, code, corso, db) {

    if (!iduser || !email || !db) {
        return res.status(400).json({ error: "Parametri mancanti" });
    }

    const conn = await getConnection(db);
    try {
        // 🔹 Recupera dati anagrafici
        const [fields] = await conn.query(
            `SELECT id_common, user_entry FROM core_field_userentry WHERE id_user = ? ORDER BY id_common ASC`,
            [iduser]
        );

        const getField = (id) =>
            fields.find((r) => r.id_common === id)?.user_entry?.toString() || "";

        const nominativo = `${firstname} ${lastname}`;
        const cf = getField(23);
        const emailfatt = `${getField(24)};${getField(15)}`;
        const pecutente = getField(31);
        const convenzione = getField(25);
        const passwordreal = getField(26);

        // 🔹 Recupera info convenzione (db wpacquisti)
        const connW = await getConnection("wpacquisti");

        let nomesito = "";
        let piattaforma = "";
        let bcc = "";

        if (convenzione) {
            const [convRows] = await connW.query(
                `SELECT name, piattaforma, indirizzoweb, newindirizzoweb, oldindirizzoweb, mailbcc 
                 FROM newconvenzioni WHERE name LIKE ? LIMIT 1`,
                [`%${convenzione}%`]
            );

            if (convRows.length) {
                const conv = convRows[0];
                if (db === "formazionein") nomesito = conv.oldindirizzoweb;
                else if (db === process.env.MYSQL_FORMA4) nomesito = conv.newindirizzoweb;
                else nomesito = conv.indirizzoweb;

                piattaforma = conv.piattaforma;
                bcc = `${conv.mailbcc};${emailfatt}`;
            }
        } else {
            const [defaultConv] = await connW.query(
                `SELECT name, piattaforma, indirizzoweb, mailbcc 
                 FROM newconvenzioni WHERE name='Formazione Intermediari' LIMIT 1`
            );
            const def = defaultConv[0];
            if (db === "formazionein") nomesito = def.oldindirizzoweb;
            else nomesito = def.indirizzoweb;
            piattaforma = def.piattaforma;
            bcc = `${def.mailbcc};${emailfatt}`;
        }

        // 🔹 Invia mail con SaveAndSend
        const result = await SaveAndSend({
            idcourse,
            email,
            pec: pecutente,
            nominativo,
            username: userid,
            password: passwordreal,
            convenzione,
            corso,
            bcc,
            tipo: "benvenuto",
            cf,
            nomesito,
        });

        logwrite(`📧 Reinviata mail a ${email} (${nominativo})`);

        res.json({ success: true, message: "Mail di benvenuto reinviata correttamente", result });
    } catch (err) {
        logwrite("❌ Errore reinviamail: " + err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        conn.release?.();
    }
}

async function SaveAndSend({
    idcourse,
    file = "",
    nominativo,
    email,
    pec,
    code,
    nomesito,
    _username,
    _password,
    convenzione,
    nomecorso,
    sede = "",
    format = "benvenuto",
    bcc = "",
    ifsend = true,
    datattivazione = "",
    codfis = "",
    codicesconto = "",
}) {
    let esito = "";
    let flags = { emailOk: false, bccOk: false, pecOk: false };

    if (format === "extra") {
        esito = await SendExtra({
            idcourse,
            nominativo,
            nomesito,
            codfis,
            convenzione,
            corso: code,
            nomecorso,
            bcc,
            email,
            pec,
            file,
            ifsend,
            datattivazione,
            username: _username,
            password: _password,
        });
    } else if (format === "benvenuto") {
        esito = await SendBenvenuto({
            idcourse,
            nominativo,
            nomesito,
            codfis,
            convenzione,
            corso: code,
            nomecorso,
            bcc,
            email,
            pec,
            file,
            ifsend,
            datattivazione,
            codicesconto,
            username: _username,
            password: _password,
        });
    } else if (format === "attestato") {
        esito = await SendAttestato({
            idcourse,
            code,
            nomecorso,
            nominativo,
            bcc,
            email,
            pec,
            file,
            convenzione,
        });
    }

    flags = parseEsitoInvii(esito);
    return { esito, ...flags };
}

// ----------- SEND ATTESTATO ---------------------------------------------------
async function SendAttestato({
    idcourse,
    code,
    nomecorso,
    nominativo,
    bcc,
    email,
    pec,
    file,
    convenzione,
}) {
    let subject = `Attestato - ${code} - ${nominativo}`;
    let body = "";
    const mode = getTemplateMode();

    if (/^novastudia$/i.test(convenzione)) {
        body = `<div style='text-align:justify'><span style='font-family:Times New Roman;font-size:14pt;color:#00314C'>
Gentile Utente, <br>complimenti per aver concluso con esito positivo il corso <b> "${nomecorso}"</b>.<br>
Auspicando di poter ancora collaborare con Lei, cogliamo l'occasione per ringraziarLa di averci scelto ed inviamo in allegato il certificato abilitante.<br><br></div>
Restando a disposizione per eventuali chiarimenti.<br>${piedinonovastudia}`;
        if (mode === "raw") body = fixTyposRaw(body); else body = cleanHTML(fixTyposRaw(body));
        if (pec) {
            const es1 = await invioMailPEC({ from: "didattica@pec.rbconsulenza.com", to: pec, subject, html: body, attachments: file ? [file] : [] });
            const es2 = await invioMail({ from: "info@novastudia.academy", to: email, subject, html: body, bcc, attachments: file ? [file] : [] });
            return `${es1} ${es2}`;
        }
        return await invioMail({ from: "info@novastudia.academy", to: email, subject, html: body, bcc, attachments: file ? [file] : [] });
    }

    if (/^rb academy$/i.test(convenzione)) {
        body = `<div style='text-align:justify'><span style='font-family:Times New Roman;font-size:14pt;color:#00314C'>
Gentile Utente, <br>complimenti per aver concluso con esito positivo il corso <b> "${nomecorso}"</b>.<br>
Auspicando di poter ancora collaborare con Lei, cogliamo l'occasione per ringraziarLa di averci scelto ed inviamo in allegato il certificato abilitante.<br><br></div>
Restando a disposizione per eventuali chiarimenti.<br>${piedinorbacademy}`;
        if (mode === "raw") body = fixTyposRaw(body); else body = cleanHTML(fixTyposRaw(body));
        if (pec) {
            const es1 = await invioMailPEC({ from: "didattica@pec.rbconsulenza.com", to: pec, subject, html: body, attachments: file ? [file] : [] });
            const es2 = await invioMail({ from: "info@rb-academy.it", to: email, subject, html: body, bcc, attachments: file ? [file] : [] });
            return `${es1} ${es2}`;
        }
        return await invioMail({ from: "info@rb-academy.it", to: email, subject, html: body, bcc, attachments: file ? [file] : [] });
    }

    if (/^assiac$/i.test(convenzione) || /^www\.assiac\.it$/i.test(convenzione)) {
        const pedinoAssiac = `<div>${/* testo piedino da GetPedino("www.rb-academy.it"/"www.assiac.it") */""}${piedinorbacademy}</div>`;
        body = `<div style='text-align:justify'><span style='font-family:Times New Roman;font-size:14pt;color:#00314C'>
Gentile corsista, <br>complimenti per aver concluso con esito positivo il <b>"${nomecorso}"</b>.<br>
Auspicando di poter ancora collaborare con Lei, cogliamo l'occasione per ringraziarLa di averci scelto ed inviamo in allegato il certificato abilitante.<br><br></div>
Restando a disposizione per eventuali chiarimenti.<br>${pedinoAssiac}`;
        if (mode === "raw") body = fixTyposRaw(body); else body = cleanHTML(fixTyposRaw(body));
        const from = "info@rb-academy.it";
        if (pec) {
            const es1 = await invioMailPEC({ from: "didattica@pec.rbconsulenza.com", to: pec, subject, html: body, attachments: file ? [file] : [] });
            const es2 = await invioMail({ from, to: email, subject, html: body, bcc, attachments: file ? [file] : [] });
            return `${es1} ${es2}`;
        }
        return await invioMail({ from, to: email, subject, html: body, bcc, attachments: file ? [file] : [] });
    }

    // DEFAULT (Formazione Intermediari)
    body = `<div style='text-align:justify'><span style='font-family:Times New Roman;font-size:14pt;color:#00314C'>
Gentile Utente, <br>complimenti per aver concluso con esito positivo il corso <b>"${nomecorso}"</b>.<br>
Auspicando di poter ancora collaborare con Lei, cogliamo l'occasione per ringraziarLa di averci scelto ed inviamo in allegato il certificato abilitante.<br><br></div>
Cordiali saluti, <br>${piedino}`;
    if (mode === "raw") body = fixTyposRaw(body); else body = cleanHTML(fixTyposRaw(body));
    if (pec) {
        const es1 = await invioMailPEC({ from: "didattica@pec.rbconsulenza.com", to: pec, subject, html: body, attachments: file ? [file] : [] });
        const es2 = await invioMail({ from: "info@formazioneintermediari.com", to: email, subject, html: body, bcc, attachments: file ? [file] : [] });
        return `${es1} ${es2}`;
    }
    return await invioMail({ from: "info@formazioneintermediari.com", to: email, subject, html: body, bcc, attachments: file ? [file] : [] });
}

// ----------- SEND EXTRA (come VB) --------------------------------------------
async function SendExtra({
    idcourse,
    nominativo,
    nomesito,
    codfis,
    convenzione,
    corso,
    nomecorso,
    bcc,
    email,
    pec,
    file,
    ifsend,
    datattivazione,
    username,
    password,
}) {
    const finale = "o"; // “LetturaCodiceFiscale(codfis)” -> qui irrilevante per il testo
    let subject = `Benvenut${finale} ${nominativo}`;
    let body = `<div style='text-align:justify'><span style='font-family:Times New Roman;font-size:14pt;color:#00314C'>
Gentile Utente <b>${nominativo}</b>,<br>
con la presente siamo lieti di informarla che le abbiamo attivato gratuitamente il nuovo corso...<br>
<b>Username:</b> ${username}<br><b>Password:</b> ${password}</span></div>
<p>Di seguito le diverse modalità per accedere alla piattaforma:<br>
- da pc: <a href='${nomesito}'>${nomesito}</a>;<br>
- da dispositivo mobile: <a href='${nomesito}'>${nomesito}</a>.</p>
<p style='text-align:justify;line-height:130%'><center><b><u><span style='font-family:Times New Roman;font-size:14pt;color:#00314C'>SERVIZIO ASSISTENZA CLIENTI</span></u></b></center></p>
<p>Mail: info@formazioneintermediari.com / supporto@formazioneintermediari.com<br>
Fax: 0823-1870053<br>
Telefono: 800.69.99.92</p>${piedino}`;

    body = getTemplateMode() === "raw" ? fixTyposRaw(body) : cleanHTML(fixTyposRaw(body));

    if (pec) {
        const es1 = await invioMailPEC({ from: "didattica@pec.rbconsulenza.com", to: pec, subject, html: body, attachments: file ? [file] : [] });
        const es2 = await invioMail({ from: "info@formazioneintermediari.com", to: email, subject, html: body, bcc, attachments: file ? [file] : [] });
        return `${es1} ${es2}`;
    }
    return await invioMail({ from: "info@formazioneintermediari.com", to: email, subject, html: body, bcc, attachments: file ? [file] : [] });
}

// ----------- SEND BENVENUTO (tutti i casi del VB .Select Case) ---------------
async function SendBenvenuto({
    idcourse,
    nominativo,
    nomesito,
    codfis,
    convenzione,
    corso,
    nomecorso,
    bcc,
    email,
    pec,
    file,
    ifsend,
    datattivazione,
    codicesconto = "",
    username,
    password,
}) {
    const finale = "o"; // come nel VB
    let subject = `Benvenut${finale} ${nominativo.replace("\\", "")}`;
    let body = "";
    const mode = getTemplateMode();
    const blockCred = `• <b>Username:</b> ${username}<br/>• <b>Password:</b> ${password}`;


    // --- Case: ASSIAC - Concetta
    if (/^ASSIAC - Concetta$/i.test(convenzione)) {
        body = `<div style='text-align:justify'><span style='font-family:Times New Roman;font-size:14pt;color:#00314C'>
Gentile Utente <b>${nominativo}</b>,<br>
benvenuto al corso e-learning <b>"${nomecorso}"</b>.<br>
Da questo momento può accedere ...<br>${blockCred}<br>
<p>Accesso:<br>- da pc: <a href='${nomesito}'>${nomesito}</a>;<br>- da dispositivo mobile: <a href='${nomesito}'>${nomesito}</a>.</p>
... (testo invariato dal VB.NET) ...
</span></div>`;
        body = mode === "raw" ? fixTyposRaw(body) : cleanHTML(fixTyposRaw(body));
        if (pec) {
            const es1 = await invioMailPEC({ from: "didattica@pec.rbconsulenza.com", to: pec, subject, html: body, attachments: file ? [file] : [] });
            const es2 = await invioMail({ from: "info@rbconsulenza.com", to: email, subject, html: body, bcc, attachments: file ? [file] : [] });
            return `${es1} ${es2}`;
        }
        return await invioMail({ from: "info@rbconsulenza.com", to: email, subject, html: body, bcc, attachments: file ? [file] : [] });
    }

    // --- Case: Assiac / RB Academy (stesso testo VB)
    if (/^(Assiac|RB Academy)$/i.test(convenzione)) {
        body = `<div style='text-align:justify'><span style='font-family:Times New Roman;font-size:14pt;color:#00314C'>
Gentile Utente <b>${nominativo}</b>,<br>
benvenuto al corso e-learning <b>"${nomecorso}"</b>.<br>
${blockCred}<br>
<p>Accesso:<br>• da pc: <a href='${nomesito}'>${nomesito}</a>;<br>• da dispositivo mobile: <a href='${nomesito}'>${nomesito}</a>.</p>
Il corso ha validità di 1 anno dalla data di attivazione...
<p style='text-align:justify;line-height:130%'><center><b><u><span style='font-family:Times New Roman;font-size:14pt;color:#00314C'>SERVIZIO ASSISTENZA CLIENTI</span></u></b></center></p>
<p>• via Mail: info@rb-academy.it<br>• via Telefono: 800.69.99.92</p>
${piedinorbacademy}</span></div>`;
        body = mode === "raw" ? fixTyposRaw(body) : cleanHTML(fixTyposRaw(body));
        if (pec) {
            const es1 = await invioMailPEC({ from: "didattica@pec.rbconsulenza.com", to: pec, subject, html: body });
            const es2 = await invioMail({ from: "info@rb-academy.it", to: email, subject, html: body, bcc });
            return `${es1} ${es2}`;
        }
        return await invioMail({ from: "info@rb-academy.it", to: email, subject, html: body, bcc });
    }

    // --- Case: NOVASTUDIA
    if (/^NOVASTUDIA$/i.test(convenzione)) {
        body = `<div style='text-align:justify'><span style='font-family:Times New Roman;font-size:14pt;color:#00314C'>
Gentile Utente <b>${nominativo}</b>,<br>
benvenuto al corso e-learning <b>"${nomecorso}"</b>.<br>
${blockCred}<br>
<p>Accesso:<br>• da pc: <a href='${nomesito}'>${nomesito}</a>;<br>• da dispositivo mobile: <a href='${nomesito}'>${nomesito}</a>.</p>
Il corso ha validità di 1 anno dalla data di attivazione...
<p style='text-align:justify;line-height:130%'><center><b><u><span style='font-family:Times New Roman;font-size:14pt;color:#00314C'>SERVIZIO ASSISTENZA CLIENTI</span></u></b></center></p>
<p>• via Mail: supporto@novastudia.academy<br>• via Telefono: 800.69.99.92</p>
${piedinonovastudia}</span></div>`;
        body = mode === "raw" ? fixTyposRaw(body) : cleanHTML(fixTyposRaw(body));
        if (pec) {
            const es1 = await invioMailPEC({ from: "didattica@pec.rbconsulenza.com", to: pec, subject, html: body });
            const es2 = await invioMail({ from: "info@novastudia.academy", to: email, subject, html: body, bcc });
            return `${es1} ${es2}`;
        }
        return await invioMail({ from: "info@novastudia.academy", to: email, subject, html: body, bcc });
    }


    // --- Case Ventidue Broker (flag ventidue nel VB): testo dedicato
    if (/Ventidue Broker/i.test(convenzione)) {
        subject = "Ventidue Broker d' Assicurazioni Srl - Aggiornamento IVASS 30h";
        body = `<div style='text-align:justify'><span style='font-family:Times New Roman;font-size:14pt;color:#00314C'>
Gentile Collaboratore <b>${nominativo}</b>,<br>
siamo lieti di comunicare che, in collaborazione con RB Consulting, inviamo le credenziali per accedere al <b>"${nomecorso}"</b>.<br>
${blockCred}<br>
<p>Accesso:<br>• da pc o mobile: <a href='${nomesito}'>${nomesito}</a><br>
Ricordiamo che la conclusione del corso dovrà essere entro il 30.09.2022.</p>
<p>Assistenza: info@formazioneintermediari.com / supporto@formazioneintermediari.com – Tel. 800.69.99.92</p>
${piedino}
<br/><br/><i><span style='font-family:Times New Roman;font-size:14pt;font-style:italic;color:#00314C'>
<b>Ventidue Broker d'Assicurazioni S.r.l.</b><br/>Giulia Marcucci - Ufficio Commerciale Prodotti <br/>
Via Cesare Beccaria 16 - 00196 Roma <br/>tel. +39 0687153554 • cel. +39 3335799654<br/>
PEC: ventiduebrokersrl@legalmail.it • Contatti: info@ventiduebroker.it</span></i></div>`;
        body = mode === "raw" ? fixTyposRaw(body) : cleanHTML(fixTyposRaw(body));
        if (pec) {
            const es1 = await invioMailPEC({ from: "didattica@pec.rbconsulenza.com", to: pec, subject, html: body });
            const es2 = await invioMail({ from: "info@formazioneintermediari.com", to: email, subject, html: body, bcc });
            return `${es1} ${es2}`;
        }
        // solo se ifsend true come VB
        if (ifsend) {
            return await invioMail({ from: "info@formazioneintermediari.com", to: email, subject, html: body, bcc });
        }
        return "";
    }

    // --- DEFAULT: Formazione Intermediari
    body = `<div style='text-align:justify'><span style='font-family:Times New Roman;font-size:14pt;color:#00314C'>
Gentile Utente <b>${nominativo}</b>,<br>
benvenuto al corso e-learning <b>"${nomecorso}"</b>.<br>
${blockCred}

<p>
  Di seguito le diverse modalità per accedere alla piattaforma didattica:<br>
  • da pc: <a href="${nomesito}" target="_blank">${nomesito}</a>;<br>
  • da dispositivo mobile: <a href="${nomesito}" target="_blank">${nomesito}</a>
  (la piattaforma è compatibile con smartphone e tablet).<br><br>
</p>

<p style="text-align:justify;line-height:130%">
  <center>
    <b><u>
      <span style="font-family:Times New Roman;font-size:14pt;color:#00314C">
        SERVIZIO ASSISTENZA CLIENTI
      </span>
    </u></b>
  </center>
</p>

<p>
  Per qualsiasi dubbio o richiesta di informazioni che riguardino la didattica, il sito e la piattaforma di formazione, ci contatti:<br>
  • via <b>Mail</b>, 24h su 24h, 7 giorni su 7: 
    <a href="mailto:info@formazioneintermediari.com">info@formazioneintermediari.com</a>
    oppure 
    <a href="mailto:supporto@formazioneintermediari.com">supporto@formazioneintermediari.com</a>;<br>
  • via <b>Telefono</b>, dal Lunedì al Venerdì dalle 09.30 alle 13.00 e dalle 14.00 alle 18.00, al numero: 
    <b>800.69.99.92</b>.<br>
  Eventuali problemi al sistema saranno risolti al massimo nelle 24 ore successive.
</p>

<p>
  Restiamo a Sua disposizione per qualsiasi chiarimento, auspicando che il corso possa essere di Suo gradimento oltre che utile all'esercizio della Sua attività professionale.
</p>

<p>Cordiali saluti,</p>

${piedino}

</span></div>`;
    body = mode === "raw" ? fixTyposRaw(body) : cleanHTML(fixTyposRaw(body));
    if (pec) {
        const es1 = await invioMail({ from: "info@formazioneintermediari.com", to: email, subject, html: body, bcc, attachments: file ? [file] : [] });
        const es2 = await invioMailPEC({ from: "didattica@pec.rbconsulenza.com", to: pec, subject, html: body, attachments: file ? [file] : [] });
        return `${es1} ${es2}`;
    }
    if (ifsend) {
        return await invioMail({ from: "info@formazioneintermediari.com", to: email, subject, html: body, bcc, attachments: file ? [file] : [] });
    }
    return "";
}




// ============================================================
// Utils
// ============================================================
function toMySQLDateTime(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return (
        d.getFullYear() +
        "-" +
        pad(d.getMonth() + 1) +
        "-" +
        pad(d.getDate()) +
        " " +
        pad(d.getHours()) +
        ":" +
        pad(d.getMinutes()) +
        ":" +
        pad(d.getSeconds())
    );
}
async function getMailFormat(format = "mailformat") {
    try {
        const connFormat = await getConnection("wpacquisti"); // ✅ stesso DB del VB
        const [rows] = await connFormat.query(
            `SELECT meta_value 
             FROM impostazioni 
             WHERE meta_key = ?
             ORDER BY meta_key ASC
             LIMIT 1`,
            [format]
        );

        if (!rows.length) {
            console.error("⚠️ getMailFormat: Nessun template trovato per", format);
            return "";
        }

        return rows[0].meta_value;
    } catch (err) {
        console.error("❌ getMailFormat ERR:", err.message);
        return "";
    }
}

/* =======================================================
   🔹 FUNZIONI BASE
   ======================================================= */




function EscapeStr(value) {
    if (!value) return "";
    return value.replace(/'/g, "''").trim();
}

function Normalizza(str) {
    if (!str) return "";
    return str
        .replace(/à/g, "a'")
        .replace(/ù/g, "u'")
        .replace(/è/g, "e'")
        .replace(/ì/g, "i'")
        .replace(/ò/g, "o'")
        .replace(/é/g, "e'")
        .trim();
}

function ConvertToMysqlDateTime(date) {
    if (!date) return null;
    const d = new Date(date);
    const pad = (n) => (n < 10 ? "0" + n : n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
        d.getDate()
    )} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function CreateRandomPassword(length = 6, numericOnly = false) {
    const chars = numericOnly
        ? "0123456789"
        : "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNOPQRSTUVWXYZ";
    return Array.from({ length }, () =>
        chars.charAt(Math.floor(Math.random() * chars.length))
    ).join("");
}

function getMd5Hash(input) {
    return crypto.createHash("md5").update(input).digest("hex");
}

function FormattaNominativo(nominativo) {
    if (!nominativo) return "";
    return nominativo
        .toLowerCase()
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

function GetPedino(domain) {
    return `<i><b>${domain}</b></i>`;
}

/* =======================================================
   🔹 LOGGING / FILESYSTEM
   ======================================================= */

function logwrite(message) {
    try {
        const dir = PATHS.LOG
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${dayjs().format("YYYY-MM-DD")}.log`);
        const line = `[${dayjs().format("HH:mm:ss")}] ${message}\n`;
        fs.appendFile(file, line, (err) => {
            if (err) console.error("Errore scrittura log:", err);
        });
    } catch (err) {
        console.error("Errore logwrite:", err.message);
    }
}

async function downloadRemoteFile(url, destFolder = "certificati") {
    try {
        const dir = path.join(process.cwd(), destFolder);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filename = url.split("/").pop();
        const destPath = path.join(dir, filename);
        const response = await axios.get(url, { responseType: "arraybuffer" });
        fs.writeFileSync(destPath, response.data);
        return destPath;
    } catch (err) {
        console.error("Errore download file:", err.message);
        return null;
    }
}

/* =======================================================
   🔹 DATABASE UTILITY
   ======================================================= */

async function adddetails(idcommon, idst, value, cn) {
    if (!value) return;
    const valEsc = EscapeStr(value);
    try {
        await cn.query(
            `INSERT INTO core_field_userentry (id_common, id_user, user_entry)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE user_entry = VALUES(user_entry)`,
            [idcommon, idst, valEsc]
        );
    } catch (err) {
        await logwrite("Errore adddetails: " + err.message);
    }
}

async function findusername(username, nome, cognome, cn) {
    let tmp = username;
    let i = 1;
    let [rows] = await cn.query(`SELECT userid FROM core_user WHERE userid = ?`, [
        `/${tmp}`,
    ]);
    while (rows.length >= 1) {
        tmp = `${username.toLowerCase()}${i++}`;
        [rows] = await cn.query(`SELECT userid FROM core_user WHERE userid = ?`, [
            `/${tmp}`,
        ]);
    }
    return tmp;
}

async function GetIfUserExist(nome, cognome, codfis, email, cn, convenzione) {
    try {
        const [rows] = await cn.query(
            `
            SELECT idst, userid 
            FROM core_user 
            WHERE firstname=? AND lastname=? 
              AND idst IN (
                SELECT id_user FROM core_field_userentry WHERE id_common=23 AND user_entry=?
              )
              AND idst IN (
                SELECT id_user FROM core_field_userentry WHERE id_common=25 AND user_entry=?
              )
            ORDER BY register_date DESC
            `,
            [nome, cognome, codfis, convenzione]
        );
        return rows.length ? rows : null;
    } catch (ex) {
        await logwrite("Errore GetIfUserExist: " + ex.message);
        return null;
    }
}



/**
 * ✅ Controlla duplicati tra email normale e emailfattura nella lista BCC
 */
function checkEmail(email, emailFattura, bcc) {
    let s = "";
    const emailLow = (email || "").trim().toLowerCase();
    const emailFatturaLow = (emailFattura || "").trim().toLowerCase();

    if (bcc) {
        const list = bcc
            .toLowerCase()
            .replace(/\t/g, "")
            .split(";")
            .filter(x => x.trim() !== "");

        // rimuovo indirizzi già presenti
        const filtered = list.filter(addr =>
            addr !== emailLow &&
            addr !== emailFatturaLow
        );

        s = `${emailFatturaLow};${filtered.join(";")};`;
    } else if (emailFatturaLow !== emailLow) {
        s = emailFatturaLow;
    }

    return s;
}

/**
 * ✅ Recupera mail BCC da convenzione WP + email fattura da process.env.MYSQL_FORMA4
 */
async function getBCC(iduser) {
    try {
        const connForma = await getConnection(process.env.MYSQL_FORMA4);
        const connWP = await getConnection("wpacquisti");

        let mailbcc = "";
        let emailfattura = "";

        // 1️⃣ convenzione utente → BCC
        const [conv] = await connForma.query(
            `SELECT c.user_entry AS convenzione
             FROM core_user a 
             JOIN core_field_userentry c ON a.idst = c.id_user
             WHERE c.id_common = 25 AND a.idst = ?`,
            [iduser]
        );

        if (conv.length) {
            const convenzione = conv[0].convenzione;

            const [bccRow] = await connWP.query(
                `SELECT mailbcc 
                 FROM newconvenzioni 
                 WHERE name = ? LIMIT 1`,
                [convenzione]
            );

            if (bccRow.length) {
                mailbcc = (bccRow[0].mailbcc || "").toLowerCase().trim();
            }
        }

        // 2️⃣ email fattura
        const [fatt] = await connForma.query(
            `SELECT c.user_entry AS emailfattura
             FROM core_user a 
             JOIN core_field_userentry c ON a.idst = c.id_user
             WHERE c.id_common = 15 AND a.idst = ?`,
            [iduser]
        );

        if (fatt.length) {
            emailfattura = (fatt[0].emailfattura || "").toLowerCase().trim();
        }

        return checkEmail("", emailfattura, mailbcc);
    } catch (err) {
        console.error("❌ getBCC ERR:", err.message);
        return "";
    }
}

/* =======================================================
   🔹 EXPORT
   ======================================================= */
/**
 * ✅ Replica VB: IscriviaSimulazione
 */
async function IscriviaSimulazione(idst, idcorso, dataiscrizione, cn, dbName) {
    try {
        const connection = cn || (dbName ? await getConnection(dbName) : null);
        if (!connection) throw new Error("Connessione non valida per IscriviaSimulazione");
        const date = ConvertToMysqlDateTime(new Date(dataiscrizione));
        await connection.query(
            `INSERT INTO learning_courseuser
            (idUser, idCourse, level, date_inscr, waiting, imported_from_connection, absent, cancelled_by, new_forum_post)
            VALUES (?, ?, 3, ?, 0, 1039, 0, 0, 0)`,
            [idst, idcorso, date]
        );

        const [g] = await connection.query(
            `SELECT idst FROM core_group 
             WHERE groupid LIKE ? LIMIT 1`,
            [`%/lms/course/${idcorso}/subscribed/3%`]
        );

        if (g.length) {
            const idstgroup = g[0].idst;
            await connection.query(
                `INSERT INTO core_group_members (idst, idstMember)
                 VALUES (?, ?)`,
                [idstgroup, idst]
            );
        }
    } catch (err) {
        await logwrite("Errore IscriviaSimulazione: " + err.message);
    }
}

/**
 * ✅ Replica VB: IscriviCorsi
 */
async function IscriviCorsi(idst, idcorso, cn, dbName) {
    try {
        const connection = cn || (dbName ? await getConnection(dbName) : null);
        if (!connection) throw new Error("Connessione non valida per IscriviCorsi");
        const date = ConvertToMysqlDateTime(new Date());
        await connection.query(
            `INSERT INTO learning_courseuser
            (idUser, idCourse, level, date_inscr, waiting, imported_from_connection, absent, cancelled_by, new_forum_post)
            VALUES (?, ?, 3, ?, 0, 1039, 0, 0, 0)`,
            [idst, idcorso, date]
        );

        const [g] = await connection.query(
            `SELECT idst FROM core_group 
             WHERE groupid LIKE ? LIMIT 1`,
            [`%/lms/course/${idcorso}/subscribed/3%`]
        );

        if (g.length) {
            const idstgroup = g[0].idst;
            await connection.query(
                `INSERT INTO core_group_members (idst, idstMember)
                 VALUES (?, ?)`,
                [idstgroup, idst]
            );
        }
    } catch (err) {
        await logwrite("Errore IscriviCorsi: " + err.message);
    }
}

async function getVoto(conn, iduser, idcorso) {

    try {
        const [rows] = await conn.query(
            `
            SELECT b.score_max, a.score
            FROM learning_testtrack a
            JOIN learning_test b ON a.idtest = b.idtest
            WHERE b.idtest = (
                SELECT idresource
                FROM learning_organization
                WHERE isterminator = 1 AND idcourse = ?
            )
            AND a.iduser = ?
            LIMIT 1
            `,
            [idcorso, iduser]
        );



        if (rows.length === 0) return "";

        const r = rows[0];
        return `${r.score}/${r.score_max}`;
    } catch (err1) {
        console.error("❌ getVoto ERR:", err1.message);
        return "";

    }
}

async function getLastTest(lastid, idcourse, firstname, lastname, db, savefile = false, options = 1, res = null) {
    const conn = await getConnection(db); // ✅ sempre questa connessione
    const nomeutente = formattaNominativo(`${firstname} ${lastname}`);
    const header = await getMailFormat("header");
    const footer = await getMailFormat("footer");
    try {

        let whereClause = "";
        if (typeof options === "number") {
            whereClause = "isterminator = ?";
        } else if (typeof options === "string") {
            whereClause = "objecttype = ?";
        } else {
            throw new Error("Parametro 'options' non valido");
        }

        const [rows] = await conn.query(`
            SELECT 
                idtrack,
                date_attempt,
                date_end_attempt,
                idtest,
                (SELECT code FROM learning_course WHERE idcourse = ?) AS code
            FROM learning_testtrack
            WHERE idreference IN (
                SELECT idorg FROM learning_organization
                WHERE idcourse = ? AND isterminator = 1  
            )
            AND iduser = ?
            ORDER BY date_attempt DESC
            LIMIT 1
        `, [idcourse, idcourse, lastid]);

        if (!rows || rows.length === 0) {
            console.log("Nessun test trovato per l’utente:", lastid);
            if (res) {
                return res.status(404).json({
                    success: false,
                    message: "Nessun test trovato per questo utente",
                });
            }
            return null;
        }

        const dr = rows[0];
        const code = dr.code;
        const idtest = dr.idtest;
        const idlog = dr.idtrack;
        const dateattempt = dr.date_attempt;
        const dateendattempt = dr.date_end_attempt;



        // 2️⃣ Recupera risposte test
        let sqlresult = `
      SELECT c.title_quest, b.answer, score_correct, score_assigned, b.idanswer
      FROM (learning_testquestanswer b
            JOIN learning_testtrack_answer a ON a.idanswer = b.idanswer)
      JOIN learning_testquest c ON c.idQuest = a.idQuest
      WHERE idtrack = ?
      ORDER BY a.idquest ASC
    `;
        const [dtresult] = await conn.query(sqlresult, [idlog]);

        // 3️⃣ Gestione varianti per corso
        let sqlquest;
        if (idcourse == 412 && dtresult.length < 30) {
            sqlquest = `
        SELECT idquest FROM learning_testquest
        WHERE idquest IN (
          SELECT c.idquest FROM (learning_testquestanswer b
          JOIN learning_testtrack_answer a ON a.idanswer = b.idanswer)
          JOIN learning_testquest c ON c.idQuest = a.idQuest
          WHERE idtrack = ?
        )
        UNION
        SELECT idquest FROM learning_testquest m
        JOIN learning_test n ON m.idtest = n.idtest
        WHERE n.idtest = ?
        LIMIT 30
      `;
        } else if (idcourse == 399 || idcourse == 419) {
            sqlquest = `
        SELECT idquest FROM learning_testquest
        WHERE idquest IN (
          SELECT c.idquest FROM (learning_testquestanswer b
          JOIN learning_testtrack_answer a ON a.idanswer = b.idanswer)
          JOIN learning_testquest c ON c.idQuest = a.idQuest
          WHERE idtrack = ?
        )
        UNION
        SELECT idquest FROM learning_testquest m
        JOIN learning_test n ON m.idtest = n.idtest
        WHERE n.idtest = ?
        LIMIT 15
      `;
        } else if (dtresult.length < 20) {
            sqlquest = `
        SELECT idquest FROM learning_testquest
        WHERE idquest IN (
          SELECT c.idquest FROM (learning_testquestanswer b
          JOIN learning_testtrack_answer a ON a.idanswer = b.idanswer)
          JOIN learning_testquest c ON c.idQuest = a.idQuest
          WHERE idtrack = ?
        )
        UNION
        SELECT idquest FROM learning_testquest m
        JOIN learning_test n ON m.idtest = n.idtest
        WHERE n.idtest = ?
        LIMIT 20
      `;
        } else {
            sqlquest = `
        SELECT idquest FROM learning_testquest
        WHERE idquest IN (
          SELECT c.idquest FROM (learning_testquestanswer b
          JOIN learning_testtrack_answer a ON a.idanswer = b.idanswer)
          JOIN learning_testquest c ON c.idQuest = a.idQuest
          WHERE idtrack = ?
        )
        ORDER BY idquest ASC
      `;
        }

        const [dtquest] = await conn.query(sqlquest, [idlog, idtest]);
        const voto = await getVoto(conn, lastid, idcourse);
        console.log("il voto è", voto);
        // 4️⃣ Costruzione HTML
        let html = `
      <center>${header}<h3><u><b>Test di verifica finale - questionario somministrato</b><br>
      <b>${await getNomeCorsoById(idcourse, conn)}</b></u></h3><br></center>
      - Nome utente: <b>${firstname} ${lastname}</b><br>
      - Data fine test: <b>${dayjs(dateendattempt).format("DD/MM/YYYY HH:MM")}</b><br>
      - Punteggio test: <b>${voto}</b><br>
    `;

        // 5️⃣ Ciclo domande
        let i = 1;
        for (const q of dtquest) {
            const [rowsQuest] = await conn.query(`
        SELECT * FROM learning_testquest a
        JOIN learning_testquestanswer b ON a.idquest = b.idQuest
        WHERE a.idquest = ?
        ORDER BY a.idQuest ASC, b.idanswer ASC
      `, [q.idquest]);

            if (rowsQuest.length === 0) continue;
            const question = rowsQuest[0].title_quest;
            let answerHtml = "";

            for (const ans of rowsQuest) {
                const corrected = await getCorrect(ans.idAnswer, ans.answer, dtresult);

                answerHtml += `<li>${corrected.html}</li>`;

            }

            html += `<br><b>${i}. ${question}</b><ol type="a">${answerHtml}</ol>`;
            i++;
        }

        html += `  <div style="line-height: 16px;">
<p style="text-align: center;"><span style="font-size: 14px;"><span style="font-family: 'Times New Roman',serif;"><strong><em><span style="color: #00314c;">RB Consulting S.r.l.</span></em></strong></span></span><br><span style="font-size: 12px;"><span style="font-family: 'Times New Roman',serif;"><em><span style="color: #00314c;">via Crescenzio, 25 - 00193 Roma (RM)</span></em></span><br><span style="font-family: 'Times New Roman',serif;"><em><span style="color: #00314c;">P.I.: 17044041006- Numero RE<span style="line-height: 16px;"><span style="text-align: center;">A: RM 1692224&nbsp;</span></span></span></em></span></span><br><span style="font-size: 12px;"><span style="font-family: 'Times New Roman',serif;"><em><span style="color: #00314c;">Ente con certificazione di qualit&agrave; UNI EN ISO 9001:2015</span></em></span></span></p>
<p>&nbsp;</p>
</div>`;

        // 🔹 Generazione file PDF
        const reportsDir = path.resolve(__dirname, "../public/ultimotest");
        if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
        const filename = `Test Finale - ${code} - ${nomeutente} - ${lastid}.pdf`;
        const pdfFile = path.join(reportsDir, filename);
        console.log("🧾 Generazione test per:", nomeutente);

        // 🔹 Generazione PDF
        const browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle0" });

        // 🔸 Salva direttamente su file (non solo buffer)
        await page.pdf({
            path: pdfFile, // <-- SCRIVE SU DISCO
            format: "A4",
            landscape: true,
            printBackground: true,
            displayHeaderFooter: true,
            margin: { top: "70px", bottom: "60px", left: "20px", right: "20px" },
            headerTemplate: "<div></div>",
            footerTemplate: `
  
               
           `,
        });

        await browser.close();
        console.log("✅ Test generato:", pdfFile);
        console.log("📂 File exists after write?", fs.existsSync(pdfFile));

        // 🔹 Comportamento diverso in base al contesto
        if (savefile) {
            // Chiamato da sendcertificate → ritorna percorso assoluto
            return pdfFile;
        } else if (res) {
            // Chiamato via API → invia file
            if (!fs.existsSync(pdfFile)) {
                console.error("❌ File non trovato dopo generazione:", pdfFile);
                return res.status(500).json({ success: false, error: "File non generato" });
            }
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename="${path.basename(pdfFile)}"`);
            const stream = fs.createReadStream(pdfFile);
            console.log("📤 Invio file report:", pdfFile);
            stream.pipe(res);
            return;
        }

        return pdfFile;
    } catch (err) {
        console.error("Errore in getLastTest:", err);
        return null;
    }
}



async function gettime(iduser, idcourse, nome, cognome, db, savefile, res) {


    if (!iduser || !idcourse || !db) {
        return res.status(400).json({ success: false, error: "Parametri mancanti" });
    }

    const nomeutente = `${nome} ${cognome}`.replace(/\s+/g, " ").trim();
    const safeNome = nomeutente.replace(/[^\w\s-]/g, "");

    // 🔹 Footer/Header HTML (DB impostazioni)
    const header = await getMailFormat("header");
    const footer = await getMailFormat("footer");


    try {
        const conn = await getConnection(db);

        // 🔄 correzione idcourse come nel VB
        let courseId = Number(idcourse);
        if (courseId === 415) courseId = 414;
        if (courseId === 74) courseId = 73;
        if (courseId === 86) courseId = 85;

        // 🔹 Info corso
        const [rows] = await conn.query(
            `SELECT b.code,b.name,a.date_inscr,a.date_complete,a.status,a.pay,a.idcourse,a.iduser
     FROM learning_courseuser a
     JOIN learning_course b ON a.idcourse=b.idcourse
     WHERE a.idcourse=? AND a.iduser=? LIMIT 1`,
            [courseId, iduser]
        );

        const [currentDb] = await conn.query("SELECT DATABASE() AS db");
        console.log("🧠 Params:", { iduser, courseId });
        console.log("🔍 DB attivo:", currentDb[0].db);
        const courseRow = rows?.[0];

        if (!courseRow) throw new Error("Corso non trovato", courseId, iduser);


        // 🔹 Tempo totale piattaforma
        const [timeRow] = (
            await conn.query(
                `SELECT SUM(TIME_TO_SEC(TIMEDIFF(lasttime, entertime))) AS totaltime 
                 FROM learning_tracksession WHERE idCourse=? AND idUser=?`,
                [courseId, iduser]
            )
        )[0];
        const totTime = timeRow?.totaltime || 0;

        // 🔹 Determina dominio Docebo remoto per gettime.php
        let addressDocebo = "";
        switch (db) {
            case process.env.MYSQL_FORMA4:
                addressDocebo = "https://ifad.formazioneintermediari.com";
                break;
            case "efadnovastudia":
                addressDocebo = "https://efad.novastudia.academy";
                break;
            case "fadassiac":
                addressDocebo = "http://fad.assiac.it";
                break;
            case "newformazionein":
                addressDocebo = "https://efad.formazioneintermediari.com";
                break;
            case "formazionein":
                addressDocebo = "http://fad.formazioneintermediari.com";
                break;
            case "simplybiz":
                addressDocebo = "http://simplybiz.formazioneintermediari.com";
                break;
            case "formazionecondorb":
                addressDocebo = "http://efad.rb-academy.it";
                break;
        }

        let tempivideocorso = "N/D";
        try {
            const url = `${addressDocebo}/gettime.php?database=${db}&idCourse=${courseId}&iduser=${iduser}`;
            console.log("🌐 Richiesta ore_video:", url);
            const r = await axios.get(url);

            if (r && r.data) {
                tempivideocorso = r.data;
            } else {
                console.warn("⚠️ Nessun dato ricevuto da gettime.php", r);
                logwrite("Nessun dato ricevuto da gettime.php");
                tempivideocorso = "N/D";
            }
        } catch (err) {
            logwrite("Errore chiamata gettime.php: " + err.message);
            console.error("❌ Errore chiamata gettime.php:", err.message);
            tempivideocorso = "N/D";
        }

        // 🔹 Dettaglio SCORM
        const [scormRows] = await conn.query(
            `SELECT a.title, b.total_time, d.duration, 
                    (SELECT title FROM learning_organization WHERE idorg=a.idparent) AS modulo
             FROM ((learning_organization a 
             LEFT JOIN learning_scorm_tracking b ON a.idorg=b.idreference)
             JOIN learning_scorm_organizations c ON a.idresource=c.idscorm_organization)
             JOIN learning_scorm_package d ON d.idscorm_package=c.idscorm_package
             WHERE a.objecttype='scormorg' AND a.idCourse=? AND b.idUser=?
             ORDER BY a.path ASC`,
            [courseId, iduser]
        );
        console.log("Scorm rows:", scormRows.length);
        // 🔹 Costruzione HTML
        let html = `
        <html>
        <head>
            <style>
                body { font-family: 'Times New Roman', serif; font-size: 14px; color: #00314C; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                td, th { border: 1px solid #ccc; padding: 2px; text-align: left; }
                h1, h2 { color: #00314C; text-align: center; }
            </style>
        </head>
        <body>${header}
            <h1>REPORT CORSO</h1>
            <p><b>Utente:</b> ${nomeutente}<br/>
               <b>Corso:</b> ${courseRow.code} | ${courseRow.name}<br/>
               <b>Data Iscrizione:</b> ${dayjs(courseRow.date_inscr).format("DD/MM/YYYY HH:mm") || "N/D"}<br/>
               <b>Data Completamento:</b> ${dayjs(courseRow.date_complete).format("DD/MM/YYYY HH:mm") || "N/D"}<br/>
               <b>Ore VideoCorsi:</b> ${tempivideocorso}<br/>
               <b>Ore permanenza in piattaforma:</b> ${Math.floor(totTime / 3600)}h ${Math.floor(
            (totTime % 3600) / 60
        )}m<br/></p>

            <h2>Tempi Videocorsi</h2>
            <table>
                <tr><th>Titolo Videocorso</th><th>Durata complessiva</th><th>Durata visione utente</th></tr>
        `;

        let durataTot = 0;
        scormRows.forEach((r) => {
            durataTot += Number(r.duration) || 0;
            html += `<tr><td>${r.modulo || ""} - ${r.title}</td>
                        <td>${Math.floor(r.duration / 60)} min</td>
                        <td>${decodeTime(r.total_time) || "0:00"}</td></tr>`;
        });
        html += `<tr><td><b>Totali</b></td><td><b>${Math.floor(durataTot / 60)} min</b></td><td><b>${decodeTime(tempivideocorso)}</b></td></tr>`;
        html += `</table>`;
        console.log("Videocorsi trovati:", scormRows.length);


        // 🔍 Query base identica al VB
        let oggettididaMYSQL_FORMA4ttici;
        if (db === "forma4") {
            [oggettididattici] = await conn.query(`
                SELECT DISTINCT a.title, '' AS modulo, a.title, b.dateAttempt, b.first_complete, b.last_complete,
                       b.status, b.idreference,a.idResource, b.objecttype, b.firstattempt
                FROM learning_organization a
                JOIN learning_commontrack b ON a.idorg = b.idreference
                WHERE a.idcourse = ? AND b.idUser = ?
                ORDER BY a.path ASC
            ` , [courseId, iduser]);
        } else {
            [oggettididattici] = await conn.query(`
                SELECT 
                    (SELECT title FROM learning_organization WHERE idorg = a.idparent) AS modulo,
                    a.title, b.dateAttempt, b.first_complete, b.last_complete,
                    b.status, b.idreference, a.idResource,b.objecttype, b.firstattempt
                FROM learning_organization a
                JOIN learning_commontrack b ON a.idorg = b.idreference
                WHERE a.idcourse = ? AND b.idUser = ?
                ORDER BY a.path ASC
            `, [courseId, iduser]);
        }


        if (!oggettididattici.length) throw new Error("Nessun oggetto didattico trovato");


        html += `
           
             
              <h2>Dettaglio Oggetti Didattici</h2>
              <table>
                <tr>
                  <th>Oggetto Didattico</th>
                  <th>Data Accesso</th>
                  <th>Data Completamento</th>
                  <th>Stato</th>
                  <th>Voto</th>
                </tr>
        `;

        for (const row of oggettididattici) {
            let dataAccesso = dayjs(row.firstattempt).format("DD/MM/YYYY HH:mm") || "";
            // let dataCompleto = dayjs(row.first_complete).format("DD/MM/YYYY HH:mm") || dayjs(row.dateAttempt).format("DD/MM/YYYY HH:mm") || "";
            const dataCompleto =
                (row.first_complete && dayjs(row.first_complete).isValid() && dayjs(row.first_complete).format("DD/MM/YYYY HH:mm")) ||
                (row.last_complete && dayjs(row.last_complete).isValid() && dayjs(row.last_complete).format("DD/MM/YYYY HH:mm")) ||
                "";
            let stato = "completato";
            let voto = "";

            if (row.objecttype === "test") {
                // TODO: implementa getvototest (query a learning_testtrack)
                const [testRows] = await conn.query(
                    "SELECT score,score_max FROM learning_testtrack a join learning_test b on a.idtest=b.idtest WHERE iduser=? AND a.idtest=? LIMIT 1",
                    [iduser, row.idResource]
                );
                voto = testRows?.[0]
                    ? `${testRows[0].score}/${testRows[0].score_max}`
                    : "";
            }

            html += `
                <tr>
                    <td>${row.modulo || ""} - ${row.title}</td>
                    <td>${dataAccesso}</td>
                    <td>${dataCompleto}</td>
                    <td>${stato}</td>
                    <td>${voto}</td>
                </tr>
            `;
        }

        html += `</table>`;


        // 🔹 Connessioni
        const [connRows] = await conn.query(
            `SELECT entertime,lasttime,numop,
                    TIME_TO_SEC(TIMEDIFF(lasttime, entertime)) AS duration
             FROM learning_tracksession
             WHERE entertime != lasttime AND idCourse=? AND idUser=?
             ORDER BY entertime ASC`,
            [courseId, iduser]
        );

        html += `<h2>Numero Connessioni</h2>
        <table><tr><th>#</th><th>Inizio</th><th>Fine</th><th>Durata</th><th>Operazioni</th></tr>`;
        connRows.forEach((r, i) => {
            const dur = `${Math.floor(r.duration / 60)} min`;
            html += `<tr><td>${i + 1}</td><td>${dayjs(r.entertime).format("DD/MM/YYYY HH:mm")}</td>
                     <td>${dayjs(r.lasttime).format("DD/MM/YYYY HH:mm")}</td><td>${dur}</td><td>${r.numop}</td></tr>`;
        });
        html += `</table>${footer}`;



        console.log("🧾 Generazione report per:", nomeutente);
        // 🔹 Generazione file PDF
        // Percorso assoluto corretto, indipendente da come viene avviato Node
        const reportsDir = path.resolve(__dirname, "../public/reports");
        if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

        const filename = `Report - ${courseRow.code} - ${nome} ${cognome} - ${iduser}.pdf`;
        const pdfFile = path.join(reportsDir, filename);

        console.log("📁 Report path (reale):", pdfFile);

        // 🔹 Generazione PDF
        const browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle0" });

        // 🔸 Salva direttamente su file (non solo buffer)
        await page.pdf({
            path: pdfFile, // <-- SCRIVE SU DISCO
            format: "A4",
            landscape: true,
            printBackground: true,
            displayHeaderFooter: true,
            margin: { top: "40px", bottom: "60px", left: "20px", right: "20px" },
            headerTemplate: "<div></div>",
            footerTemplate: ` `,
        });

        await browser.close();
        console.log("✅ Report generato:", pdfFile);
        console.log("📂 File exists after write?", fs.existsSync(pdfFile));

        // 🔹 Comportamento diverso in base al contesto
        if (savefile) {
            // Chiamato da sendcertificate → ritorna percorso assoluto
            return pdfFile;
        } else if (res) {
            // Chiamato via API → invia file
            if (!fs.existsSync(pdfFile)) {
                console.error("❌ File non trovato dopo generazione:", pdfFile);
                return res.status(500).json({ success: false, error: "File non generato" });
            }
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename = "${path.basename(pdfFile)}"`);
            const stream = fs.createReadStream(pdfFile);
            console.log("📤 Invio file report:", pdfFile);
            stream.pipe(res);
            return;
        }

        return pdfFile;
    } catch (err) {
        console.error("❌ getTime error:", err);
        if (res && !res.headersSent) {
            res.status(500).json({ success: false, error: err.message });
        }
        return null;
    }


}



// 🔹 Restituisce la data dell'ultimo accesso alla piattaforma
async function getLastAccess(iduser) {
    try {
        const conn = await getConnection(process.env.MYSQL_FORMA4);
        const [rows] = await conn.query(
            "SELECT lastenter FROM core_user WHERE idst = ? LIMIT 1",
            [iduser]
        );
        return rows?.[0]?.lastenter || "";
    } catch (err) {
        console.error("Errore in getLastAccess:", err);
        return "";
    }
}

// 🔹 Restituisce l'ultimo accesso al corso specifico
async function getLastCourseAccess(idcourse, iduser) {
    try {
        const conn = await getConnection(process.env.MYSQL_FORMA4);
        const [rows] = await conn.query(
            `SELECT lasttime
       FROM learning_tracksession
       WHERE lasttime != '' AND idCourse = ? AND iduser = ?
            ORDER BY lasttime DESC
       LIMIT 1`,
            [idcourse, iduser]
        );
        return rows?.[0]?.lasttime || "";
    } catch (err) {
        console.error("Errore in getLastCourseAccess:", err);
        return "";
    }
}
async function getNomeCorsoById(idcourse, db = process.env.MYSQL_FORMA4) {
    // se db è un oggetto, prendi la chiave o il nome
    const dbName = typeof db === "object" ? db?.database || db?.name || process.env.MYSQL_FORMA4 : String(db);
    const conn = await getConnection(dbName);

    try {
        const [rows] = await conn.query(`
            SELECT code, name
            FROM learning_course
            WHERE idcourse = ?
            LIMIT 1
        `, [idcourse]);

        if (!rows.length) {
            console.warn(`⚠️ Nessun corso trovato con idcourse = ${idcourse} nel DB ${db} `);
            return null;
        }

        const { code, name } = rows[0];
        return `${code} | ${name} `;
    } catch (err) {
        console.error("❌ Errore in getNomeCorsoById:", err);
        return null;
    } finally {
        conn.release?.();
    }
}
// 🔹 Calcola la percentuale di completamento corso
async function getPercentuale(iduser, idcorso, status) {
    try {
        const conn = await getConnection(process.env.MYSQL_FORMA4);
        let evaso = "";

        // Conteggio totale oggetti del corso
        const [rowsTotal] = await conn.query(
            `SELECT COUNT(*) AS cntotal
       FROM learning_organization
       WHERE idCourse = ? AND objectType <> ''`,
            [idcorso]
        );
        const total = rowsTotal?.[0]?.cntotal || 0;

        // Conteggio oggetti completati
        const [rowsCompleted] = await conn.query(
            `SELECT COUNT(*) AS cn
       FROM learning_commontrack
       JOIN learning_organization ON learning_organization.idorg = learning_commontrack.idReference
       WHERE idcourse = ?
            AND status NOT IN('ab-initio', 'attempted')
         AND learning_commontrack.idUser = ? `,
            [idcorso, iduser]
        );
        const completed = rowsCompleted?.[0]?.cn || 0;

        // Controllo se evaso
        try {
            const [rowsEvaso] = await conn.query(
                `SELECT evaso FROM learning_certificate_assign
         WHERE id_course = ? AND id_user = ? `,
                [idcorso, iduser]
            );
            if (rowsEvaso?.[0]?.evaso) {
                evaso = "/Evaso";
            }
        } catch { }

        // Interpretazione dello stato
        switch (parseInt(status)) {
            case 0:
                return "Iscritto" + evaso;
            case 2:
                return "Completato" + evaso;
            case 1:
                if (completed > 0 && total > 0) {
                    return Math.round((completed / total) * 100) + " %" + evaso;
                } else {
                    return "0%" + evaso;
                }
            case 3:
                return "Sospeso" + evaso;
            default:
                return "N/D";
        }
    } catch (err) {
        console.error("Errore in getPercentuale:", err);
        return "Errore calcolo";
    }
}
// --- FUNZIONI DI SUPPORTO ---

function formattaNominativo(nome) {
    return nome
        .toLowerCase()
        .replace(/\b\w/g, (l) => l.toUpperCase())
        .trim();
}

function convertSecToDate(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s} s`;
}

function decodeTime(v) {
    try {
        if (!v || v === "PT0H0M0S") {
            return "non tracciato";
        }

        // Normalizza stringa (es. PT0001H30M41S -> PT1H30M41S)
        v = v.replace(/^PT0+/, "PT");

        // Estrai ore, minuti, secondi con regex
        const match = v.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (!match) return v;

        const hours = parseInt(match[1] || "0");
        const minutes = parseInt(match[2] || "0");
        const seconds = parseInt(match[3] || "0");

        // Restituisce in formato “xh ym zs”
        return `${hours}h ${minutes}m ${seconds} s`;
    } catch (err) {
        console.error("decodeTime error:", err);
        return v;
    }
}

function getCorrect(idanswer, stranswer, dtresult = []) {
    try {
        const dr = dtresult.find(row => row.idanswer == idanswer);

        if (!dr) return { html: stranswer, correct: false };

        // ✅ risposta corretta
        if (dr.score_correct == 10 && dr.score_assigned == 10) {
            return {
                html: `<span style="color:green" > ${stranswer}</span > `,
                correct: true
            };
        }

        // ❌ risposta errata
        if (dr.score_assigned == 0 && dr.score_correct == 0) {
            return {
                html: `<span style="color:red" > ${stranswer}</span > <br>`,
                correct: false
            };
        }

        // caso neutro (es. non valutata)
        return {
            html: stranswer,
            correct: false
        };
    } catch (err) {
        console.error("Errore in getCorrect:", err);
        return { html: stranswer, correct: false };
    }
}

async function retryQuery(pool, sql, params = [], retries = 3, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            const [rows] = await pool.query(sql, params);
            return rows;
        } catch (err) {
            const transient = ["ETIMEDOUT", "ECONNRESET", "PROTOCOL_CONNECTION_LOST"];
            if (transient.includes(err.code) && i < retries - 1) {
                console.warn(
                    `⚠️ Tentativo ${i + 1} fallito (${err.code}) → ritento in ${delay}ms`
                );
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            throw err;
        }
    }
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

// --- helper date locali (aggiungere in cima al file utils/attestati.js) ---
function pad2(n) {
    return String(n).padStart(2, "0");
}





module.exports = {

    pad2,
    formatDate,
    formatTime,
    retryQuery,
    getConnection,

    // Format & Utility
    EscapeStr,
    getCorrect,
    convertSecToDate,
    Normalizza,
    FormattaNominativo,
    GetPedino,
    ConvertToMysqlDateTime,
    CreateRandomPassword,
    getMd5Hash,
    getMailFormat,

    IscriviCorsi,
    IscriviaSimulazione,
    getVoto,
    getLastTest,
    gettime,
    getLastAccess,
    getLastCourseAccess,
    getPercentuale,
    decodeTime,
    getNomeCorsoById,
    // Piedini
    piedino,
    piedinorbacademy,
    piedinonovastudia,
    piedinodidattica,
    // File / Log
    logwrite,
    downloadRemoteFile,
    BASE_DIR,
    PATHS,
    // Database helpers
    adddetails,
    findusername,
    GetIfUserExist,
    toMySQLDateTime,
    setTemplateMode,
    SaveAndSend,
    SendBenvenuto,
    SendExtra,
    SendAttestato,
    // Email
    reinviamail,
    checkEmail,
    getBCC,
    SaveAndSend,
    invioMail,
    invioMailPEC,
};
