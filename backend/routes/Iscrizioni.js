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
const { writeLog, logError } = require("../utils/logger");
const { inspect } = require("util");

const formatLogData = (payload) =>
    inspect(payload, { depth: 4, maxArrayLength: 50, breakLength: 160 });
const logIscrizioni = (message, level = "INFO") => writeLog("iscrizioni", message, level);
const logIscrizioniError = (message, errorObject = null) =>
    logError("iscrizioni", message, errorObject);

const PACKAGE_COURSE_CREDITS = {
    77: 4,
    78: 8,
};

const PACKAGE_CATEGORY_ID = 5;

const splitPackageTokens = (input) =>
    input.split(/[=,;|]+/).map((item) => item.trim()).filter(Boolean);

function parsePackageSelectionString(raw) {
    if (!raw) return [];
    const source = String(raw);
    const match = source.match(/sceltacorsi=([^&]+)/i);
    const payload = match ? match[1] : source;
    const cleaned = payload.replace(/sceltacorsi/i, "").trim();
    if (!cleaned) return [];
    return splitPackageTokens(cleaned).map((token) =>
        token.replace(/^&/, "").trim(),
    ).filter(Boolean);
}

function detectPackageFromCourseCode(courseCode) {
    if (!courseCode) return null;
    const codeStr = String(courseCode).trim();
    const numeric = parseInt(codeStr, 10);
    if (Number.isNaN(numeric)) return null;
    const credits = PACKAGE_COURSE_CREDITS[numeric];
    if (!credits) return null;
    return { packageId: numeric, credits };
}

function tryBuildPackageSelection(rows, targetCredits) {
    let sum = 0;
    const selected = [];
    for (const row of rows) {
        const rowCredits = Number(row.credits || row.credit || 0);
        if (!rowCredits || rowCredits > targetCredits) {
            continue;
        }
        const next = sum + rowCredits;
        if (next > targetCredits) {
            sum = 0;
            selected.length = 0;
            continue;
        }
        selected.push(row.code);
        sum = next;
        if (sum === targetCredits) {
            return { success: true, codes: [...selected] };
        }
    }
    return { success: false, codes: [] };
}

async function selectRandomPackageCourseCodes(dbName, targetCredits, attempts = 3) {
    if (!dbName || !targetCredits) return [];
    try {
        const conn = await getConnection(dbName);
        for (let i = 0; i < attempts; i++) {
            const [rows] = await conn.query(
                `SELECT code, credits
                 FROM learning_course
                 WHERE idcategory=? AND credits <= ?
                 ORDER BY RAND()
                 LIMIT 200`,
                [PACKAGE_CATEGORY_ID, targetCredits],
            );
            if (!rows.length) continue;
            const { success, codes } = tryBuildPackageSelection(rows, targetCredits);
            if (success && codes.length) {
                return codes;
            }
        }
    } catch (err) {
        logIscrizioni(`selectRandomPackageCourseCodes WARN: ${err.message}`, "WARN");
    }
    return [];
}


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
        logIscrizioni(`segInfo WARN: ${err.message}`, "WARN");
    }
    return rows;
}
// ========================= Support: getCourseByCode =========================
function resolveCourseIdFromRow(row) {
    if (!row) return null;
    return row.idCourse ?? row.idcourse ?? row.idcorso ?? null;
}

async function getCourseByCode(cn, codecorso, fallbackTitle = "") {
    let code = (codecorso || "").trim();
    if (/-/.test(code)) code = code.split("-")[0].trim(); // "cod3035 - titolo"
    if (code.toLowerCase() === "codivass30oam15") {
        const [nameRows] = await cn.query("SELECT code,name FROM learning_course WHERE code='codIVASS30OAM15' LIMIT 1");
        const [rows] = await cn.query("SELECT code,idCourse,name FROM learning_course WHERE code='cod3035' LIMIT 1");
        if (!rows.length) throw new Error("Corso 'cod3035' non trovato per pacchetto codIVASS30OAM15");
        const resolvedId = resolveCourseIdFromRow(rows[0]);
        if (!resolvedId) throw new Error("Corso 'cod3035' trovato ma manca l'id");
        const title = nameRows?.[0]?.name || rows[0].name || fallbackTitle;
        return { idcourse: resolvedId, codeFinal: "codIVASS30OAM15", title };
    }
    const [rows] = await cn.query("SELECT code,idCourse,name FROM learning_course WHERE code=? LIMIT 1", [code]);
    if (!rows.length) throw new Error(`Corso '${code}' non trovato`);
    const resolvedId = resolveCourseIdFromRow(rows[0]);
    if (!resolvedId) throw new Error(`Corso '${code}' trovato ma manca l'id`);
    return { idcourse: resolvedId, codeFinal: rows[0].code, title: rows[0].name || fallbackTitle };
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

const RBACADEMY_DB = (process.env.MYSQL_formazionecondorb || "formazionecondorb").toLowerCase();
const FALLBACK_PLATFORMS = {
    newformazione: process.env.MYSQL_FORMA4?.toLowerCase() || "forma4",
    rbacademy: RBACADEMY_DB,
    novastudia: "efadnovastdia",
};

const BILLING_FIELD_MAP = {
    intestazione_fattura: ["Intestatario_fattura"],
    billing_email: ["email_fattura"],
    billing_pec: ["pec", "pecfattura"],
    billing_cf: ["cf"],
    billing_iva: ["pi"],
    billing_codicedestinatario: ["codicedestinatario"],
    billing_indirizzo_1: ["indirizzo", "sede"],
    billing_cap: ["cap"],
    billing_comune: ["comune"],
    billing_provincia: ["provincia"],
    billing_regione: ["regione"],
    billing_tel: ["telefono"],
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


/**
 * Restituisce la lista di idCourse da iscrivere per un pacchetto IVASS.
 * - Se sceltacorsi è valorizzato => modalità MANUALE
 * - Se sceltacorsi è vuoto      => AUTOMATICA (credits che sommano pacchettoOre)
 */
async function getCoursesForIvassPackage({ cn, idst, pacchettoOre, sceltacorsi }) {
    const selectedIds = [];

    // 1) MODALITÀ MANUALE — stringa tipo "cod1=cod2=cod3"
    if (sceltacorsi && sceltacorsi.trim() !== "") {
        const codes = sceltacorsi
            .split("=")
            .map(c => c.replace("&sceltacorsi", "").trim())
            .filter(Boolean);

        for (const code of codes) {
            const [rows] = await cn.query(
                `SELECT idCourse FROM learning_course WHERE code=? AND idcategory=5 LIMIT 1`,
                [code]
            );
            if (!rows.length) continue;
            const resolvedId = resolveCourseIdFromRow(rows[0]);
            if (resolvedId) selectedIds.push(resolvedId);
        }

        return selectedIds;
    }

    // 2) MODALITÀ AUTOMATICA — cerca corsi "new" sommando credits = pacchettoOre
    const [rows] = await cn.query(
        `
        SELECT idCourse, credits, code
        FROM learning_course
        WHERE idcategory = 5
          AND code LIKE '%new%'
          AND credits <= ?
          AND idCourse NOT IN (
              SELECT idCourse FROM learning_courseuser WHERE idUser = ?
          )
        ORDER BY RAND()
        `,
        [pacchettoOre, idst]
    );

    let credits = 0;
    const chosen = [];

    for (const row of rows) {
        const c = Number(row.credits) || 0;
        const courseId = resolveCourseIdFromRow(row);
        if (!courseId) continue;

        if ((credits + c) === pacchettoOre) {
            chosen.push(courseId);
            credits += c;
            break;
        }

        if (credits > pacchettoOre) {
            credits = 0;
            chosen.length = 0;
        }

        credits += c;
        chosen.push(courseId);
    }

    return chosen;
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
    logIscrizioni(`[processEnrollRows] START rows=${rows?.length || 0} db=${targetDb} convenzione=${convName || ""}`);

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
            const intestazioneFattura = String(
                src.intestazione_fattura ||
                src.intestatarioFattura ||
                src.intestatario_fattura ||
                ragSoc ||
                convInfo.intestatario_fattura ||
                `${nome} ${cognome}`
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
            const orderMeta = src.orderMeta || {};
            const billingName = [orderMeta.billing_nome, orderMeta.billing_cognome].filter(Boolean).join(" ").trim();
            const orderAddress = [orderMeta.billing_indirizzo_1, orderMeta.billing_indirizzo_2].filter(Boolean).join(" ").trim();
            const orderEmail = orderMeta.billing_email || "";
            const orderPec = orderMeta.billing_pec || "";
            const orderCap = orderMeta.billing_cap || "";
            const orderProvincia = orderMeta.billing_provincia || "";
            const orderComune = orderMeta.billing_comune || "";
            const orderRegione = orderMeta.billing_regione || "";
            const orderTelefono = orderMeta.billing_tel || "";
            const orderCodiceDest = orderMeta.billing_codicedestinatario || "";
            const orderCf = orderMeta.billing_cf || "";
            const orderIva = orderMeta.billing_iva || "";
            const numeroFattura = orderMeta.numero_fattura || "";

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
                    logIscrizioni(`[processEnrollRows] DUPLICATO email=${email} idcourse=${idcourse}`, "WARN");
                    continue;
                }
            }

            // details
            const detailData = {
                Intestatario_fattura: billingName || intestazioneFattura,
                telefono: tel || orderTelefono,
                data_nascita: src.data_nascita || src.dataNascita || "",
                fax,
                cf: cf || orderCf,
                email,
                societa: ragSoc,
                sede: sedeVal,
                pi: orderIva || partitaIva,
                cell: cell || telefonoFatt || orderTelefono,
                email_fattura: orderEmail || emailFatt,
                residenza,
                convenzione: convName,
                clearPassword: passwordReal,
                socio,
                nassociato,
                sez,
                intermediadaily,
                pec: orderPec || pec,
                aula,
                pecfattura: orderPec || pecFatt,
                codicedestinatario: orderCodiceDest || codDest,
                indirizzo: orderAddress || indirizzo,
                cap: orderCap || cap,
                regione: orderRegione || regione,
                provincia: orderProvincia || provincia,
                comune: orderComune || comune,
                numero_fattura: numeroFattura,
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

            // -------------------------------------------
            // 5) GESTIONE PACCHETTI IVASS
            // -------------------------------------------
            const isIvass4h = idcourse === 77;
            const isIvass8h = idcourse === 78;
            const pacchettoOre = isIvass8h ? 8 : isIvass4h ? 4 : 0;

            let realCourseIds = [idcourse]; // default: corso singolo

            if (pacchettoOre > 0) {
                realCourseIds = await getCoursesForIvassPackage({
                    cn,
                    idst,
                    pacchettoOre,
                    sceltacorsi: src.sceltacorsi || "",
                });

                if (!realCourseIds.length) {
                    throw new Error(`Nessun corso trovato per Pacchetto ${pacchettoOre} ore`);
                }

                logIscrizioni(
                    `Pacchetto ${pacchettoOre}h -> corsi reali: ${formatLogData(realCourseIds)}`
                );
            }

            // -------------------------------------------
            // 6) ISCRIZIONE AI CORSI REALI
            // -------------------------------------------
            const now = new Date();
            const expire = new Date(now.getTime() + 365 * 24 * 3600 * 1000);

            const begin = ConvertToMysqlDateTime(now);
            const end = ConvertToMysqlDateTime(expire);

            for (const realCourseId of realCourseIds) {
                const suppressForPackageExtra = Boolean(src.packageInfo?.index > 1);
                src.suppressEmail = suppressForPackageExtra;

                // evita doppi
                const [already] = await cn.query(
                    `SELECT 1 FROM learning_courseuser WHERE idUser=? AND idCourse=? LIMIT 1`,
                    [idst, realCourseId]
                );
                if (already.length) continue;

                await cn.query(
                    `INSERT INTO learning_courseuser
                     (idUser, idCourse, order_id, level, date_inscr, waiting, imported_from_connection,
                      absent, cancelled_by, new_forum_post,
                      date_begin_validity, date_expire_validity, codsblocco)
                     VALUES (?, ?, ?, 3, NOW(), 0, 1039, 0, 0, 0, ?, ?, ?)`,
                    [idst, realCourseId, src.order_id || null, begin, end, passwordReal]
                );

                // group membership
                const [gCourse] = await cn.query(
                    `SELECT idst FROM core_group WHERE groupid LIKE ? LIMIT 1`,
                    [`%/lms/course/${realCourseId}/subscribed/3%`]
                );
                const courseGroupId = gCourse?.[0]?.idst || null;

                let convenzioneGroupId = null;
                try {
                    const [gx] = await cn.query(
                        `SELECT idst FROM core_group WHERE groupid LIKE ? LIMIT 1`,
                        [`%/${convName}`]
                    );
                    convenzioneGroupId = gx?.[0]?.idst || null;
                } catch { }

                const baseGroups = [2, 1, 5, 6];
                const groupsToInsert = ifexist
                    ? [courseGroupId, convenzioneGroupId]
                    : [...baseGroups, courseGroupId, convenzioneGroupId];

                for (const gid of [...new Set(groupsToInsert.filter(Boolean))]) {
                    try {
                        await cn.query(
                            `INSERT INTO core_group_members (idst, idstMember) VALUES (?, ?)`,
                            [gid, idst]
                        );
                    } catch { }
                }
            }

            // -------------------------------------------
            // 7) EMAIL (UNA SOLA) — SOLO corso placeholder
            // -------------------------------------------
            let shouldSendMail = ifSendMail && src.suppressEmail !== true;

            if (pacchettoOre > 0) {
                // Forziamo: email SOLO sul placeholder 77 / 78
                shouldSendMail = ifSendMail;
            }

            // simulazioni
            if (SIM_MAP[idcourse]) await IscriviaSimulazione(idst, SIM_MAP[idcourse], now, cn, targetDb);
            if (/^codIVASS30OAM15$/i.test(codeFinal)) await IscriviaSimulazione(idst, 23, now, cn, targetDb);

            // email
            if (shouldSendMail) {
                logIscrizioni(`[BCCemail] ${nome} ${cognome} (${email}) -> ${src.bccEmail || "N/A"}`);
                logIscrizioni(`[weborders] SaveAndSend invocato per ${email} ${title || codeFinal}`);
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
                    ifsend: true,
                    datattivazione: now.toLocaleDateString("it-IT"),
                    codfis: cf,
                });
                logIscrizioni(`[weborders] Invio mail ${email} esito=${esito.emailOk ? "OK" : "KO"} ${esito.esito || ""}`);
                res.mailEsito = esito?.emailOk ? "OK" : "KO";
                res.bccEsito = esito?.bccOk ? "OK" : "KO";
                res.pecEsito = src.pec ? (esito?.pecOk ? "OK" : "KO") : "N/A";
            } else if (ifSendMail && src.suppressEmail) {
                logIscrizioni(`[weborders] Mail skippata per ${email} (suppressEmail attivo)`);
                res.mailEsito = "SKIPPED";
                res.bccEsito = src.bccEmail ? "SKIPPED" : "N/A";
                res.pecEsito = src.pec ? "SKIPPED" : "N/A";
            }

            // web update opzionale
            if (typeof webOrderUpdate === "function") {
                try { await webOrderUpdate(src.order_id); } catch (e) { logIscrizioni(`webOrderUpdate: ${e.message}`, "WARN"); }
            }

            res.esitoIscrizione = "OK";
            res.note = "";
            results.push(res);
            logIscrizioni(
                `[processEnrollRows] OK email=${email} idst=${idst} idcourse=${idcourse} convenzione=${convName || ""}`
            );
        } catch (err) {
            logIscrizioniError("Enroll ERR", err);
            logIscrizioni(
                `[processEnrollRows] KO email=${src?.email || ""} convenzione=${convName || ""} reason=${err.message}`,
                "ERROR"
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
    logIscrizioni(`[processEnrollRows] END ok=${okCount} ko=${koCount} convenzione=${convName || ""}`);

    return results;
}

// ========================= POST /api/iscrizioni/excel =========================
// ✅ NUOVA ROUTE - Import da Excel JSON (frontend manda già parsed)


function normalizeBccList(...values) {
    const seen = new Set();
    const addValue = (value) => {
        if (!value) return;
        (value || "")
            .toString()
            .split(/[;,]/)
            .map(v => v.trim())
            .filter(Boolean)
            .forEach(v => seen.add(v.toLowerCase()));
    };
    values.forEach(addValue);
    return Array.from(seen).join(";");
}

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
        logIscrizioni(`[API:weborders] idordine=${idordine} chkexist=${chkexist} sendmail=${sendmail}`);
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
        let convLookup = ordine.codice_convenzione || ordine.nome_convenzione || "";
        if (webDbName === "rbacademy" && !convLookup) {
            convLookup = "RB Academy";
        }
        let conv = await loadConvenzioneByCodeOrName(convLookup);
        const convNameRaw = (conv?.name || conv?.Name || conv?.Codice || conv?.codice || "").toString().trim().toLowerCase();
        if (webDbName === "rbacademy" && (!convLookup || convNameRaw === "formazione intermediari")) {
            conv = await loadConvenzioneByCodeOrName("RB Academy");
        }

        if (!conv)
            return res.status(400).json({ error: "Convenzione non valida o non trovata" });


        const nomesito = conv.newindirizzoweb || conv.indirizzoweb || "";
        let convName = conv.name || conv.Name || conv.Codice || conv.codice || convLookup || "Senza nome";

        let piattaforma = (conv.piattaforma || conv.Piattaforma || "").toLowerCase();
        if (!piattaforma) {
            piattaforma = FALLBACK_PLATFORMS[webDbName] || "";
        }
        if (webDbName === "rbacademy") {
            const resolved = FALLBACK_PLATFORMS.rbacademy;
            if (resolved) {
                piattaforma = resolved;
            }
            const convNameLower = (convName || "").toLowerCase();
            if (!convName || convNameLower === "formazione intermediari" || convNameLower === "senza nome") {
                convName = ordine.nome_convenzione || "RB Academy";
            }
        }

        if (!piattaforma) {
            return res.status(400).json({ error: "Impossibile determinare la piattaforma target per l'ordine selezionato" });
        }

        // ✅ Ricava utenti/corsi collegati
        const [rows] = await dbWeb.query(
            `SELECT 
                corsista_id,
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
        rows.forEach((row, index) => {
            if (row.id === undefined) {
                row.id = index + 1;
            }
            if (row.corsista_id === undefined) {
                row.corsista_id = row.id;
            }
        });
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

        const billingEmail = (
            ordine.billing_email ||
            ordine.billing_email_address ||
            ordine.email ||
            ""
        ).toString().trim();

        let corsistiRows = rows;
        if (singleCorsistaIds.length) {
            corsistiRows = rows.filter((r) => {
                const key = String(r.corsista_id ?? r.id ?? "");
                return singleCorsistaIds.includes(key);
            });
            if (!corsistiRows.length) {
                return res.status(404).json({ error: "Corsista selezionato non trovato nell'ordine richiesto" });
            }
        }

        // ✅ struttura riga compatibile EXCEL
        const hasConvenzione = Boolean(codiceConv);
        const convMailbcc = hasConvenzione ? (conv?.mailbcc || "") : "";
        const orderMeta = {
            billing_nome: ordine.billing_nome || "",
            billing_cognome: ordine.billing_cognome || "",
            billing_email: ordine.billing_email || "",
            billing_pec: ordine.billing_pec || "",
            billing_cf: ordine.billing_cf || "",
            billing_iva: ordine.billing_iva || "",
            billing_tel: ordine.billing_tel || "",
            billing_codicedestinatario: ordine.billing_codicedestinatario || "",
            billing_indirizzo_1: ordine.billing_indirizzo_1 || "",
            billing_indirizzo_2: ordine.billing_indirizzo_2 || "",
            billing_cap: ordine.billing_cap || "",
            billing_comune: ordine.billing_comune || "",
            billing_provincia: ordine.billing_provincia || "",
            billing_regione: ordine.billing_regione || "",
            metodo_di_pagamento: ordine.metodo_di_pagamento || "",
            codice_convenzione: ordine.codice_convenzione || "",
            nome_convenzione: ordine.nome_convenzione || "",
            data_iscrizione: ordine.data_iscrizione || "",
            data_inizio_corso: ordine.data_inizio_corso || "",
            data_ricevuta_iscrizione: ordine.data_ricevuta_iscrizione || "",
            data_saldo_fattura: ordine.data_saldo_fattura || "",
            data_invio_fattura: ordine.data_invio_fattura || "",
            numero_fattura: ordine.numero_fattura || "",
            oneri: ordine.oneri || "",
            iva_a_debito: ordine.iva_a_debito || "",
            costo_imponibile: ordine.costo_imponibile || "",
            fatturato: ordine.fatturato || "",
        };
        const manualOrderSelections = parsePackageSelectionString(req.body.sceltacorsi);
        const expandedUsers = [];

        for (const row of corsistiRows) {
            const baseEntry = {
                nome: row.nome,
                cognome: row.cognome,
                email: row.email?.toLowerCase(),
                pec: row.pec?.toLowerCase(),
                cf: row.cf?.toUpperCase(),
                telefono: row.telefono || "",
                codecorso: row.codecorso?.trim() || "",
                nomecorso: row.corso?.trim() || "",
                convenzione: convName,
                sede: `${row.sede_esame || ""}${row.wdm_user_custom_data || ""}`,
                order_id: idordine,
                intestazione_fattura: ordine.intestazione_fattura || "",
                corso: row.corso,
                bccEmail: normalizeBccList(billingEmail, convMailbcc),
                orderMeta,
            };

            const packageMeta = detectPackageFromCourseCode(row.codecorso);
            if (!packageMeta) {
                expandedUsers.push(baseEntry);
                continue;
            }

            const manualCandidates = [
                ...manualOrderSelections,
                ...parsePackageSelectionString(row.sceltacorsi),
                ...parsePackageSelectionString(row.scelta_corsi),
                ...parsePackageSelectionString(row.wdm_user_custom_data),
            ].map((code) => code.trim()).filter(Boolean);

            const uniqueManual = [...new Set(manualCandidates)];
            let selection = uniqueManual;
            if (!selection.length) {
                selection = await selectRandomPackageCourseCodes(piattaforma, packageMeta.credits);
            }

            if (!selection.length) {
                logIscrizioni(
                    `[weborders] pacchetto ${packageMeta.packageId} (${packageMeta.credits}h) ordine ${idordine} senza corsi`,
                    "WARN"
                );
                expandedUsers.push(baseEntry);
                continue;
            }

            selection.forEach((chosenCode, index) => {
                expandedUsers.push({
                    ...baseEntry,
                    codecorso: chosenCode,
                    nomecorso: `${baseEntry.nomecorso} (${chosenCode})`,
                    suppressEmail: index > 0,
                    packageInfo: {
                        id: packageMeta.packageId,
                        credits: packageMeta.credits,
                        index: index + 1,
                        total: selection.length,
                    },
                });
            });
        }

        const utenti = expandedUsers;

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
        logIscrizioniError("weborders ERR", err);
        return res.status(500).json({ error: err.message });
    }
});


router.post("/excel", async (req, res) => {
    try {
        const { convenzione, corso, utenti, fatturazione } = req.body;
        logIscrizioni(`DEBUG utenti ricevuti: ${formatLogData(utenti)}`);
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
                logIscrizioni(`FORMATO NON OGGETTO all'indice: ${idx} -> ${formatLogData(u)}`, "WARN");
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
                logIscrizioni(`Dati mancanti all'indice: ${idx} ${formatLogData(u)}`, "WARN");
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

        logIscrizioni(`Excel -> ${convName} ${targetDb} ${utenti.length}`);

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
                logIscrizioni(`Update stato ordine fallito: ${err.message}`, "WARN");
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
        logIscrizioniError("Errore /api/iscrizioni/excel", err);
        return res.status(500).json({ error: err.message });
    }
});
router.get("/sito", async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || "1", 10));
        const requestedLimit = parseInt(req.query.limit || "1000", 10);
        const limit = Math.max(1, Math.min(requestedLimit, 5000));
        const offset = (page - 1) * limit;
        const search = (req.query.search || "").toString().trim();
        const convenzioneFilter = (req.query.convenzione || "").toString().trim();
        const esitoFilter = (req.query.esito || "").toString().trim().toLowerCase();
        const requestedMonth = Number.isFinite(Number(req.query.month)) ? parseInt(req.query.month, 10) : NaN;
        const requestedYear = Number.isFinite(Number(req.query.year)) ? parseInt(req.query.year, 10) : NaN;
        let resolvedMonth = null;
        let resolvedYear = null;
        let monthStart = null;
        let nextMonthStart = null;

        const formatMysqlDate = (date) => {
            const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
                date.getHours(),
            )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
        };

        if (
            Number.isInteger(requestedYear) &&
            requestedYear > 0 &&
            Number.isInteger(requestedMonth) &&
            requestedMonth >= 1 &&
            requestedMonth <= 12
        ) {
            resolvedYear = requestedYear;
            resolvedMonth = requestedMonth;
            const startDate = new Date(resolvedYear, resolvedMonth - 1, 1);
            const endDate = new Date(startDate);
            endDate.setMonth(endDate.getMonth() + 1);
            monthStart = formatMysqlDate(startDate);
            nextMonthStart = formatMysqlDate(endDate);
        }
        const db = await getConnection("newformazione");

        const filters = [];
        const params = [];
        if (search) {
            const like = `%${search}%`;
            filters.push(
                `(order_id LIKE ? OR COALESCE(nome_convenzione,'') LIKE ? OR COALESCE(intestazione_fattura,'') LIKE ? OR COALESCE(billing_email,'') LIKE ? OR EXISTS (
                    SELECT 1
                    FROM wp_woocommerce_rb_corsisti c
                    WHERE c.order_id = wp_woocommerce_rb_ordini.order_id
                      AND (
                        COALESCE(c.corsista_first_name,'') LIKE ?
                        OR COALESCE(c.corsista_last_name,'') LIKE ?
                        OR CONCAT_WS(' ', c.corsista_first_name, c.corsista_last_name) LIKE ?
                        OR CONCAT_WS(' ', c.corsista_last_name, c.corsista_first_name) LIKE ?
                      )
                ))`,
            );
            params.push(like, like, like, like, like, like, like, like);
        }
        if (convenzioneFilter) {
            filters.push("nome_convenzione = ?");
            params.push(convenzioneFilter);
        }
        if (esitoFilter) {
            filters.push("LOWER(order_status) = ?");
            params.push(esitoFilter);
        }
        if (monthStart && nextMonthStart) {
            filters.push("date_ins >= ? AND date_ins < ?");
            params.push(monthStart, nextMonthStart);
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

        res.json({
            rows,
            total,
            period:
                resolvedMonth && resolvedYear
                    ? { month: resolvedMonth, year: resolvedYear }
                    : null,
            page,
            limit,
            hasMore: offset + rows.length < total,
        });
    } catch (err) {
        logIscrizioniError("Errore /iscrizioni/sito", err);
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
        logIscrizioniError("Errore /iscrizioni/sito", err);
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
        logIscrizioniError("Errore /iscrizioni/sito", err);
        res.status(500).json({ error: err.message });
    }
});



// 📦 Ottiene corsisti legati a un ordine specifico
// PATCH /api/iscrizioni/ordini/:order_id
router.patch("/ordini/:order_id", async (req, res) => {
    try {
        const { order_id } = req.params;
        const dbName = (req.query.db || "newformazione").toString();
        const db = await getConnection(dbName);
        const allowedFields = [
            "intestazione_fattura",
            "billing_email",
            "billing_pec",
            "billing_cf",
            "billing_codicedestinatario",
            "billing_iva",
            "billing_indirizzo_1",
            "billing_cap",
            "billing_comune",
            "billing_provincia",
            "metodo_di_pagamento",
            "order_status",
            "interrompi",
        ];
        const updates = [];
        const values = [];
        for (const field of allowedFields) {
            if (Object.prototype.hasOwnProperty.call(req.body, field)) {
                updates.push(`${field}=?`);
                values.push(req.body[field]);
            }
        }
        if (!updates.length) {
            return res.status(400).json({ error: "Nessun campo modificabile fornito" });
        }
        await db.query(
            `UPDATE wp_woocommerce_rb_ordini SET ${updates.join(", ")} WHERE order_id=?`,
            [...values, order_id]
        );
        return res.json({ success: true });
    } catch (err) {
        logIscrizioniError("Errore /ordini/:order_id PATCH", err);
        return res.status(500).json({ error: err.message });
    }
});

// DELETE /api/iscrizioni/ordini/:order_id
router.delete("/ordini/:order_id", async (req, res) => {
    try {
        const { order_id } = req.params;
        const dbName = (req.query.db || "newformazione").toString();
        const db = await getConnection(dbName);

        await db.query(
            "DELETE FROM wp_woocommerce_rb_corsisti WHERE order_id = ?",
            [order_id],
        );
        const [{ affectedRows }] = await db.query(
            "DELETE FROM wp_woocommerce_rb_ordini WHERE order_id = ?",
            [order_id],
        );

        if (!affectedRows) {
            return res.status(404).json({ error: "Ordine non trovato" });
        }

        return res.json({ success: true });
    } catch (err) {
        logIscrizioniError("Errore /ordini/:order_id DELETE", err);
        return res.status(500).json({ error: err.message });
    }
});

router.post("/ordini/:order_id/sync-billing-fields", async (req, res) => {
    try {
        const { order_id } = req.params;
        const webDbName = (req.query.db || "newformazione").toString().trim().toLowerCase();
        const dbWeb = await getConnection(webDbName);

        const [[ordine]] = await dbWeb.query(
            "SELECT * FROM wp_woocommerce_rb_ordini WHERE order_id=?",
            [order_id]
        );
        if (!ordine) return res.status(404).json({ error: "Ordine non trovato" });

        const convenzioneLookup = ordine.codice_convenzione || ordine.nome_convenzione || "";
        const conv = await loadConvenzioneByCodeOrName(convenzioneLookup);
        let piattaforma = (conv?.piattaforma || conv?.Piattaforma || "").toString().trim().toLowerCase();
        if (!piattaforma) {
            piattaforma = FALLBACK_PLATFORMS[webDbName] || "";
        }
        if (webDbName === "rbacademy" && piattaforma === "formazionecondorb") {
            const resolved = FALLBACK_PLATFORMS.rbacademy;
            if (resolved && resolved !== piattaforma) {
                piattaforma = resolved;
            }
        }
        if (!piattaforma) {
            return res.status(400).json({ error: "Impossibile determinare la piattaforma di destinazione" });
        }

        const targetConn = await getConnection(piattaforma);
        const [corsisti] = await dbWeb.query(
            `SELECT corsista_first_name AS nome,
                    corsista_last_name AS cognome,
                    corsista_email AS email,
                    corsista_cf AS cf
             FROM wp_woocommerce_rb_corsisti
             WHERE order_id = ?
             ORDER BY corsista_last_name ASC`,
            [order_id]
        );

        if (!corsisti.length) {
            return res.json({
                success: true,
                summary: { updated: 0, missing: [], errors: [] },
                message: "Nessun corsista associato all'ordine",
            });
        }

        const detailValues = {};
        for (const [orderField, detailKeys] of Object.entries(BILLING_FIELD_MAP)) {
            const raw = ordine[orderField];
            const cleaned = raw !== undefined && raw !== null ? String(raw).trim() : "";
            if (!cleaned) continue;
            detailKeys.forEach((key) => {
                if (!CAMPI_SUPPLEMENTARI[key]) return;
                detailValues[key] = cleaned;
            });
        }

        if (!Object.keys(detailValues).length) {
            return res.status(400).json({ error: "Nessun dato di fatturazione valido per la sincronizzazione" });
        }

        const convenzioneName =
            ordine.nome_convenzione ||
            ordine.codice_convenzione ||
            conv?.name ||
            "";

        const summary = { updated: 0, missing: [], errors: [] };

        for (const row of corsisti) {
            try {
                const found = await GetIfUserExist(
                    row.nome,
                    row.cognome,
                    row.cf,
                    row.email,
                    targetConn,
                    convenzioneName
                );
                if (!found || !found.length) {
                    summary.missing.push({
                        nome: row.nome,
                        cognome: row.cognome,
                        email: row.email,
                        cf: row.cf,
                    });
                    continue;
                }

                const idst = found[0].idst;
                for (const [detailKey, value] of Object.entries(detailValues)) {
                    const fieldId = CAMPI_SUPPLEMENTARI[detailKey];
                    if (!fieldId) continue;
                    await adddetails(fieldId, idst, value, targetConn);
                }
                summary.updated++;
            } catch (err) {
                summary.errors.push({
                    nome: row.nome,
                    cognome: row.cognome,
                    email: row.email,
                    message: err?.message || "Errore sconosciuto",
                });
            }
        }

        return res.json({
            success: true,
            summary,
            message: `Aggiornati ${summary.updated} utenti`,
        });
    } catch (err) {
        logIscrizioniError("Errore sincronizzazione campi fatturazione", err);
        res.status(500).json({ error: err.message });
    }
});

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
        logIscrizioniError("Errore /ordini/:order_id/corsisti", err);
        res.status(500).json({ error: err.message });
    }
});


function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
}

function normalizeCf(cf) {
    return String(cf || "").trim().toUpperCase();
}

function isValidCf(cf) {
    return /^[A-Z0-9]{16}$/.test(cf || "");
}

async function lookupCorsistaCf(conn, entry) {
    const emailKey = normalizeEmail(entry.email);
    const firstName = normalizeName(entry.nome);
    const lastName = normalizeName(entry.cognome);
    if (!emailKey || !firstName || !lastName) return "";

    const [rows] = await conn.query(
        `
        SELECT corsista_cf
        FROM wp_woocommerce_rb_corsisti
        WHERE LOWER(TRIM(corsista_email)) = ?
          AND LOWER(TRIM(corsista_first_name)) = ?
          AND LOWER(TRIM(corsista_last_name)) = ?
        ORDER BY corsista_id DESC
        LIMIT 1
        `,
        [emailKey, firstName, lastName]
    );
    if (!rows.length) return "";
    return normalizeCf(rows[0].corsista_cf);
}


router.patch("/corsisti/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const dbName = (req.query.db || "newformazione").toString();
        const db = await getConnection(dbName);
        const allowedFields = [
            "corsista_first_name",
            "corsista_last_name",
            "corsista_email",
            "corsista_pec",
            "corsista_cf",
            "codice_corso",
            "corso_title",
        ];
        const updates = [];
        const values = [];
        for (const field of allowedFields) {
            if (Object.prototype.hasOwnProperty.call(req.body, field)) {
                updates.push(`${field}=?`);
                values.push(req.body[field]);
            }
        }
        if (!updates.length) {
            return res.status(400).json({ error: "Nessun campo modificabile fornito" });
        }
        await db.query(
            `UPDATE wp_woocommerce_rb_corsisti SET ${updates.join(", ")} WHERE corsista_id=?`,
            [...values, id]
        );
        return res.json({ success: true });
    } catch (err) {
        logIscrizioniError("Errore /corsisti/:id PATCH", err);
        return res.status(500).json({ error: err.message });
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
        logIscrizioniError("reinvia ordine", err);
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
        logIscrizioniError("segnala ordine", err);
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
        logIscrizioniError("convenzioni", err);
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
        logIscrizioniError("corsi convenzione", err);
        res.status(500).json({ error: err.message });
    }
});




module.exports = router;
