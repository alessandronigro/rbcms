// routes/iscrizioni.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const XLSX = require("xlsx");
const { parse } = require("csv-parse/sync");

const router = express.Router();

const { getConnection } = require("../dbManager");
const {
    // helper già nel tuo helper.js
    resolvePlatformFromHost,
    logwrite,
    Normalizza,
    FormattaNominativo,
    GetIfUserExist,
    findusername,
    CreateRandomPassword,
    getMd5Hash,
    ConvertToMysqlDateTime,
    adddetails,
    SaveAndSend,
    // pipeline
    IscriviaSimulazione,
} = require("../utils/helper");


// ========================= Support: get convenzione (newconvenzioni) =========================
async function loadConvenzioneByCodeOrName(convenzione) {
    const DEFAULT = {
        name: "Formazione Intermediari",
        codice: "RB",
        host: "4.232.138.184",
        piattaforma: "forma4",
        newindirizzoweb: "https://ifad.formazioneintermediari.com",
        mailbcc: "",
        fattura: false
    };

    if (!convenzione) return DEFAULT;

    const connWP = await getConnection("EFAD", "wpacquisti");

    // Se arriva oggetto
    if (typeof convenzione === "object") {
        if (convenzione.host && convenzione.piattaforma) return convenzione;

        if (convenzione.codice) {
            const [rows] = await connWP.query(
                "SELECT * FROM newconvenzioni WHERE codice=? LIMIT 1",
                [convenzione.codice]
            );
            return rows.length ? rows[0] : DEFAULT;
        }

        if (convenzione.name) {
            const [rows] = await connWP.query(
                "SELECT * FROM newconvenzioni WHERE name=? LIMIT 1",
                [convenzione.name]
            );
            return rows.length ? rows[0] : DEFAULT;
        }

        return DEFAULT;
    }

    // Se è string → prova prima codice, poi nome
    let [rows] = await connWP.query(
        "SELECT * FROM newconvenzioni WHERE codice=? LIMIT 1",
        [convenzione]
    );

    if (!rows.length) {
        [rows] = await connWP.query(
            "SELECT * FROM newconvenzioni WHERE name=? LIMIT 1",
            [convenzione]
        );
    }

    return rows.length ? rows[0] : DEFAULT;
}
// ========================= Support: getCourseByCode =========================
async function getCourseByCode(cn, codecorso, fallbackTitle = "") {
    let code = (codecorso || "").trim();
    if (/-/.test(code)) code = code.split("-")[0].trim(); // "cod3035 - titolo"
    if (code.toLowerCase() === "codivass30oam15") {
        const [rows] = await cn.query("SELECT code,idCourse,name FROM learning_course WHERE code='cod3035' LIMIT 1");
        if (!rows.length) throw new Error("Corso 'cod3035' non trovato per pacchetto codIVASS30OAM15");
        return { idcourse: rows[0].idCourse, codeFinal: "codIVASS30OAM15", title: rows[0].name };
    }
    const [rows] = await cn.query("SELECT code,idCourse,name FROM learning_course WHERE code=? LIMIT 1", [code]);
    if (!rows.length) throw new Error(`Corso '${code}' non trovato`);
    return { idcourse: rows[0].idCourse, codeFinal: rows[0].code, title: rows[0].name || fallbackTitle };
}

// ========================= Mini-pipeline locale (usa i tuoi helper) =========================
const SIM_MAP = { 4: 72, 8: 12, 15: 24, 16: 25, 71: 24, 73: 72, 79: 83, 85: 83 };

async function processEnrollRows({
    rows,                   // array utenti normalizzati
    piattaforma, host,      // destinazione piattaforma (IFAD/SITE/NOVA...) + host/ip
    convenzioneName,        // solo testo
    nomesito,               // per email             // es. "cod3035"
    ifSendMail = true,      // invio email
    webOrderUpdate = null,  // fn opzionale per aggiornare ordine web
}) {
    const results = [];
    const { connKey, db } = resolvePlatformFromHost(host || "", piattaforma || "");
    const cn = await getConnection(connKey, db);

    // ricava id corso

    for (const src of rows) {
        const res = { email: src.email, stato: "OK", emailOk: false, pecOk: false, bccOk: false };
        try {

            const { idcourse, codeFinal, title } = await getCourseByCode(cn, src.codecorso, src.corso);

            // normalizza
            let nome = FormattaNominativo(Normalizza(src.nome || ""));
            let cognome = FormattaNominativo(Normalizza(src.cognome || ""));
            let email = String(src.email || "").toLowerCase().trim();
            let pec = String(src.pec || "").toLowerCase().trim();
            let cf = String(src.cf || "").toUpperCase().trim();
            let tel = String(src.telefono || "").trim();

            // esistenza
            let ifexist = false;
            let idst = 0;
            let username = ((cognome.replace(/[’' ]/g, "").slice(0, 3) + (nome || "").replace(/[’' ]/g, "").slice(0, 3)) || (cognome + nome)).toLowerCase();
            const dtExist = await GetIfUserExist(nome, cognome, cf, email, cn, convenzioneName);
            if (dtExist && dtExist.length) {
                ifexist = true;
                idst = dtExist[0].idst;
                username = dtExist[0].userid.replace("/", "");
            }

            // new user
            let passwordReal = "";
            if (!ifexist) {
                passwordReal = (await CreateRandomPassword(6)).toLowerCase();
                const passHash = await getMd5Hash(passwordReal);
                username = await findusername(username, nome, cognome, cn);

                await cn.query(`INSERT INTO core_st (idst) VALUES (NULL)`);
                await cn.query(
                    `INSERT INTO core_user (idst, userid, firstname, lastname, pass, email, valid, register_date)
           VALUES (LAST_INSERT_ID(), ?, ?, ?, ?, ?, 1, NOW())`,
                    [`/${username}`, nome, cognome, passHash, email]
                );
                const [last] = await cn.query(`SELECT idst FROM core_user ORDER BY idst DESC LIMIT 1`);
                idst = last[0].idst;
                // salva password in chiaro (id_common=26 secondo tua convenzione)
                await adddetails(26, idst, passwordReal, cn);
            }

            // details
            await adddetails(23, idst, cf, cn);         // cf
            await adddetails(24, idst, email, cn);      // email
            await adddetails(31, idst, pec, cn);        // pec
            await adddetails(20, idst, tel, cn);        // telefono
            await adddetails(25, idst, convenzioneName, cn); // convenzione

            // iscrizione corso + validità
            const now = new Date();
            const expire = new Date(now.getTime() + 365 * 24 * 3600 * 1000);
            const begin = ConvertToMysqlDateTime(now);
            const end = ConvertToMysqlDateTime(expire);
            await cn.query(
                `INSERT INTO learning_courseuser
         (idUser, idCourse, level, date_inscr, waiting, imported_from_connection, absent, cancelled_by, new_forum_post, date_begin_validity, date_expire_validity, codsblocco)
         VALUES (?, ?, 3, NOW(), 0, 1039, 0, 0, 0, ?, ?, ?)`,
                [idst, idcourse, begin, end, passwordReal]
            );

            // group
            const [gCourse] = await cn.query(
                `SELECT idst FROM core_group WHERE groupid LIKE ? LIMIT 1`,
                [`%/lms/course/${idcourse}/subscribed/3%`]
            );
            const idstgroup = gCourse?.[0]?.idst;
            const gruppi = [idstgroup].filter(Boolean);
            for (const g of gruppi) {
                try { await cn.query(`INSERT INTO core_group_members (idst, idstMember) VALUES (?, ?)`, [g, idst]); } catch { }
            }

            // simulazioni
            if (SIM_MAP[idcourse]) await IscriviaSimulazione(idst, SIM_MAP[idcourse], now);
            if (/^codIVASS30OAM15$/i.test(codeFinal)) await IscriviaSimulazione(idst, 23, now);

            // email
            if (ifSendMail) {
                const esito = await SaveAndSend({
                    idcourse: idcourse,
                    file: "",
                    nominativo: `${nome} ${cognome}`,
                    email,
                    pec,
                    societa: "",
                    code: codeFinal,
                    nomesito,
                    _username: username,
                    _password: passwordReal,
                    convenzione: convenzioneName,
                    nomecorso: title || codeFinal,
                    sede: "",
                    format: "benvenuto",
                    bcc: "",
                    ifsend: true,
                    datattivazione: now.toLocaleDateString("it-IT"),
                    codfis: cf,
                });
                res.emailOk = esito?.emailOk || false;
                res.pecOk = esito?.pecOk || false;
                res.bccOk = esito?.bccOk || false;
            }

            // web update opzionale
            if (typeof webOrderUpdate === "function") {
                try { await webOrderUpdate(src.order_id); } catch (e) { await logwrite("webOrderUpdate: " + e.message); }
            }

            results.push(res);
        } catch (err) {
            await logwrite("Enroll ERR: " + err);
            res.stato = "ERRORE";
            res.error = err.message;
            results.push(res);
            continue;
        }
    }


    return results;
}

// ========================= POST /api/iscrizioni/excel =========================
// ✅ NUOVA ROUTE - Import da Excel JSON (frontend manda già parsed)
router.post("/excel", async (req, res) => {
    try {
        const { convenzione, corso, utenti } = req.body;

        if (!Array.isArray(utenti) || utenti.length === 0) {
            return res.status(400).json({ error: "Lista utenti mancante o vuota" });
        }

        if (!convenzione) {
            return res.status(400).json({ error: "Convenzione mancante" });
        }

        if (!corso) {
            return res.status(400).json({ error: "Corso mancante" });
        }

        // 🧠 Estraggo info da convenzione selezionata
        const [convName, host, db] = convenzione.split("|");
        const [courseCode, courseName] = String(corso).split("|");

        // normalizza ogni utente
        const utentiNormalized = utenti.map((u) => {
            const [cognome, nome, email, cf, telefono = ""] = u;
            return {
                nome: (nome || "").trim(),
                cognome: (cognome || "").trim(),
                email: (email || "").toLowerCase().trim(),
                cf: (cf || "").toUpperCase().trim(),
                telefono: (telefono || "").trim(),
                codecorso: courseCode,
                nomecorso: courseName,
                convenzione: convenzione
            };
        });
        if (!host || !db) {
            return res.status(400).json({ error: "Convenzione non valida: manca host/db" });
        }

        console.log("📌 Excel →", convName, host, db, utenti.length);

        // ✅ Connessione piattaforma target
        const cn = await getConnection(host, db);

        // ✅ Wrapper per update stato ordine web (solo se order_id esiste)
        const webOrderUpdate = async (order_id) => {
            try {
                if (!order_id) return;
                await cn.query(`
                    UPDATE wp_woocommerce_rb_ordini
                    SET order_status = 'completed'
                    WHERE order_id = ?`,
                    [order_id]
                );
            } catch (err) {
                console.warn("⚠️ Update stato ordine fallito:", err.message);
            }
        };


        // ✅ Uso la mega-funzione esistente 💪
        const results = await processEnrollRows({
            rows: utentiNormalized,
            piattaforma: db,
            host,
            convenzioneFallback: convName,
            ifSendMail: true,
            checkExist: true,
            webOrderUpdate,
            getCourseByCode,
            cn,
        });

        if (cn?.release) cn.release();

        const ok = results.filter(r => !r.error).length;
        const fail = results.filter(r => r.error).length;

        return res.json({
            success: true,
            ok,
            fail,
            errorDetails: results.filter(r => r.error)
        });

    } catch (err) {
        console.error("❌ Errore /api/iscrizioni/excel:", err);
        return res.status(500).json({ error: err.message });
    }
});

// ========================= POST /api/iscrizioni/weborders =========================
// Body atteso:
// {
//   order_ids: [123, 456],       // oppure single: 123
//   convenzione: "...",          // nome o codice (per ricavare host/piattaforma)
//   host: "4.232.138.184",       // se vuoi bypassare lookup convenzione
//   corsoPerUtente: false        // se true: n utenti, n corsi (leggiamo da DB), se false: singolo corso uniformato dal frontend
// }
router.post("/weborders", async (req, res) => {
    try {
        const { idordine, chkexist = true, sendmail = true } = req.body;

        if (!idordine)
            return res.status(400).json({ error: "idordine richiesto" });

        const dbWeb = await getConnection("SITE", "newformazione");

        // Ordine
        const [[ordine]] = await dbWeb.query(
            "SELECT * FROM wp_woocommerce_rb_ordini WHERE order_id=?",
            [idordine]
        );
        if (!ordine)
            return res.status(404).json({ error: "Ordine non trovato" });

        const codiceConv = ordine.codice_convenzione || "";
        const conv = await loadConvenzioneByCodeOrName(codiceConv);

        if (!conv)
            return res.status(400).json({ error: "Convenzione non valida o non trovata" });

        const host = conv.host;
        const piattaforma = conv.piattaforma;
        const nomesito = conv.newindirizzoweb || conv.indirizzoweb || "";

        // ✅ Ricava utenti/corsi collegati
        const [rows] = await dbWeb.query(
            `SELECT 
                corsista_first_name AS nome,
                corsista_last_name AS cognome,
                corsista_email AS email,
                corsista_pec AS pec,
                corsista_cf AS cf,
                corsista_tel AS telefono,
                codice_corso AS codecorso,
                corso_title AS corso,
                order_id,
                sede_esame,
                wdm_user_custom_data
             FROM wp_woocommerce_rb_corsisti
             WHERE order_id=?
             ORDER BY corsista_last_name ASC`,
            [idordine]
        );

        if (!rows.length)
            return res.json({
                success: true,
                result: [],
                warning: "Nessun corsista associato"
            });

        // ✅ struttura riga compatibile EXCEL
        const utenti = rows.map(r => ({
            nome: r.nome,
            cognome: r.cognome,
            email: r.email?.toLowerCase(),
            pec: r.pec?.toLowerCase(),
            cf: r.cf?.toUpperCase(),
            telefono: r.telefono || "",
            codecorso: r.codecorso?.trim() || "",
            convenzione: conv.name,
            sede: `${r.sede_esame || ""}${r.wdm_user_custom_data || ""}`,
            order_id: idordine,
            corso: r.corso
        }));

        // ✅ PROCESSA ISCRIZIONI
        const results = await processEnrollRows({
            rows: utenti,
            piattaforma,
            host,
            convenzioneName: conv.name,
            nomesito,
            ifSendMail: sendmail,
            checkExist: chkexist,
            webOrderUpdate: async () => {
                await dbWeb.query(
                    `UPDATE wp_woocommerce_rb_ordini
                     SET order_status='completed'
                     WHERE order_id=?`,
                    [idordine]
                );
            }
        });

        const fail = results.filter(r => r.error);
        const success = results.filter(r => r.stato === "OK");

        return res.json({
            success: fail.length === 0,
            summary: {
                order_id: idordine,
                convenzione: conv.name,
                ok: success.length,
                ko: fail.length
            },
            results
        });

    } catch (err) {
        await logwrite("weborders ERR: " + err.message);
        return res.status(500).json({ error: err.message });
    }
});



router.get("/sito", async (req, res) => {
    try {
        const page = parseInt(req.query.page || "1", 10);
        const limit = parseInt(req.query.limit || "50", 10);
        const offset = (page - 1) * limit;

        const db = await getConnection("SITE", "newformazione");

        const [rows] = await db.query(
            `SELECT 
      *
       FROM wp_woocommerce_rb_ordini
       ORDER BY date_ins DESC
       LIMIT ? OFFSET ?`,
            [limit, offset]
        );

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) as total FROM wp_woocommerce_rb_ordini`
        );

        res.json({ rows, total });
    } catch (err) {
        console.error("Errore /iscrizioni/sito:", err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 📦 Ottiene iscrizioni ACADEMY (EFAD)
 * GET /api/iscrizioni/aca?db=newformazionein
 */
router.get("/aca", async (req, res) => {
    try {
        const db = await getConnection("SITE", req.query.db || "rbacademy");
        const [rows] = await db.query(`
      SELECT *
      FROM wp_woocommerce_rb_ordini
      ORDER BY order_id DESC
    `);
        res.json(rows);
    } catch (err) {
        console.error("❌ Errore /iscrizioni/aca:", err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 📦 Ottiene iscrizioni N.O.V.A. (SITE)
 * GET /api/iscrizioni/nova?db=newformazione
 */
router.get("/nova", async (req, res) => {
    try {
        const db = await getConnection("NOVA", req.query.db || "novastudia");
        const [rows] = await db.query(`
      SELECT *
      FROM wp_woocommerce_rb_ordini
      ORDER BY order_id DESC
    `);
        res.json(rows);
    } catch (err) {
        console.error("❌ Errore /iscrizioni/nova:", err);
        res.status(500).json({ error: err.message });
    }
});



// 📦 Ottiene corsisti legati a un ordine specifico
// GET /api/iscrizioni/ordini/:order_id/corsisti?db=wpacquisti&host=IFAD
router.get("/ordini/:order_id/corsisti", async (req, res) => {
    try {
        const { order_id } = req.params;
        const dbName = req.query.db || "newformazione";
        const hostKey = req.query.host || "SITE";

        const db = await getConnection(hostKey, dbName);

        const [rows] = await db.query(`
      SELECT 
       *
      FROM wp_woocommerce_rb_corsisti
      WHERE order_id = ?
      ORDER BY corsista_last_name ASC
    `, [order_id]);

        res.json(rows);
    } catch (err) {
        console.error("❌ Errore /ordini/:order_id/corsisti:", err);
        res.status(500).json({ error: err.message });
    }
});





// Util: formattazioni in stile PHP
const formatEuro = (n) =>
    typeof n === "number"
        ? n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : Number(n || 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const htmlEscape = (s = "") =>
    String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

// Costanti invariate come in PHP
const EMAIL_FROM = "info@formazioneintermediari.com";

// Build HTML riepilogo (logica portata dal PHP)
async function buildOrderEmailHTML(db, order_id) {
    // 1) Count corsi by codice_corso
    const [countRows] = await db.query(
        `SELECT COUNT(*) AS numcount, codice_corso, corso_title
     FROM newformazione.wp_woocommerce_rb_corsisti
     WHERE order_id = ?
     GROUP BY codice_corso, corso_title`,
        [order_id]
    );

    // 2) Riga ordine con comuni/province risolti + data in dd/mm/yyyy (replica PHP)
    const [ordRows] = await db.query(
        `SELECT a.*,
            DATE_FORMAT(a.date_ins, '%d/%m/%Y') AS formatted_date,
            (SELECT comune   FROM newformazione.rb_comuni_2016   WHERE id_comune   = a.billing_comune)   AS comune,
            (SELECT provincia FROM newformazione.rb_province_2016 WHERE id_provincia = a.billing_provincia) AS provincia
     FROM newformazione.wp_woocommerce_rb_ordini a
     WHERE a.order_id = ?`,
        [order_id]
    );

    if (!ordRows.length) throw new Error("Ordine non trovato");

    const o = ordRows[0];

    let mailbody = "";
    let mailbodybon = "";

    mailbody += `<h1 style="mso-fareast-font-family:Times New Roman;color:#557DA1;font-weight:normal">Ordine n. ${htmlEscape(
        order_id
    )} (${htmlEscape(o.formatted_date || "")})</h1><br>`;
    mailbody += `<h2 style="color:#557DA1">Riepilogo ordine di acquisto</h2><br>`;

    // Se BONIFICO → intro pagamento
    if ((o.metodo_di_pagamento || "").toLowerCase() === "bacs") {
        mailbodybon += `Gentile Cliente,<br>`;
        mailbodybon += `abbiamo ricevuto l'ordine d'acquisto effettuato dal nostro sito.<br><br>`;
        mailbodybon += `Per completare l'acquisto, utilizzi le seguenti indicazioni:<br><br>`;
        mailbodybon += ` - Intestazione: RB CONSULTING S.R.L.<br>`;
        mailbodybon += ` - Istituto bancario: Credem<br>`;
        mailbodybon += ` - IBAN: IT33S0303203200010000908197<br>`;
        mailbodybon += ` - Causale n.: ${htmlEscape(order_id)}<br>`;
        mailbodybon += ` - IMPORTO: &euro; ${formatEuro(o.fatturato)}<br>`;
    }
    mailbody += mailbodybon;

    mailbody += `<table width="100%" cellspacing="3" cellpadding="3">`;

    // Convenzione opzionale
    if (o.codice_convenzione) {
        mailbody += `<tr><td><b>Codice Convenzione</b></td><td>${htmlEscape(o.codice_convenzione)}</td></tr>`;
        mailbody += `<tr><td><b>Nome Convenzione</b></td><td>${htmlEscape(o.nome_convenzione || "")}</td></tr>`;
    }

    // Elenco corsi raggruppati
    countRows.forEach((r, i) => {
        const label = `${htmlEscape(r.codice_corso)}|${htmlEscape(r.corso_title)} (N:${r.numcount})`;
        if (i === 0) {
            mailbody += `<tr><td><b>Corsi</b></td><td>${label}</td></tr>`;
        } else {
            mailbody += `<tr><td></td><td>${label}</td></tr>`;
        }
    });

    // Imponibile/Iva/Discount come in PHP
    if (Number(o.billing_discount) > 0) {
        const imponibile = Number(o.costo_imponibile) - Number(o.billing_discount);
        const iva = (imponibile * 22) / 100;
        const totale = imponibile + iva;
        mailbody += `<tr><td><b>Imponibile</b></td><td>&euro; ${formatEuro(imponibile)}</td></tr>`;
        mailbody += `<tr><td><b>Iva</b></td><td>&euro; ${formatEuro(iva)}</td></tr>`;
        mailbody += `<tr><td><b>Sconto</b></td><td>${htmlEscape(o.billing_discount)} (${htmlEscape(o.billing_code_discount || "")})</td></tr>`;
        mailbody += `<tr><td><b>Totale</b></td><td>&euro; ${formatEuro(totale)}</td></tr>`;
    } else {
        mailbody += `<tr><td><b>Imponibile</b></td><td>&euro; ${formatEuro(o.costo_imponibile)}</td></tr>`;
        if ((o.metodo_di_pagamento || "").toLowerCase() !== "bonifico") {
            mailbody += `<tr><td><b>ONERI</b></td><td>&euro; ${formatEuro(o.oneri)}</td></tr>`;
        }
        mailbody += `<tr><td><b>Iva</b></td><td>&euro; ${formatEuro(o.iva_a_debito)}</td></tr>`;
        mailbody += `<tr><td><b>Totale</b></td><td>&euro; ${formatEuro(o.fatturato)}</td></tr>`;
    }

    // Dati fatturazione
    mailbody += `<tr><td colspan="2"><hr><b style="color:#557DA1">Dati di fatturazione</b></td></tr>`;
    mailbody += `<tr><td>Ragione Sociale</td><td>${htmlEscape(o.intestazione_fattura || "")}</td></tr>`;
    mailbody += `<tr><td>Sede</td><td>${htmlEscape(o.billing_indirizzo_1 || "")} ${htmlEscape(
        o.billing_cap || ""
    )} ${htmlEscape(o.comune || "")} ${htmlEscape(o.provincia || "")}</td></tr>`;
    mailbody += `<tr><td>P.Iva</td><td>${htmlEscape(o.billing_iva || "")}</td></tr>`;
    mailbody += `<tr><td>Codice fiscale</td><td>${htmlEscape(o.billing_cf || "")}</td></tr>`;
    mailbody += `<tr><td>Indirizzo Email</td><td>${htmlEscape(o.billing_email || "")}</td></tr>`;
    mailbody += `<tr><td>Pec</td><td>${htmlEscape(o.billing_pec || "")}</td></tr>`;
    mailbody += `<tr><td>Codice Destinatario</td><td>${htmlEscape(o.billing_codicedestinatario || "")}</td></tr>`;

    // Dati utenti (corsisti)
    const [corsisti] = await db.query(
        `SELECT * FROM newformazione.wp_woocommerce_rb_corsisti
     WHERE order_id = ?
     ORDER BY corsista_last_name ASC`,
        [order_id]
    );

    mailbody += `<tr><td colspan="2"><hr><br><b style="color:#557DA1">Dati Utenti</b></td></tr>`;

    for (const c of corsisti) {
        mailbody += `<tr><td>Nome</td><td>${htmlEscape(c.corsista_first_name || "")}</td></tr>`;
        mailbody += `<tr><td>Cognome</td><td>${htmlEscape(c.corsista_last_name || "")}</td></tr>`;
        mailbody += `<tr><td>Email</td><td>${htmlEscape(c.corsista_email || "")}</td></tr>`;
        mailbody += `<tr><td>Pec</td><td>${htmlEscape(c.corsista_pec || "")}</td></tr>`;
        mailbody += `<tr><td>Codice fiscale</td><td>${htmlEscape(c.corsista_cf || "")}</td></tr>`;

        // prezzo e sede_esame special per cod6029 come nel PHP
        if ((c.codice_corso || "").trim() === "cod6029") {
            const test = String(o.sede_esame || "").split("=");
            const testpriceRaw = test[test.length - 1] || "0";
            const testprice = Number(String(testpriceRaw).replace("-", ""));
            const price = Number(c.costo_imponibile || 0);
            const prezzo = testprice > 69 ? price - testprice : price;
            mailbody += `<tr><td>Corso</td><td>${htmlEscape(c.codice_corso)}|${htmlEscape(c.corso_title || "")}</td></tr>`;
            mailbody += `<tr><td>Prezzo</td><td>&euro; ${formatEuro(prezzo)}</td></tr>`;
            mailbody += `<tr><td>Sede Esame</td><td>${htmlEscape(o.sede_esame || "")}</td></tr>`;
        } else {
            mailbody += `<tr><td>Corso</td><td>${htmlEscape(c.codice_corso)}|${htmlEscape(c.corso_title || "")}</td></tr>`;
            mailbody += `<tr><td>Prezzo</td><td>&euro; ${formatEuro(c.costo_imponibile)}</td></tr>`;
        }
        mailbody += `<tr><td><hr></td><td><hr></td></tr>`;
    }

    mailbody += `<tr><td>Note</td><td>${htmlEscape(o.note || "")}</td></tr>`;
    mailbody += `<tr><td>Consenso condizioni e privacy</td><td>Si</td></tr>`;
    mailbody += `</table>`;

    return { html: mailbody, ordine: o, corsiRaggr: countRows };
}

// Subject in base a metodo e convenzione (replica switch PHP)
function buildSubject(o, order_id) {
    const isBonifico = (o.metodo_di_pagamento || "").toLowerCase() === "bacs";
    const hasConv = !!o.codice_convenzione;

    if (hasConv) {
        if (isBonifico) return `Ordine ${order_id} Bonifico (convenzione) ${o.intestazione_fattura} ${order_id}`;
        return `Ordine ${order_id} ${o.metodo_di_pagamento} (convenzione) ${o.intestazione_fattura}`;
    } else {
        if (isBonifico) return `Ordine ${order_id} Bonifico (sito) ${o.intestazione_fattura}`;
        return `Ordine ${order_id} ${o.metodo_di_pagamento} (sito) ${o.intestazione_fattura}`;
    }
}

// POST /api/iscrizioni/ordini/:order_id/reinvia?email=0|1|2
router.post("/ordini/:order_id/reinvia", async (req, res) => {
    const { order_id } = req.params;
    const emailMode = String(req.query.email ?? "0"); // "0" default → invia interno
    try {
        const db = await getConnection("SITE", "newformazione");

        const { html, ordine } = await buildOrderEmailHTML(db, order_id);

        // Destinatari come in PHP:
        // email=1 → to = billing_email, bcc = FROM
        // email=2 → to = billing_email
        // default → to = FROM
        let to = EMAIL_FROM;
        let bcc = undefined;
        if (emailMode === "1") {
            to = ordine.billing_email || EMAIL_FROM;
            bcc = EMAIL_FROM;
        } else if (emailMode === "2") {
            to = ordine.billing_email || EMAIL_FROM;
        }

        const subject = buildSubject(ordine, order_id);

        await invioMail({
            from: EMAIL_FROM,
            to,
            bcc,
            subject,
            html,
        });

        res.json({ success: true, message: "Email inviata" });
    } catch (err) {
        console.error("❌ reinvia ordine:", err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/iscrizioni/ordini/:order_id/segnala
router.post("/ordini/:order_id/segnala", async (req, res) => {
    const { order_id } = req.params;
    try {
        const db = await getConnection("SITE", "newformazione");

        // Corpo sollecito (header) + riepilogo come in PHP
        const { html, ordine } = await buildOrderEmailHTML(db, order_id);

        const sollecitoHeader = (() => {
            const totale = formatEuro(ordine.fatturato);
            const data = ordine.formatted_date || "";
            return `
<div style='text-align:justify'><span style='font-family:Times New Roman;font-size:14pt;color:#00314C'>
Buongiorno,<br>
l'ordine inserito non risulta concluso, le chiediamo quindi se possiamo supportarla nella risoluzione di qualsivoglia problematica. <br>
<ul>
<li>Nel caso fosse intenzionato a completare l'acquisto, può effettuare il pagamento con bonifico utilizzando i seguenti dati:<br>
<i><strong>C/C INTESTATO A: RB CONSULTING S.R.L. presso Credem<br>
IBAN: IT33S0303203200010000908197<br>
CAUSALE BONIFICO: ${htmlEscape(order_id)}<br>
IMPORTO: &euro; ${totale}</strong></i></li>
<li>Qualora volesse effettuare il pagamento con carta, la invitiamo ad inserire nuovamente l'ordine:<br>
<a href='https://www.formazioneintermediari.com'>RB Intermediari</a></li>
<li>Se avesse già provveduto al pagamento, la invitiamo a non considerare questa comunicazione.</li>
</ul>

Restando a disposizione per ulteriori chiarimenti, <br>
cordiali saluti. <br>
Segreteria Didattica<br><br>
<p style='font-family:Times New Roman;font-size:12pt;color:#00314C'><i><b>RB Intermediari</b><br> Progetto di RB Consulting S.r.l.<br>
Via Crescenzio, 25<br />
00193 Roma (RM)<br>
800.69.99.92<br>
<a href='mailto:info@formazioneintermediari.com' style='color:#0563c1;text-decoration:underline'>info@formazioneintermediari.com</a><br>
<a href='https://www.formazioneintermediari.com' style='color:#0563c1;text-decoration:underline'>www.formazioneintermediari.com</a></i><br><hr>
</p></span></div>
`;
        })();

        const subject = `Ordine inevaso - Ordine n. ${order_id} del ${ordine.formatted_date || ""}`;
        const to = ordine.billing_email || EMAIL_FROM;

        // invia (header+riepilogo)
        await invioMail({
            from: EMAIL_FROM,
            to,
            subject,
            html: sollecitoHeader + html,
        });

        // aggiorna contatori come PHP
        await db.query(
            `UPDATE newformazione.wp_woocommerce_rb_ordini
       SET segnala = COALESCE(segnala,0) + 1
       WHERE order_id = ?`,
            [order_id]
        );
        await db.query(
            `INSERT INTO newformazione.segnalazioni (idordine) VALUES (?)`,
            [order_id]
        );

        res.json({ success: true, message: "Sollecito inviato" });
    } catch (err) {
        console.error("❌ segnala ordine:", err);
        res.status(500).json({ error: err.message });
    }
});


// 📌 Lista convenzioni attive
router.get("/convenzioni", async (req, res) => {
    try {
        const db = await getConnection("EFAD", "wpacquisti");
        const [rows] = await db.query(
            "SELECT name, piattaforma, host FROM newconvenzioni WHERE visibilita=1 ORDER BY name ASC"
        );

        res.json(
            rows.map(r => ({
                name: r.name,
                piattaforma: r.piattaforma,
                host: r.host
            }))
        );
    } catch (err) {
        console.error("❌ convenzioni:", err);
        res.status(500).json({ error: err.message });
    }
});


// 📌 Corsi ammessi per una convenzione
router.get("/corsi", async (req, res) => {
    const { convenzione } = req.query;
    if (!convenzione) return res.status(400).json({ error: "convenzione richiesta" });

    try {
        const dbConv = await getConnection("EFAD", "wpacquisti");

        const [conv] = await dbConv.query(
            "SELECT codice, piattaforma, host FROM newconvenzioni WHERE name=?",
            [convenzione]
        );

        if (!conv.length) {
            return res.json([]);
        }

        const { codice, piattaforma, host } = conv[0];

        // 🔹 Corsi acquistabili dalla convenzione selezionata
        const [prezzi] = await dbConv.query(
            `SELECT corso FROM tblprezzi b 
             RIGHT JOIN newconvenzioni a ON a.codice=b.codice 
             WHERE prezzo <> '' AND prezzo <> 0 AND a.name=?`,
            [convenzione]
        );

        const courseCodes = prezzi.map(p => `'${p.corso.trim()}'`).join(",");
        if (!courseCodes) return res.json([]);

        // 🔹 Risolvi piattaforma da host
        const resolved = resolvePlatformFromHost(host, piattaforma);
        const cnCourses = await getConnection(resolved.connKey, resolved.db);

        // 🔹 Query finale su piattaforma (learning_course)
        const [rows] = await cnCourses.query(
            `SELECT code, name, idCourse 
             FROM learning_course 
             WHERE code IN (${courseCodes}) 
             ORDER BY code ASC`
        );

        res.json(
            rows.map(r => ({
                code: r.code,
                name: r.name,
                idCourse: r.idCourse
            }))
        );
    } catch (err) {
        console.error("❌ corsi convenzione:", err);
        res.status(500).json({ error: err.message });
    }
});




module.exports = router;