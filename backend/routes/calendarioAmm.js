// backend/routes/calendarioAmm.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const { getConnection } = require("../dbManager");
const { getMailFormat, getBCC, piedinodidattica, toMySQLDateTime } = require("../utils/helper");
const { invioMail } = require("../utils/mailerBrevo");

// ✅ Mappatura corso AMM → Test
function mapAmmCourseToTest(idcourse) {
    switch (idcourse) {
        case 29: return 283; // Agg33
        case 18: return 196; // Agg31
        case 31: return 314; // Agg34
        case 33: return 357; // Agg35
        case 35: return 334; // Agg36
        case 9:
        default: return 197; // Prima formazione
    }
}

// ✅ Lista corsi AMM da gestire
const CORSI_AMM = [9, 18, 29, 31, 33, 35];

/**
 * ✅ 1️⃣ Elenco corsisti Fine Corso AMM
 */
router.get("/", async (req, res) => {
    try {
        const conn = await getConnection("SITE", "formazionecondorb");

        const sql = `
        SELECT DISTINCT(CONCAT(a.iduser,a.idcourse)) AS id,
               b.firstname, b.lastname,
               e.on_date,
               e.note, e.evaso, e.flagevent,
               c.user_entry AS convenzione,
               d.code,
               a.iduser, a.idcourse,
               a.date_inscr,
               (SELECT DISTINCT(iduser)
                  FROM rbamministratore.prenotazioni
                 WHERE iduser=a.iduser) AS aggiunto
        FROM learning_courseuser a
        JOIN core_user b ON b.idst=a.iduser
        LEFT JOIN core_field_userentry c ON c.id_user=b.idst AND c.id_common=25
        JOIN learning_course d ON d.idcourse=a.idcourse
        LEFT JOIN learning_certificate_assign e ON e.id_user=a.iduser
        WHERE a.status=2
        AND a.idcourse IN (${CORSI_AMM})
        ORDER BY e.on_date DESC`;

        const [rows] = await conn.query(sql);
        res.json(rows);

    } catch (err) {
        console.error("GET FineCorsoAmm ERR:", err.message);
        res.status(500).json({ error: "Errore elenco corsisti" });
    }
});

/**
 * ✅ 2️⃣ Calendario eventi FullCalendar
 */
router.get("/calendario", async (req, res) => {
    try {
        const conn = await getConnection("SITE", "rbamministratore");
        const [rows] = await conn.query(`
        SELECT s.id, s.dataesame, s.dataprova, s.flagconferma,
               p.iduser, p.idcourse,
               a.nome AS nome_utente, a.cognome AS cognome_utente,
               l.flagevent
        FROM sessioni s
        LEFT JOIN prenotazioni p ON p.idsessione=s.id
        LEFT JOIN anagrafiche a ON a.id=p.iduser
        LEFT JOIN formazionecondorb.learning_certificate_assign l
               ON l.id_user=p.iduser AND l.id_course=p.idcourse
        ORDER BY s.dataesame DESC`);

        const events = rows.map(r => ({
            id: r.id,
            title: `${r.cognome_utente} ${r.nome_utente || ""}`,
            start: r.dataesame,
            backgroundColor:
                r.flagevent === 1 ? "#008000" : // confermata
                    r.flagevent === 2 ? "#303030" : // non confermata
                        r.flagevent === 3 ? "#FF0000" : // bocciato
                            r.flagevent === 4 ? "#FF69B4" : // buon fine si
                                "#90EE90", // proposta

            extendedProps: {
                iduser: r.iduser,
                idcourse: r.idcourse,
                dataprova: r.dataprova,
                flagevent: r.flagevent
            }
        }));

        res.json(events);

    } catch (err) {
        console.error("GET calendarioAmm ERR:", err);
        res.status(500).json({ error: "Errore calendario" });
    }
});

/**
 * ✅ 3️⃣ Dati per ModalePrenotati
 */
router.get("/sessione/:idsessione/dettaglio", async (req, res) => {
    const { idsessione } = req.params;

    try {
        const conn = await getConnection("SITE", "rbamministratore");

        const [rows] = await conn.query(`
        SELECT s.*, p.idcourse, p.iduser, 
               a.nome AS nome_utente, a.cognome AS cognome_utente, a.email AS email_utente,
               a.codicefiscale AS cf_utente, a.telefono AS telefono_utente
        FROM sessioni s
        LEFT JOIN prenotazioni p ON p.idsessione=s.id
        LEFT JOIN anagrafiche a ON a.id=p.iduser
        WHERE s.id=?`,
            [idsessione]
        );

        if (!rows.length) return res.status(404).json({ error: "Non trovata" });
        res.json(rows[0]);

    } catch (err) {
        console.error("ERR dettaglio modale:", err.message);
        res.status(500).json({ error: "Errore nel dettaglio" });
    }
});

/**
 * ✅ 4️⃣ Conferma sessione + email conferma
 */
router.post("/sessione/:idsessione/conferma", async (req, res) => {
    const { idsessione } = req.params;
    const { iduser, idcourse } = req.body;

    try {
        const conn = await getConnection("SITE", "rbamministratore");
        const connCorsi = await getConnection("SITE", "formazionecondorb");

        await conn.query(`UPDATE sessioni SET flagconferma=1 WHERE id=?`, [idsessione]);

        await conn.query(`
        DELETE FROM sessioni WHERE idparent=? OR id=? AND idparent IS NOT NULL
        `, [idsessione, idsessione]);

        await connCorsi.query(`
        UPDATE learning_certificate_assign SET flagevent=1 
        WHERE id_user=? AND id_course=?`,
            [iduser, idcourse]
        );

        await InviaComunicaConferma(iduser, idsessione);

        res.json({ success: true });

    } catch (err) {
        console.error("ERR conferma:", err.message);
        res.status(500).json({ error: "Errore conferma sessione" });
    }
});

/**
 * ✅ 5️⃣ Invia Test
 */
router.post("/sessione/:idsessione/invia-test", async (req, res) => {
    const { idsessione } = req.params;
    try {
        const conn = await getConnection("SITE", "rbamministratore");
        const [r] = await conn.query(
            `SELECT iduser,idcourse FROM prenotazioni WHERE idsessione=? LIMIT 1`,
            [idsessione]
        );

        if (!r.length) return res.status(404).json({ error: "Prenotazione mancante" });

        const iduser = r[0].iduser;
        const idcourse = mapAmmCourseToTest(r[0].idcourse);

        await iscriviACorsoByIdUser(iduser, idcourse);

        res.json({ success: true, message: "Test attivato ✅" });

    } catch (err) {
        console.error("ERR invia test:", err.message);
        res.status(500).json({ error: "Errore" });
    }
});

/**
 * ✅ 6️⃣ Sblocca Test
 */
router.post("/sessione/:idsessione/sblocca-test", async (req, res) => {
    const { idsessione } = req.params;

    try {
        const conn = await getConnection("SITE", "rbamministratore");
        const connCorsi = await getConnection("SITE", "formazionecondorb");

        const [r] = await conn.query(
            `SELECT iduser,idcourse FROM prenotazioni WHERE idsessione=? LIMIT 1`,
            [idsessione]
        );

        if (!r.length) return res.status(404).json({ error: "Prenotazione mancante" });

        const iduser = r[0].iduser;
        const idtest = mapAmmCourseToTest(r[0].idcourse);

        await connCorsi.query(
            `UPDATE learning_Testtrack 
             SET checktest=0 
             WHERE iduser=? AND idtest=?`,
            [iduser, idtest]
        );

        res.json({ success: true, message: "Test sbloccato ✅" });

    } catch (err) {
        console.error("ERR sblocca test:", err.message);
        res.status(500).json({ error: "Errore" });
    }
});

/**
 * ✅ Funzione Email Conferma con ICS
 */
async function InviaComunicaConferma(iduser, idsessione) {
    try {
        const conn = await getConnection("SITE", "rbamministratore");

        const [rows] = await conn.query(`
        SELECT a.email,a.nome,a.cognome, s.dataesame,s.dataprova
        FROM anagrafiche a
        JOIN prenotazioni p ON a.id=p.iduser
        JOIN sessioni s ON p.idsessione=s.id
        WHERE p.iduser=? AND p.idsessione=?`,
            [iduser, idsessione]
        );

        if (!rows.length) return;
        const r = rows[0];

        let body = await getMailFormat("mailformatammconferma2");
        body = body.replace("[NOME]", r.nome)
            .replace("[COGNOME]", r.cognome)
            .replace("[DATAESAME]", new Date(r.dataesame).toLocaleString("it-IT"))
            .replace("[DATAPROVA]", new Date(r.dataprova).toLocaleString("it-IT"));

        body += "<br>" + piedinodidattica;

        const bcc = await getBCC(iduser);

        const dir = path.join(process.cwd(), "public/temp");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const filePath = path.join(dir, `sessione_${iduser}.ics`);
        fs.writeFileSync(filePath, "");

        await invioMail({
            to: r.email,
            from: "info@rb-academy.it",
            subject: "Test Finale AMM: Conferma Date",
            html: body,
            bcc,
            attachments: [filePath]
        });

        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    } catch (err) {
        console.error("ERR Email conferma:", err.message);
    }
}

async function iscriviACorsoByIdUser(iduser, idcorso) {
    const conn = await getConnection("SITE", "formazionecondorb");
    const now = new Date();
    const date_inscr = toMySQLDateTime(now);
    const date_end = toMySQLDateTime(new Date(now.getTime() + 365 * 86400000));

    await conn.query(`
    INSERT INTO learning_courseuser
    (idUser,idCourse,level,date_inscr,waiting,imported_from_connection,
     absent,cancelled_by,new_forum_post,date_begin_validity,date_expire_validity)
    VALUES (?,?,3,?,0,1039,0,0,0,?,?)
    ON DUPLICATE KEY UPDATE date_expire_validity=?`,
        [iduser, idcorso, date_inscr, date_inscr, date_end, date_end]
    );
}

module.exports = router;