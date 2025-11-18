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
    invioMail,
    // pipeline
    IscriviaSimulazione,
} = require("../utils/helper");


// ========================= Support: get convenzione (newconvenzioni) =========================
async function loadConvenzioneByCodeOrName(convenzione) {
    const DEFAULT = {
        name: "Formazione Intermediari",
        codice: "RB",
        piattaforma: process.env.MYSQL_FORMA4,
        newindirizzoweb: "https://ifad.formazioneintermediari.com",
        mailbcc: "",
        fattura: false
    };

    if (!convenzione) return DEFAULT;

    const connWP = await getConnection("wpacquisti");

    // Se arriva oggetto
    if (typeof convenzione === "object") {
        if (convenzione.piattaforma) return convenzione;

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

async function attachSegnalazioniInfo(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    const ids = rows
        .map(r => r.order_id)
        .filter(id => id !== undefined && id !== null)
        .map(String);
    if (!ids.length) return rows;

    try {
        const segDb = await getConnection("newformazione");
        const placeholders = ids.map(() => "?").join(",");
        const [info] = await segDb.query(
            `SELECT idordine, COUNT(*) AS total, 
                GROUP_CONCAT(DATE_FORMAT(date_ins, '%d/%m/%Y %H:%i') ORDER BY date_ins SEPARATOR '||') AS dates
             FROM segnalazioni
             WHERE idordine IN (${placeholders})
             GROUP BY idordine`,
            ids
        );
        const map = new Map(info.map(r => [String(r.idordine), r]));
        rows.forEach((row) => {
            const data = map.get(String(row.order_id));
            row.segnalazioni_count = data?.total || 0;
            row.segnalazioni_dates = data?.dates || "";
        });
    } catch (err) {
        console.warn("segInfo WARN:", err.message);
    }
    return rows;
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

const CAMPI_SUPPLEMENTARI = {
    Intestatario_fattura: 11,
    telefono: 20,
    data_nascita: 22,
    fax: 19,
    cf: 23,
    email: 24,
    societa: 21,
    sede: 12,
    pi: 13,
    cell: 14,
    email_fattura: 15,
    residenza: 16,
    convenzione: 25,
    clearPassword: 26,
    socio: 27,
    nassociato: 28,
    sez: 29,
    intermediadaily: 30,
    pec: 31,
    aula: 32,
    pecfattura: 34,
    codicedestinatario: 35,
    indirizzo: 36,
    cap: 37,
    regione: 38,
    provincia: 39,
    comune: 40,
};

function normalizeBillingData(raw = null) {
    if (!raw || typeof raw !== "object") return null;
    const normalized = {};
    const map = [
        ["Intestatario_fattura", raw.intestatario],
        ["pi", raw.partitaIva],
        ["email_fattura", raw.email],
        ["pecfattura", raw.pec],
        ["codicedestinatario", raw.codiceDestinatario],
        ["indirizzo", raw.indirizzo],
        ["sede", raw.indirizzo],
        ["cap", raw.cap],
        ["comune", raw.comune],
        ["provincia", raw.provincia],
        ["regione", raw.regione],
    ];
    for (const [key, value] of map) {
        const v = typeof value === "string" ? value.trim() : "";
        if (v) normalized[key] = v;
    }
    return Object.keys(normalized).length ? normalized : null;
}

async function processEnrollRows({
    rows,                      // array utenti normalizzati
    db,                        // nome database target
    piattaforma,               // alias (alcune chiamate legacy)
    convenzioneName,           // nome convenzione preferito
    convenzioneFallback,       // eventuale fallback
    nomesito,                  // per email             // es. "cod3035"
    ifSendMail = true,         // invio email
    webOrderUpdate = null,     // fn opzionale per aggiornare ordine web
    fatturazione = null,       // dati fatturazione manuali
}) {
    const results = [];

    const targetDb = (db || piattaforma || "").trim();
    const convName = convenzioneName || convenzioneFallback || rows?.[0]?.convenzione || "";
    if (!targetDb) throw new Error("Database destinazione non specificato per processEnrollRows");
    console.log(`[processEnrollRows] START rows=${rows?.length || 0} db=${targetDb} convenzione=${convName || ""}`);

    const cn = await getConnection(targetDb);
    const billingOverrides = normalizeBillingData(fatturazione);

    // ricava id corso

    for (const src of rows) {
        const res = {
            nome: src.nome || "",
            cognome: src.cognome || "",
            email: src.email,
            pec: src.pec,
            bccEmail: src.bccEmail || "",
            stato: "OK",
            esitoIscrizione: "In corso",
            note: "",
            mailEsito: "KO",
            bccEsito: src.bccEmail ? "KO" : "N/A",
            pecEsito: src.pec ? "KO" : "N/A",
        };
        try {

            const { idcourse, codeFinal, title } = await getCourseByCode(cn, src.codecorso, src.corso);

            // normalizza
            let nome = FormattaNominativo(Normalizza(src.nome || ""));
            let cognome = FormattaNominativo(Normalizza(src.cognome || ""));
            let email = String(src.email || "").toLowerCase().trim();
            let pec = String(src.pec || "").toLowerCase().trim();
            let cf = String(src.cf || "").toUpperCase().trim();
            let tel = String(src.telefono || "").trim();
            let passwordReal = "";
            const convInfo = src.convenzioneInfo || {};
            const fax = String(src.fax || "").trim();
            const cell = String(src.cell || src.cellulare || src.telefonoCell || convInfo.cell || "").trim();
            const sedeVal = String(src.sede || src.sedeFattura || convInfo.sededistaccata || convInfo.sede || "").trim();
            const ragSoc = String(src.ragionesocialefatt || src.societa || convInfo.ragsoc || convInfo.societa || "").trim();
            const intestatarioFatt = String(
                src.intestatarioFattura || src.intestatario_fattura || ragSoc || convInfo.intestatario_fattura || `${nome} ${cognome}`
            ).trim();
            const partitaIva = String(src.piva || src.partitaiva || src.partitaIva || convInfo.piva || convInfo.pi || "").toUpperCase().trim();
            const emailFatt = String(src.emailFattura || src.emailfatt || convInfo.email_fattura || convInfo.email || "").toLowerCase().trim();
            const telefonoFatt = String(src.telefonoFattura || src.telefonof || convInfo.telefono || convInfo.tel || "").trim();
            const residenza = String(src.residenza || convInfo.residenza || "").trim();
            const socio = String(src.socio || convInfo.socio || "").trim();
            const nassociato = String(src.nassociato || convInfo.nassociato || "").trim();
            const sez = String(src.sez || convInfo.sez || "").trim();
            const intermediadaily = String(src.intermediadaily || convInfo.intermediadaily || "").trim();
            const aula = String(src.aula || convInfo.newindirizzoweb || convInfo.indirizzoweb || "").trim();
            const pecFatt = String(src.pecfattura || src.pecfatt || src.pec || convInfo.pecfattura || convInfo.pec || "").toLowerCase().trim();
            const codDest = String(src.codiceDestinatario || src.codicedestinatario || convInfo.codicedestinatario || "").toUpperCase().trim();
            const indirizzo = String(src.indirizzo || sedeVal || convInfo.indirizzo || "").trim();
            const cap = String(src.cap || convInfo.cap || "").trim();
            const regione = String(src.regione || convInfo.regione || "").trim();
            const provincia = String(src.provincia || convInfo.provincia || "").trim();
            const comune = String(src.comune || convInfo.comune || "").trim();

            // esistenza
            let ifexist = false;
            let idst = 0;
            let username = ((cognome.replace(/[’' ]/g, "").slice(0, 3) + (nome || "").replace(/[’' ]/g, "").slice(0, 3)) || (cognome + nome)).toLowerCase();
            const dtExist = await GetIfUserExist(nome, cognome, cf, email, cn, convName);
            if (dtExist && dtExist.length) {
                ifexist = true;
                idst = dtExist[0].idst;
                username = dtExist[0].userid.replace("/", "");
                await cn.query(
                    `UPDATE core_user SET firstname=?, lastname=?, email=? WHERE idst=?`,
                    [nome, cognome, email, idst]
                );
                const [pwdRow] = await cn.query(
                    `SELECT user_entry FROM core_field_userentry WHERE id_common=26 AND id_user=? LIMIT 1`,
                    [idst]
                );
                passwordReal = pwdRow?.[0]?.user_entry || "";
            }

            // new user 
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

            // evita doppia iscrizione stesso corso
            if (idst) {
                const [already] = await cn.query(
                    `SELECT 1 FROM learning_courseuser WHERE idUser=? AND idCourse=? LIMIT 1`,
                    [idst, idcourse]
                );
                if (already.length) {
                    res.stato = "DUPLICATO";
                    res.esitoIscrizione = "KO";
                    res.error = "Utente già iscritto allo stesso corso";
                    res.note = "Utente già iscritto allo stesso corso";
                    results.push(res);
                    console.warn(`[processEnrollRows] DUPLICATO email=${email} idcourse=${idcourse}`);
                    continue;
                }
            }

            // details
            const detailData = {
                Intestatario_fattura: intestatarioFatt,
                telefono: tel,
                data_nascita: src.data_nascita || src.dataNascita || "",
                fax,
                cf,
                email,
                societa: ragSoc,
                sede: sedeVal,
                pi: partitaIva,
                cell: cell || telefonoFatt,
                email_fattura: emailFatt,
                residenza,
                convenzione: convName,
                clearPassword: passwordReal,
                socio,
                nassociato,
                sez,
                intermediadaily,
                pec,
                aula,
                pecfattura: pecFatt,
                codicedestinatario: codDest,
                indirizzo,
                cap,
                regione,
                provincia,
                comune,
            };
            if (billingOverrides) {
                for (const [key, value] of Object.entries(billingOverrides)) {
                    detailData[key] = value;
                }
            }

            for (const [key, value] of Object.entries(detailData)) {
                const fieldId = CAMPI_SUPPLEMENTARI[key];
                if (fieldId) await adddetails(fieldId, idst, value, cn);
            }

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

            // group membership (replica logica VB)
            const [gCourse] = await cn.query(
                `SELECT idst FROM core_group WHERE groupid LIKE ? LIMIT 1`,
                [`%/lms/course/${idcourse}/subscribed/3%`]
            );
            const courseGroupId = gCourse?.[0]?.idst || null;

            let convenzioneGroupId = null;
            try {
                const [gConv] = await cn.query(
                    `SELECT idst FROM core_group WHERE groupid LIKE ? LIMIT 1`,
                    [`%/${convName}`]
                );
                convenzioneGroupId = gConv?.[0]?.idst || null;
            } catch {
                convenzioneGroupId = null;
            }

            const baseGroups = [2, 1, 5, 6];
            let groupsToInsert = [];
            if (ifexist) {
                if (courseGroupId) groupsToInsert.push(courseGroupId);
                if (convenzioneGroupId) groupsToInsert.push(convenzioneGroupId);
            } else {
                groupsToInsert.push(...baseGroups);
                if (courseGroupId) groupsToInsert.push(courseGroupId);
                if (convenzioneGroupId) groupsToInsert.push(convenzioneGroupId);
            }

            const uniqueGroups = [...new Set(groupsToInsert.filter(Boolean))];
            for (const groupId of uniqueGroups) {
                try {
                    await cn.query(
                        `INSERT INTO core_group_members (idst, idstMember) VALUES (?, ?)`,
                        [groupId, idst]
                    );
                } catch {
                    // ignora errori duplicati
                }
            }

            // simulazioni
            if (SIM_MAP[idcourse]) await IscriviaSimulazione(idst, SIM_MAP[idcourse], now, cn, targetDb);
            if (/^codIVASS30OAM15$/i.test(codeFinal)) await IscriviaSimulazione(idst, 23, now, cn, targetDb);

            // email
            if (ifSendMail) {
                const esito = await SaveAndSend({
                    idcourse: idcourse,
                    file: "",
                    nominativo: `${nome} ${cognome}`,
                    email,
                    pec,
                    bcc: src.bccEmail || "",
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
                res.mailEsito = esito?.emailOk ? "OK" : "KO";
                res.bccEsito = esito?.bccOk ? "OK" : "KO";
                res.pecEsito = src.pec ? (esito?.pecOk ? "OK" : "KO") : "N/A";
            }

            // web update opzionale
            if (typeof webOrderUpdate === "function") {
                try { await webOrderUpdate(src.order_id); } catch (e) { await logwrite("webOrderUpdate: " + e.message); }
            }

            res.esitoIscrizione = "OK";
            res.note = "";
            results.push(res);
            console.log(
                `[processEnrollRows] OK email=${email} idst=${idst} idcourse=${idcourse} convenzione=${convName || ""}`
            );
        } catch (err) {
            await logwrite("Enroll ERR: " + err);
            console.log(
                `[processEnrollRows] KO email=${src?.email || ""} convenzione=${convName || ""} reason=${err.message}`
            );
            res.stato = "ERRORE";
            res.error = err.message;
            res.esitoIscrizione = "KO";
            res.note = err.message;
            results.push(res);
            continue;
        }
    }


    const okCount = results.filter(r => r.stato === "OK").length;
    const koCount = results.filter(r => r.stato !== "OK").length;
    console.log(`[processEnrollRows] END ok=${okCount} ko=${koCount} convenzione=${convName || ""}`);

    return results;
}

// ========================= POST /api/iscrizioni/excel =========================
// ✅ NUOVA ROUTE - Import da Excel JSON (frontend manda già parsed)
router.post("/excel", async (req, res) => {
    try {
        const { convenzione, corso, utenti, fatturazione } = req.body;
        console.log("DEBUG utenti ricevuti:", utenti);
        if (!Array.isArray(utenti) || utenti.length === 0) {
            return res.status(400).json({ error: "Lista utenti mancante o vuota" });
        }

        if (!convenzione) {
            return res.status(400).json({ error: "Convenzione mancante" });
        }

        if (!corso) {
            return res.status(400).json({ error: "Corso mancante" });
        }

        const conv = await loadConvenzioneByCodeOrName(convenzione);
        if (!conv) {
            return res.status(404).json({ error: "Convenzione non trovata" });
        }

        const convName = conv.name || conv.Name || conv.Codice || convenzione;
        const nomesito = conv.newindirizzoweb || conv.indirizzoweb || "";
        const targetDb = (conv.piattaforma || conv.Piattaforma || "").toLowerCase();
        if (!targetDb) {
            return res.status(400).json({ error: "Impossibile determinare la piattaforma della convenzione selezionata" });
        }

        const [courseCodeRaw, ...courseNameParts] = String(corso || "").split("|");
        const courseCode = (courseCodeRaw || "").trim();
        const courseName = courseNameParts.join("|").trim();

        // normalizza ogni utente
        const utentiNormalized = utenti.map((u, idx) => {
            // 🔍 Log per sicurezza
            if (typeof u !== "object") {
                console.warn("❌ FORMATO NON OGGETTO all'indice:", idx, "→", u);
                throw new Error("Formato utente non valido (atteso oggetto)");
            }

            // 🔐 Estraggo campi con fallback sicuro
            const cognome = (u.cognome || "").trim();
            const nome = (u.nome || "").trim();
            const email = (u.email || "").trim().toLowerCase();
            const cf = (u.cf || "").trim().toUpperCase();
            const telefono = (u.telefono || "").trim();

            // 🔎 Validazione minima
            if (!cognome || !nome || !email || !cf) {
                console.warn("⚠️ Dati mancanti all'indice:", idx, u);
                throw new Error("Formato utente non valido: campi mancanti");
            }

            return {
                nome,
                cognome,
                email,
                cf,
                telefono,
                codecorso: courseCode,
                nomecorso: courseName || courseCode,
                convenzione: convName,
                bccEmail: conv.mailbcc || ""
            };
        });

        console.log("📌 Excel →", convName, targetDb, utenti.length);

        // ✅ Connessione piattaforma target
        const cn = await getConnection(targetDb);

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


        const mustCollectBilling = (convName || "").toLowerCase() === "formazione intermediari";
        const billingData = mustCollectBilling && fatturazione && typeof fatturazione === "object" ? fatturazione : null;

        // ✅ Uso la mega-funzione esistente 💪
        const results = await processEnrollRows({
            rows: utentiNormalized,
            db: targetDb,
            convenzioneName: convName,
            convenzioneFallback: convName,
            nomesito,
            ifSendMail: true,
            webOrderUpdate,
            fatturazione: billingData,
        });

        const ok = results.filter(r => !r.error).length;
        const fail = results.filter(r => r.error).length;

        return res.json({
            success: fail === 0,
            ok,
            fail,
            results,
            errorDetails: results.filter(r => r.error),
            message: `Import completato: ${ok} OK, ${fail} KO`
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
        const webDbName = (req.query.db || req.body.webdb || "newformazione").toString().trim().toLowerCase();

        if (!idordine)
            return res.status(400).json({ error: "idordine richiesto" });

        const dbWeb = await getConnection(webDbName);

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


        const fallbackPlatforms = {
            newformazione: process.env.MYSQL_FORMA4?.toLowerCase() || "forma4",
            rbacademy: "formazionecondorb",
            novastudia: "efadnovastdia",
        };

        const nomesito = conv.newindirizzoweb || conv.indirizzoweb || "";
        const convName = conv.name || conv.Name || conv.Codice || conv.codice || codiceConv || "Senza nome";

        let piattaforma = (conv.piattaforma || conv.Piattaforma || "").toLowerCase();
        if (!piattaforma) {
            piattaforma = fallbackPlatforms[webDbName] || "";
        }

        if (!piattaforma) {
            return res.status(400).json({ error: "Impossibile determinare la piattaforma target per l'ordine selezionato" });
        }

        // ✅ Ricava utenti/corsi collegati
        const [rows] = await dbWeb.query(
            `SELECT 
                id,
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

        const singleCorsistaIds = []
            .concat(req.body.corsistaIds || [])
            .concat(req.body.corsistaId ? [req.body.corsistaId] : [])
            .map(String)
            .filter(Boolean);

        let corsistiRows = rows;
        if (singleCorsistaIds.length) {
            corsistiRows = rows.filter(r => singleCorsistaIds.includes(String(r.id)));
            if (!corsistiRows.length) {
                return res.status(404).json({ error: "Corsista selezionato non trovato nell'ordine richiesto" });
            }
        }

        // ✅ struttura riga compatibile EXCEL
        const utenti = corsistiRows.map(r => ({
            nome: r.nome,
            cognome: r.cognome,
            email: r.email?.toLowerCase(),
            pec: r.pec?.toLowerCase(),
            cf: r.cf?.toUpperCase(),
            telefono: r.telefono || "",
            codecorso: r.codecorso?.trim() || "",
            convenzione: convName,
            sede: `${r.sede_esame || ""}${r.wdm_user_custom_data || ""}`,
            order_id: idordine,
            corso: r.corso,
            bccEmail: conv.mailbcc || ""
        }));

        // ✅ PROCESSA ISCRIZIONI
        const results = await processEnrollRows({
            rows: utenti,
            db: piattaforma,
            convenzioneName: convName,
            convenzioneFallback: convName,
            nomesito,
            ifSendMail: sendmail,
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
                convenzione: convName,
                ok: success.length,
                ko: fail.length
            },
            results,
            message: `Ordine ${idordine}: ${success.length} OK, ${fail.length} KO`
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
        const search = (req.query.search || "").toString().trim();

        const db = await getConnection("newformazione");

        const filters = [];
        const params = [];
        if (search) {
            const like = `%${search}%`;
            filters.push(`(order_id LIKE ? OR COALESCE(nome_convenzione,'') LIKE ? OR COALESCE(intestazione_fattura,'') LIKE ? OR COALESCE(billing_email,'') LIKE ?)`);
            params.push(like, like, like, like);
        }
        const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

        const dataSql = `
            SELECT *
            FROM wp_woocommerce_rb_ordini
            ${whereClause}
            ORDER BY date_ins DESC
            LIMIT ? OFFSET ?`;
        const [rows] = await db.query(dataSql, [...params, limit, offset]);
        await attachSegnalazioniInfo(rows);

        const countSql = `
            SELECT COUNT(*) as total
            FROM wp_woocommerce_rb_ordini
            ${whereClause}`;
        const [[{ total }]] = await db.query(countSql, params);

        res.json({ rows, total });
    } catch (err) {
        console.error("Errore /iscrizioni/sito:", err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 📦 Ottiene iscrizioni ACADEMY (EFAD)
 * GET /api/iscrizioni/aca?db=rbacademy
 */
router.get("/aca", async (req, res) => {
    try {
        const page = parseInt(req.query.page || "1", 10);
        const limit = parseInt(req.query.limit || "50", 10);
        const offset = (page - 1) * limit;
        const search = (req.query.search || "").toString().trim();

        const db = await getConnection("rbacademy");

        const filters = [];
        const params = [];
        if (search) {
            const like = `%${search}%`;
            filters.push(`(order_id LIKE ? OR COALESCE(nome_convenzione,'') LIKE ? OR COALESCE(intestazione_fattura,'') LIKE ? OR COALESCE(billing_email,'') LIKE ?)`);
            params.push(like, like, like, like);
        }
        const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

        const dataSql = `
            SELECT *
            FROM wp_woocommerce_rb_ordini
            ${whereClause}
            ORDER BY date_ins DESC
            LIMIT ? OFFSET ?`;
        const [rows] = await db.query(dataSql, [...params, limit, offset]);
        await attachSegnalazioniInfo(rows);

        const countSql = `
            SELECT COUNT(*) as total
            FROM wp_woocommerce_rb_ordini
            ${whereClause}`;
        const [[{ total }]] = await db.query(countSql, params);

        res.json({ rows, total });
    } catch (err) {
        console.error("Errore /iscrizioni/sito:", err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 📦 Ottiene iscrizioni N.O.V.A. (SITE)
 * GET /api/iscrizioni/nova?db=newformazione
 */
router.get("/nova", async (req, res) => {
    try {
        const page = parseInt(req.query.page || "1", 10);
        const limit = parseInt(req.query.limit || "50", 10);
        const offset = (page - 1) * limit;
        const search = (req.query.search || "").toString().trim();

        const db = await getConnection("novastudia");

        const filters = [];
        const params = [];
        if (search) {
            const like = `%${search}%`;
            filters.push(`(order_id LIKE ? OR COALESCE(nome_convenzione,'') LIKE ? OR COALESCE(intestazione_fattura,'') LIKE ? OR COALESCE(billing_email,'') LIKE ?)`);
            params.push(like, like, like, like);
        }
        const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

        const dataSql = `
            SELECT *
            FROM wp_woocommerce_rb_ordini
            ${whereClause}
            ORDER BY date_ins DESC
            LIMIT ? OFFSET ?`;
        const [rows] = await db.query(dataSql, [...params, limit, offset]);
        await attachSegnalazioniInfo(rows);

        const countSql = `
            SELECT COUNT(*) as total
            FROM wp_woocommerce_rb_ordini
            ${whereClause}`;
        const [[{ total }]] = await db.query(countSql, params);

        res.json({ rows, total });
    } catch (err) {
        console.error("Errore /iscrizioni/sito:", err);
        res.status(500).json({ error: err.message });
    }
});



// 📦 Ottiene corsisti legati a un ordine specifico
// GET /api/iscrizioni/ordini/:order_id/corsisti?db=wpacquisti&host=IFAD
router.get("/ordini/:order_id/corsisti", async (req, res) => {
    try {
        const { order_id } = req.params;
        const dbName = req.query.db || "newformazione";


        const db = await getConnection(dbName);

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
async function buildOrderEmailHTML(db, order_id, dbName = "newformazione") {
    const LOCATION_SCHEMA = "newformazione";
    const locationPrefix = `${LOCATION_SCHEMA}.`;

    // 1) Count corsi by codice_corso
    const [countRows] = await db.query(
        `SELECT COUNT(*) AS numcount, codice_corso, corso_title
         FROM wp_woocommerce_rb_corsisti
         WHERE order_id = ?
         GROUP BY codice_corso, corso_title`,
        [order_id]
    );

    // 2) Riga ordine con comuni/province risolti + data in dd/mm/yyyy (replica PHP)
    const [ordRows] = await db.query(
        `SELECT a.*,
            DATE_FORMAT(a.date_ins, '%d/%m/%Y') AS formatted_date,
            (SELECT comune FROM ${locationPrefix}rb_comuni_2016 WHERE id_comune = a.billing_comune) AS comune,
            (SELECT provincia FROM ${locationPrefix}rb_province_2016 WHERE id_provincia = a.billing_provincia) AS provincia
         FROM wp_woocommerce_rb_ordini a
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
        `SELECT * FROM wp_woocommerce_rb_corsisti
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
        const webDbName = (req.query.db || "newformazione").toString().trim().toLowerCase();
        const db = await getConnection(webDbName);

        const { html, ordine } = await buildOrderEmailHTML(db, order_id, webDbName);

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
        const webDbName = (req.query.db || "newformazione").toString().trim().toLowerCase();
        const db = await getConnection(webDbName);
        const segDb = await getConnection("newformazione");

        // Corpo sollecito (header) + riepilogo come in PHP
        const { html, ordine } = await buildOrderEmailHTML(db, order_id, webDbName);

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
            `UPDATE wp_woocommerce_rb_ordini
       SET segnala = COALESCE(segnala,0) + 1
       WHERE order_id = ?`,
            [order_id]
        );
        await segDb.query(
            `INSERT INTO segnalazioni (idordine, date_ins) VALUES (?, NOW())`,
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
        const db = await getConnection("wpacquisti");
        const [rows] = await db.query(
            "SELECT name, piattaforma FROM newconvenzioni WHERE visibilita=1 ORDER BY name ASC"
        );

        res.json(
            rows.map(r => ({
                name: r.name,
                piattaforma: r.piattaforma,

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
        const dbConv = await getConnection("wpacquisti");

        const [conv] = await dbConv.query(
            "SELECT piattaforma FROM newconvenzioni WHERE name=?",
            [convenzione]
        );

        if (!conv.length) {
            return res.json([]);
        }

        const { piattaforma } = conv[0];
        const targetDb = (piattaforma || "").toLowerCase();
        if (!targetDb) {
            throw new Error("Impossibile determinare la piattaforma associata alla convenzione selezionata");
        }

        // 🔹 Corsi acquistabili dalla convenzione selezionata
        const [prezzi] = await dbConv.query(
            `SELECT corso FROM tblprezzi b 
             RIGHT JOIN newconvenzioni a ON a.codice=b.codice 
             WHERE prezzo <> '' AND prezzo <> 0 AND a.name=?`,
            [convenzione]
        );

        const courseCodes = prezzi.map(p => `'${p.corso.trim()}'`).join(",");
        if (!courseCodes) return res.json([]);

        // 🔹 Connessione piattaforma target
        const cnCourses = await getConnection(targetDb);

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
