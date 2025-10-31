const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const { getConnection } = require("../dbManager");
const {
    attestatoIvass,
    attestatoIvassTest,
    attestatoServiziDiPagamento,
    attestatoGenerico,
} = require("../utils/attestati");
const { logwrite, gettime, getLastTest } = require("../utils/helper");

const BACKEND_URL = process.env.BACKEND_URL || "https://rbcms.formazioneintermediari.com";

const axios = require("axios");
const { SaveAndSend, getBCC } = require("../utils/helper");

const CERT_PATH = path.join(process.cwd(), "backend/public/certificati");

/**
 * 🔹 Replica della funzione VB.NET sendcertificate
 * Genera e invia attestato + test + report
 */
router.post("/sendcertificate", async (req, res) => {
    const { iduser, idcorso, webdb, host } = req.body;
    if (!iduser || !idcorso || !webdb) {
        return res.status(400).json({ error: "Parametri mancanti" });
    }

    try {
        const conn = await getConnection(host, webdb);

        // 1️⃣ Recupero dati base utente/corso
        const [rows] = await conn.query(`
            SELECT a.firstname, a.lastname, a.userid, a.email, 
                   c.name AS nomecorso, c.code, 
                   (SELECT user_entry FROM core_field_userentry WHERE id_common=25 AND id_user=a.idst) AS convenzione
            FROM core_user a
            JOIN learning_courseuser b ON a.idst=b.iduser
            JOIN learning_course c ON b.idcourse=c.idcourse
            WHERE a.idst=? AND b.idcourse=?
            LIMIT 1
        `, [iduser, idcorso]);

        if (!rows.length) throw new Error("Utente o corso non trovato");
        const u = rows[0];
        let convenzione = u.convenzione || "";
        if (webdb === "efadnovastudia" && convenzione !== "") convenzione = "NOVASTUDIA";

        const nominativo = `${u.firstname} ${u.lastname}`;
        const baseUrl = process.env.BACKEND_URL || "https://rbcms.formazioneintermediari.com";

        // 2️⃣ Verifica evaso
        const [evasoRows] = await conn.query(
            "SELECT evaso2 FROM learning_certificate_assign WHERE id_user=? AND id_course=?",
            [iduser, idcorso]
        );
        if (evasoRows.length && evasoRows[0].evaso2) {
            await logwrite(`⚠️ Già evaso user=${iduser}, corso=${idcorso}`);
            return res.json({ success: false, message: "Attestato già inviato" });
        }

        // 3️⃣ Generazione attestato principale
        const attestatoUrl = await generaAttestato({ iduser, idcorso, webdb });
        let files = [attestatoUrl];

        // 4️⃣ Generazione report (gettime)
        try {
            const r1 = await gettime(idcorso, iduser, u.firstname, u.lastname, webdb, true, "", null);
            if (r1.data?.filepath) files.push(r1.data.filepath);
        } catch (e) {
            await logwrite(`gettime ERR: ${e.message}`);
        }

        // 5️⃣ Generazione test finale (getlasttest)
        try {
            const r2 = await getLastTest(idcorso, iduser, u.firstname, u.lastname, webdb, true, "", null);
            if (r2.data?.filepath) files.push(r2.data.filepath);
        } catch (e) {
            await logwrite(`getlasttest ERR: ${e.message}`);
        }

        // 6️⃣ Aggiorna learning_certificate_assign
        await conn.query(`
            UPDATE learning_certificate_assign
            SET pathattestato=?, evaso2=1, data_invio=NOW()
            WHERE id_user=? AND id_course=?
        `, [attestatoUrl, iduser, idcorso]);

        // 7️⃣ Aggiorna stato corso
        await conn.query(`
            UPDATE learning_courseuser
            SET status=3, data_invio=NOW()
            WHERE iduser=? AND idcourse=?
        `, [iduser, idcorso]);

        // 8️⃣ Recupera BCC e invia attestato
        const bcc = await getBCC(iduser);
        const result = await SaveAndSend({
            idcourse: idcorso,
            nominativo,
            email: u.email,
            pec: "",
            file: files.join(";"),
            convenzione,
            nomecorso: u.nomecorso,
            bcc,
            format: "attestato"
        });

        await logwrite(`✅ sendcertificate: Attestato inviato a ${u.email} (${result.esito || "OK"})`);
        res.json({
            success: true,
            message: "Attestato e documenti inviati correttamente",
            files,
            result
        });
    } catch (err) {
        await logwrite("❌ sendcertificate ERR: " + err);
        res.status(500).json({ error: err.message });
    }
});

// 📂 Percorso assoluto della cartella certificati

if (!fs.existsSync(CERT_PATH)) {
    fs.mkdirSync(CERT_PATH, { recursive: true });
    console.log("📁 Creata cartella certificati:", CERT_PATH);
}

/**
 * Funzione core per generare attestato
 */
async function generaAttestato({ iduser, idcorso, webdb }) {
    console.log(iduser, idcorso, webdb, host);

    const conn = await getConnection(host, webdb);

    const [rows] = await conn.query(`
    SELECT 
      a.firstname,
      a.lastname,
      a.userid,
      b.date_complete,
      c.description,
      c.code,
      (SELECT user_entry FROM core_field_userentry WHERE id_common=23 AND id_user=a.idst) AS cf,
      (SELECT user_entry FROM core_field_userentry WHERE id_common=25 AND id_user=a.idst) AS convenzione
    FROM core_user a
    JOIN learning_courseuser b ON a.idst=b.iduser
    JOIN learning_course c ON b.idcourse=c.idcourse
    WHERE a.idst=? AND b.idcourse=?
    LIMIT 1
  `, [iduser, idcorso]);

    if (!rows.length) throw new Error("Utente o corso non trovato");

    const r = rows[0];
    const nome = r.firstname;
    const cognome = r.lastname;
    const username = r.userid;
    const datecomplete = r.date_complete;
    const descrizione = r.description;
    const code = r.code;
    const cf = r.cf;
    const convenzione = r.convenzione || "";
    const corso = code;
    const hostUrl = BACKEND_URL;

    let f = "";
    let voto = "";
    let indirizzotest = "";
    let delegato = "";

    // Logica identica al VB.NET
    if (
        [
            "214", "223", "234", "279", "286", "373", "407", "360",
            "378", "408", "428", "429", "4", "73", "74", "85", "86"
        ].includes(idcorso)
    ) {
        // IVASS / IVASS TEST
        const idTests = {
            73: 969, 74: 969, 85: 1372, 86: 1372,
            360: 3218, 378: 3530, 408: webdb === "efadnovastudia" ? 4255 : 3983,
            429: 4365, 4: 241, 79: 1253,
        };
        const idtest = idTests[idcorso] || null;

        if (idtest) {
            const [testRows] = await conn.query(
                "SELECT score FROM learning_testtrack WHERE iduser=? AND idtest=?",
                [iduser, idtest]
            );
            voto = testRows?.[0]?.score?.toString() || "";
        }

        // IVASS TEST o IVASS base
        if (["73", "74", "85", "86", "360", "378", "408", "429"].includes(idcorso)) {
            f = await attestatoIvassTest({
                conn,
                db: webdb,
                iduser,
                idcorso,
                nome,
                cognome,
                username,
                date_complete: datecomplete,
                voto,
                indirizzotest,
                delegato,
                cf,
                tipocorso: code,
                convenzione,
                corso,
                hostUrl,
            });
        } else {
            f = await attestatoIvass({
                conn,
                db: webdb,
                iduser,
                idcorso,
                nome,
                cognome,
                username,
                date_complete: datecomplete,
                voto,
                indirizzotest,
                delegato,
                cf,
                tipocorso: code,
                convenzione,
                corso,
                hostUrl,
            });
        }

    } else if (["147", "278", "299", "414", "415", "17"].includes(idcorso)) {
        // SERVIZI DI PAGAMENTO
        const idTests = { 299: 2831, 415: 4092, 17: 796 };
        const idtest = idTests[idcorso] || null;
        if (idtest) {
            const [testRows] = await conn.query(
                "SELECT score FROM learning_testtrack WHERE iduser=? AND idtest=?",
                [iduser, idtest]
            );
            voto = testRows?.[0]?.score?.toString() || "";
        }

        f = await attestatoServiziDiPagamento({
            conn,
            iduser,
            nome,
            cognome,
            username,
            date_complete: datecomplete,
            voto,
            cf,
            tipocorso: code,
            convenzione,
            corso,
            hostUrl,
        });

    } else {
        // GENERICO
        const [votoRows] = await conn.query(`
      SELECT score FROM learning_testtrack WHERE iduser=? 
      AND idtest IN (SELECT idresource FROM learning_organization WHERE isterminator=1 AND idcourse=?)
    `, [iduser, idcorso]);
        voto = votoRows?.[0]?.score?.toString() || "";

        f = await attestatoGenerico({
            conn,
            iduser,
            nome,
            cognome,
            cf,
            code,
            descrizione,
            voto,
            date_complete: datecomplete,
            convenzione,
            corso,
            hostUrl,
        });
    }

    // Verifica file PDF generato
    const filename = path.basename(f);
    const filePath = path.join(CERT_PATH, filename);
    if (!fs.existsSync(filePath)) {
        logwrite(`⚠️ Attenzione: file non trovato ${filePath}`);
        throw new Error("Errore nella generazione del file PDF");
    }

    // Salvataggio record in learning_attestati
    try {
        await conn.query(
            `INSERT INTO learning_attestati (idcourse, iduser, voto, date_complete, date_invio, code, corso)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [idcorso, iduser, voto, new Date(), new Date(), code, corso]
        );
    } catch (err) {
        logwrite("⚠️ Errore salvataggio learning_attestati: " + err.message);
    }

    return `${BACKEND_URL}/backend/public/certificati/${filename}`;
}

/**
 * 🔹 GET compatibile (vecchio stile)
 */
router.get("/getcertificate", async (req, res) => {
    const { iduser, idcorso, webdb } = req.query;
    try {
        const url = await generaAttestato({ iduser, idcorso, webdb });
        res.json({ success: true, file: url });
    } catch (err) {
        logwrite("❌ Errore getcertificate: " + err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 🔹 POST moderno (per React / Axios)
 * Body JSON: { iduser, idcorso, webdb }
 */
router.post("/generate", async (req, res) => {
    const { iduser, idcorso, webdb } = req.body;
    if (!iduser || !idcorso || !webdb) {
        return res.status(400).json({ error: "Parametri mancanti" });
    }

    try {
        const url = await generaAttestato({ iduser, idcorso, webdb });
        res.json({
            success: true,
            message: "Attestato generato correttamente",
            file: url,
        });
    } catch (err) {
        logwrite("❌ Errore generate attestato: " + err.message);
        res.status(500).json({ error: "Errore generazione attestato" });
    }
});


/**
 * ✅ Replica della funzione VB getvoto in Node.js
 * 
 * @param {object} conn - connessione MySQL
 * @param {number|string} iduser
 * @param {number|string} idcorso
 * @returns {Promise<string>}
 */



module.exports = router;



// ------------------------------
// Util: sede legale come in VB
// ------------------------------
function changeSede(datep) {
    try {
        const d = new Date(datep);
        if (d > new Date("2016-04-10")) return "Via Crescenzio, 25 - 00193 Roma (RM)";
        if (d < new Date("2013-04-01") || d >= new Date("2014-07-01"))
            return "Viale Carmelo Bene, 335 - 00139 Roma (RM)";
        return "Piazza Benedetto Cairoli, 2 - 00186 Roma (RM)";
    } catch {
        return "Via Crescenzio, 25 - 00193 Roma (RM)";
    }
}






module.exports = router;