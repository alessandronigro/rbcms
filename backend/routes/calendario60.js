// backend/routes/calendario60.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const { getConnection } = require("../dbManager");
const { getMailFormat } = require("../utils/helper");
const { invioMail } = require("../utils/mailerBrevo");
const { toMySQLDateTime } = require("../utils/helper.js");
const { piedinodidattica, getBCC } = require("../utils/helper.js");
// ============================================================
//   FINE CORSO 60H - ROUTES
// ============================================================

/**
 * 1️⃣  GET /api/finecorso60h
 *     → Restituisce elenco corsisti con stato e date
 */
router.get("/", async (req, res) => {
    try {
        const conn = await getConnection("IFAD", "forma4");

        const sql = `
      SELECT DISTINCT(CONCAT(a.iduser, a.idcourse)) AS id,
             b.firstname,
             b.lastname,
             e.on_date,
             e.flagevent,
             e.note,
             c.user_entry AS convenzione,
             d.code,
             a.date_inscr,
             e.on_date,
             e.evaso,
             e.data_invio,
             e.id_user,
             e.id_course,
             (SELECT DISTINCT(iduser)
                FROM rb60h.prenotazioni
               WHERE iduser = a.iduser) AS aggiunto
        FROM (((learning_courseuser a
        JOIN core_user b ON b.idst = a.iduser)
        LEFT JOIN core_field_userentry c ON c.id_user = b.idst)
        LEFT JOIN learning_course d ON d.idcourse = a.idcourse)
        LEFT JOIN learning_certificate_assign e ON a.iduser = e.id_user
       WHERE e.flagevent != 3
         AND a.status = 2
         AND c.id_common = 25
         AND c.user_entry NOT IN (
              SELECT name FROM wpacquisti.newconvenzioni WHERE test60 != 0
          )
         AND e.id_course IN (73, 85)
         AND a.idcourse IN (73, 85)
         AND e.id_user NOT IN (15345, 11941)
       ORDER BY e.on_date DESC
    `;

        const [rows] = await conn.query(sql);
        res.json(rows);
    } catch (err) {
        console.error("❌ Errore GET /finecorso60h:", err.message);
        res.status(500).json({ error: "Errore nel caricamento elenco" });
    }
});

/**
 * 2️⃣  GET /api/finecorso60h/calendario
 *     → Eventi per FullCalendar
 */
router.get("/calendario", async (req, res) => {
    try {
        const conn = await getConnection("IFAD", "rb60h");

        const [rows] = await conn.query(`
        SELECT s.id, s.dataesame, s.dataprova, s.flagconferma,
               p.iduser, p.idcourse,
               a.nome AS nome_utente, a.cognome AS cognome_utente,
               l.flagevent
        FROM sessioni s
        LEFT JOIN prenotazioni p ON s.id = p.idsessione
        LEFT JOIN anagrafiche a ON p.iduser = a.id
        LEFT JOIN forma4.learning_certificate_assign l
               ON l.id_user = p.iduser AND l.id_course = p.idcourse
        ORDER BY s.dataesame DESC`);

        const events = rows.map(r => {
            let bg = "#90EE90"; // default proposta

            switch (r.flagevent) {
                case 1: bg = "#008000"; break; // Verde scuro → confermata
                case 2: bg = "#303030"; break; // Grigio scuro → non confermata
                case 3: bg = "#FF0000"; break; // Rosso → bocciato
                case 4: bg = "#FF69B4"; break; // Rosa → Buon fine SI
            }

            return {
                id: r.id,
                title: `${r.cognome_utente} ${r.nome_utente || ""}`,
                start: r.dataesame,
                backgroundColor: bg,
                extendedProps: {
                    flagevent: r.flagevent,
                    iduser: r.iduser,
                    idcourse: r.idcourse,
                    dataprova: r.dataprova
                }
            };
        });

        res.json(events);

    } catch (err) {
        console.error("❌ Errore calendario:", err);
        res.status(500).json({ error: "Errore caricamento calendario" });
    }
});


/**
 * 3️⃣  GET /api/finecorso60h/sessione/:idsessione/dettaglio
 *     → Dati completi per modale
 */
router.get("/sessione/:idsessione/dettaglio", async (req, res) => {
    const { idsessione } = req.params;
    try {
        const conn = await getConnection("IFAD", "rb60h");
        const [rows] = await conn.query(
            `
      SELECT 
        s.*,
        p.id AS idprenotazione,
        p.iduser,
        p.idcourse,
        p.db,
        a.nome AS nome_utente,
        a.cognome AS cognome_utente,
        a.email AS email_utente,
        a.codicefiscale AS cf_utente,
        a.telefono AS telefono_utente,
        st.nome AS nome_studio,
        st.cognome AS cognome_studio,
        st.tipologia AS tipologia_studio
      FROM sessioni s
      LEFT JOIN prenotazioni p ON p.idsessione = s.id
      LEFT JOIN anagrafiche a ON a.id = p.iduser
      LEFT JOIN studi st ON st.id = s.idstudio
      WHERE s.id = ?
    `,
            [idsessione]
        );

        if (!rows.length) return res.status(404).json({ error: "Sessione non trovata" });
        res.json(rows[0]);
    } catch (err) {
        console.error("❌ Errore dettaglio sessione:", err);
        res.status(500).json({ error: "Errore caricamento dettaglio sessione" });
    }
});

/**
 * 4️⃣  POST /api/finecorso60h/sessione
 *     → Crea le due proposte: TEST2 (principale) + TEST (alternativa)
 *        e inserisce prenotazioni. flagevent=0 su learning_certificate_assign
 */
router.post("/sessione", async (req, res) => {
    const { iduser, idcourse, dataprova, dataesame, ckmail, note, convenzione } = req.body;

    if (!iduser || !idcourse || !dataprova || !dataesame) {
        return res.status(400).json({ error: "Parametri mancanti" });
    }

    try {
        const conn60 = await getConnection("IFAD", "rb60h");
        const connForma = await getConnection("IFAD", "forma4");

        // se esiste già una proposta per l'utente evito duplicati
        const [exists] = await conn60.query(
            "SELECT idsessione FROM prenotazioni WHERE iduser=? LIMIT 1",
            [iduser]
        );
        if (exists.length) {
            return res.json({ success: true, message: "Proposta già esistente", idsessione: exists[0].idsessione });
        }

        const dProva = (dataprova || "").replace("T", " ") + ":00";
        const dEsame = (dataesame || "").replace("T", " ") + ":00";
        const dNow = new Date().toISOString().slice(0, 19).replace("T", " ");
        const idstudio = 1;
        const maxposti = 1;

        // TEST2
        const [res1] = await conn60.query(
            `
      INSERT INTO sessioni
      (maxposti, Postidisponibili, dataesame, dataprova, nomesessione, domicilio, note, visible, attivo, idstudio, indirizzosessione, datainvio)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, '', ?)
      `,
            [maxposti, maxposti, dEsame, dProva, `TEST2 - ${convenzione || ""}`, "", note || "", idstudio, dNow]
        );
        const idsessione1 = res1.insertId;

        await conn60.query(
            `INSERT INTO prenotazioni (idsessione, iduser, idcourse, db) VALUES (?,?,?,?)`,
            [idsessione1, iduser, idcourse, "forma4"]
        );

        // TEST (alternata invertita)
        const [res2] = await conn60.query(
            `
      INSERT INTO sessioni
      (maxposti, Postidisponibili, dataesame, dataprova, nomesessione, domicilio, note, visible, attivo, idstudio, indirizzosessione, idparent, datainvio)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, '', ?, ?)
      `,
            [maxposti, maxposti, dProva, dEsame, `TEST - ${convenzione || ""}`, "", note || "", idstudio, idsessione1, dNow]
        );
        const idsessione2 = res2.insertId;

        await conn60.query(
            `INSERT INTO prenotazioni (idsessione, iduser, idcourse, db) VALUES (?,?,?,?)`,
            [idsessione2, iduser, idcourse, "forma4"]
        );

        // flagevent = 0 (proposta inviata)
        await connForma.query(
            `UPDATE learning_certificate_assign SET flagevent = 0 WHERE id_user = ? AND id_course = ?`,
            [iduser, idcourse]
        );

        if (ckmail) {
            try {
                await axios.post(`${process.env.BACKEND_URL}/api/finecorso60h/email/proposta`, {
                    iduser,
                    idsessione: idsessione1,
                });
            } catch (e) {
                console.error("⚠️ Invio email proposta: ", e.message);
            }
        }

        res.json({
            success: true,
            idsessione_main: idsessione1,
            idsessione_alt: idsessione2,
            message: "Proposte create correttamente",
        });
    } catch (err) {
        console.error("❌ Errore creazione sessioni:", err);
        res.status(500).json({ error: "Errore creazione sessioni" });
    }
});


router.put("/note", async (req, res) => {
    try {
        const { id_user, id_course, note } = req.body;

        if (!id_user || !id_course) {
            return res.status(400).json({ error: "Missing id_user or id_course" });
        }

        const connIFAD = await getConnection("IFAD", "forma4");

        await connIFAD.query(
            `UPDATE learning_certificate_assign 
             SET note = ?
             WHERE id_user = ? AND id_course = ?`,
            [note || "", id_user, id_course]
        );

        res.json({ success: true });
    } catch (err) {
        console.error("UPDATE NOTE ERR:", err.message);
        res.status(500).json({ error: "Errore aggiornamento note" });
    }
});
/**
 * 5️⃣  POST /api/finecorso60h/sessione/:idsessione/conferma
 *     → Conferma la sessione scelta, elimina la gemella, flagevent=1
 */
router.post("/sessione/:idsessione/conferma", async (req, res) => {
    const { idsessione } = req.params;
    const { iduser, idcourse } = req.body;

    if (!iduser || !idcourse) {
        return res.status(400).json({ error: "Parametri mancanti" });
    }

    try {
        const conn60 = await getConnection("IFAD", "rb60h");
        const connForma = await getConnection("IFAD", "forma4");

        // segna conferma
        await conn60.query(`UPDATE sessioni SET flagconferma = 1 WHERE id = ?`, [idsessione]);

        // elimina la "gemella": trovando parent <-> child
        const [r] = await conn60.query(`SELECT id, idparent FROM sessioni WHERE id = ?`, [idsessione]);
        if (r.length) {
            const row = r[0];
            if (row.idparent) {
                // io sono la figlia → elimina il parent
                await conn60.query(`DELETE FROM sessioni WHERE id = ?`, [row.idparent]);
                await conn60.query(`DELETE FROM prenotazioni WHERE idsessione = ?`, [row.idparent]);
            } else {
                // io sono il parent → elimina tutte con idparent = me
                await conn60.query(`DELETE FROM sessioni WHERE idparent = ?`, [row.id]);
                await conn60.query(`DELETE FROM prenotazioni WHERE idsessione IN (SELECT id FROM sessioni WHERE idparent = ?)`, [row.id]);
            }
        }

        // flagevent = 1
        await connForma.query(
            `UPDATE learning_certificate_assign SET flagevent = 1 WHERE id_user = ? AND id_course = ?`,
            [iduser, idcourse]
        );

        InviaComunicaConferma60h(iduser, idsessione)
        res.json({ success: true, message: "Sessione confermata" });
    } catch (err) {
        console.error("❌ Errore conferma sessione:", err);
        res.status(500).json({ error: "Errore conferma sessione" });
    }
});

/**
 * 6️⃣  POST /api/finecorso60h/sessione/:idsessione/pagato
 *     body: { pagato: 0|1, iduser, idcourse }
 *     → pagato=1 => flagevent=3
 *       pagato=0 => flagevent=4
 */
router.post("/sessione/:idsessione/pagato", async (req, res) => {
    const { idsessione } = req.params;
    const { pagato, iduser, idcourse } = req.body;

    if (typeof pagato === "undefined" || !iduser || !idcourse) {
        return res.status(400).json({ error: "Parametri mancanti" });
    }

    try {
        const conn60 = await getConnection("IFAD", "rb60h");
        const connForma = await getConnection("IFAD", "forma4");

        await conn60.query(`UPDATE sessioni SET pagato = ? WHERE id = ?`, [pagato ? 1 : 0, idsessione]);

        const flagevent = pagato ? 3 : 4;
        await connForma.query(
            `UPDATE learning_certificate_assign SET flagevent = ? WHERE id_user = ? AND id_course = ?`,
            [flagevent, iduser, idcourse]
        );

        res.json({ success: true, message: "Pagato aggiornato" });
    } catch (err) {
        console.error("❌ Errore pagato:", err);
        res.status(500).json({ error: "Errore aggiornamento pagato" });
    }
});

/**
 * ✅ Attiva Test (equiv. InviaTest60h)
 * → Iscrive l'utente al test corretto su forma4
 */
router.post("/sessione/:idsessione/invia-test", async (req, res) => {
    const { idsessione } = req.params;

    try {
        const conn60 = await getConnection("IFAD", "rb60h");
        const connForma = await getConnection("IFAD", "forma4");

        // Recupero iduser e idcourse della prenotazione
        const [r] = await conn60.query(
            `SELECT iduser, idcourse 
             FROM prenotazioni
             WHERE idsessione = ?
             LIMIT 1`,
            [idsessione]
        );

        if (!r.length) {
            return res.status(404).json({ error: "Prenotazione non trovata" });
        }

        const iduser = r[0].iduser;
        let idcourse = r[0].idcourse;

        // ✅ Mappatura corso test come in VB
        if (idcourse === 73) idcourse = 74;
        else if (idcourse === 85) idcourse = 86;

        const now = new Date();
        const date_inscr = toMySQLDateTime(now);
        const date_end = toMySQLDateTime(new Date(now.getTime() + 365 * 24 * 3600 * 1000));

        // ✅ Inserisce accesso test (come w.IscriviaCorsoByiduser)
        await iscriviACorsoByIdUser(iduser, idcourse, 0, "", "forma4");

        res.json({
            success: true,
            message: "Test attivato correttamente",
        });

    } catch (err) {
        console.error("❌ Errore attiva test:", err.message);
        res.status(500).json({ error: "Errore attivazione test" });
    }
});

/**
 * 8️⃣  POST /api/finecorso60h/sessione/:idsessione/sblocca-test
 *     → Sblocca test (status=1) sul corso TEST
 */
/**
 * ✅ Sblocca test finale (riabilita checktest)
 * VB: sbloccatest60(idsessione)
 */
router.post("/sessione/:idsessione/sblocca-test", async (req, res) => {
    const { idsessione } = req.params;

    try {
        const conn60 = await getConnection("IFAD", "rb60h");
        const connForma = await getConnection("IFAD", "forma4");

        // Recupera utente già prenotato alla sessione
        const [r] = await conn60.query(
            `SELECT p.iduser
             FROM prenotazioni p
             WHERE p.idsessione = ?
             LIMIT 1`,
            [idsessione]
        );

        if (!r.length) {
            return res.status(404).json({ error: "Prenotazione non trovata" });
        }

        const iduser = r[0].iduser;

        // ✅ VB: update forma4.learning_Testtrack set checktest=0 where iduser=.. and idtest in (969,1372)
        await connForma.query(
            `UPDATE learning_Testtrack
             SET checktest = 0
             WHERE iduser = ?
               AND idtest IN (969, 1372)`,
            [iduser]
        );

        res.json({ success: true, message: "Test sbloccato correttamente" });

    } catch (err) {
        console.error("❌ Errore sblocco test:", err.message);
        res.status(500).json({ error: "Errore sblocco test" });
    }
});

/**
 * 9️⃣  Stub: POST /api/finecorso60h/email/proposta
 *     → Placeholder per invio email proposta (integrazione futura)
 */
router.post("/email/proposta", async (req, res) => {
    const { iduser, idcourse, dataprova, dataesame, note } = req.body;

    const result = await insertSessione260h({
        update: false,
        iduser,
        idcourse,
        dataprova,
        dataesame,
        note,

    });

    if (!result.success) {
        return res.status(500).json({ error: "Errore inserimento sessione" });
    }

    await InviaComunicazioneProposta60h(iduser, result.idsessione_main);

    res.json({
        success: true,
        message: "Proposta inviata e sessioni create correttamente"
    });
});


/**
 * ✅  PUT /api/finecorso60h/sessione/:idsessione
 *     → Aggiorna date e note della sessione
 */
router.put("/sessione/:idsessione", async (req, res) => {
    const { idsessione } = req.params;
    const { dataprova, dataesame, note } = req.body;

    if (!dataprova || !dataesame) {
        return res.status(400).json({ error: "Dati mancanti" });
    }

    try {
        const conn60 = await getConnection("IFAD", "rb60h");

        // ✅ Update sessione
        await conn60.query(
            `UPDATE sessioni
             SET dataprova = ?, dataesame = ?, note = ?
             WHERE id = ?`,
            [
                dataprova.replace("T", " ") + ":00",
                dataesame.replace("T", " ") + ":00",
                note || "",
                idsessione
            ]
        );

        return res.json({ success: true, message: "Sessione aggiornata correttamente" });

    } catch (err) {
        console.error("❌ PUT /sessione ERR:", err.message);
        return res.status(500).json({ error: "Errore aggiornamento sessione" });
    }
});

/**
 * 🚫 DELETE /api/finecorso60h/sessione/:idsessione
 * Cancella SOLO la sessione selezionata
 * Se era confermata → flagevent=2
 */
router.delete("/sessione/:idsessione", async (req, res) => {
    const { idsessione } = req.params;

    try {
        const conn60 = await getConnection("IFAD", "rb60h");
        const connForma = await getConnection("IFAD", "forma4");

        // Recupero info (mi serve iduser e idcourse)
        const [info] = await conn60.query(
            `SELECT p.iduser, p.idcourse, s.flagconferma
             FROM sessioni s
             LEFT JOIN prenotazioni p ON p.idsessione = s.id
             WHERE s.id = ? LIMIT 1`,
            [idsessione]
        );

        if (!info.length) return res.status(404).json({ error: "Sessione non trovata" });

        const row = info[0];

        // 🎯 Se era confermata → flagevent=2 ("Non confermata dopo conferma")
        if (row.flagconferma === 1) {
            await connForma.query(
                `UPDATE learning_certificate_assign
                 SET flagevent = 2
                 WHERE id_user = ? AND id_course = ?`,
                [row.iduser, row.idcourse]
            );
        }

        // 🔥 Cancello SOLO questa sessione e relative prenotazioni
        await conn60.query(`DELETE FROM prenotazioni WHERE idsessione = ?`, [idsessione]);
        await conn60.query(`DELETE FROM sessioni WHERE id = ?`, [idsessione]);

        return res.json({ success: true });

    } catch (err) {
        console.error("❌ DELETE sessione ERR:", err);
        res.status(500).json({ error: "Errore eliminazione sessione" });
    }
});


const fs = require("fs");
const path = require("path");

// ============================================================
// 📧 Email proposta sessione (due date)
// ============================================================
async function InviaComunicazioneProposta60h(iduser, idsessione) {
    try {
        const conn60 = await getConnection("IFAD", "rb60h");

        const [rows] = await conn60.query(
            `SELECT a.email, a.nome, a.cognome,
                    s.dataesame, s.dataprova
             FROM anagrafiche a
             JOIN prenotazioni p ON a.id = p.iduser
             JOIN sessioni s ON p.idsessione = s.id
             WHERE p.iduser = ? AND p.idsessione = ?`,
            [iduser, idsessione]
        );
        if (!rows.length) return;

        const r = rows[0];

        let body = `<div style="line-height:normal;">` +
            await getMailFormat("mailformat60hproposta2") +
            `</div>`;

        body = body.replace("[NOME]", r.nome)
            .replace("[COGNOME]", r.cognome)
            .replace("[DATAESAME]", new Date(r.dataesame).toLocaleDateString("it-IT"))
            .replace("[ORA]", new Date(r.dataesame).toLocaleTimeString("it-IT"));

        if (r.dataprova) {
            body = body.replace("[DATAPROVA]", new Date(r.dataprova).toLocaleDateString("it-IT"))
                .replace("[ORAPROVA]", new Date(r.dataprova).toLocaleTimeString("it-IT"));
        }

        body += "<br>" + piedinodidattica;

        // ✅ Invia Email con allegato
        const bcc = await getBCC(iduser);

        await invioMail({
            to: r.email,
            from: "didattica@formazioneintermediari.com",
            subject: "Test finale 60h IVASS: proposte",
            html: body,
            bcc
        });
    } catch (err) {
        console.error("❌ InviaComunicazioneProposta60h ERR:", err.message);
    }
}

// ============================================================
// ✅ Email conferma sessione + invio ICS
// ============================================================
async function InviaComunicaConferma60h(iduser, idsessione) {
    try {
        const conn60 = await getConnection("IFAD", "rb60h");

        const [rows] = await conn60.query(
            `SELECT a.email, a.nome, a.cognome,
                    s.dataesame, s.dataprova
             FROM anagrafiche a
             JOIN prenotazioni p ON a.id = p.iduser
             JOIN sessioni s ON p.idsessione = s.id
             WHERE p.iduser = ? AND p.idsessione = ?`,
            [iduser, idsessione]
        );
        if (!rows.length) return;

        const r = rows[0];

        let body = await getMailFormat("mailformat60hconferma2");
        body = body
            .replace("[NOME]", r.nome)
            .replace("[COGNOME]", r.cognome)
            .replace("[DATAESAME]", new Date(r.dataesame).toLocaleDateString("it-IT"))
            .replace("[ORA]", new Date(r.dataesame).toLocaleTimeString("it-IT"))
            .replace("[DATAPROVA]", new Date(r.dataprova).toLocaleDateString("it-IT"))
            .replace("[ORAPROVA]", new Date(r.dataprova).toLocaleTimeString("it-IT"));

        body += "<br>" + piedinodidattica;

        // ✅ Percorso corretto per ICS
        const dir = path.join(process.cwd(), "public/temp");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const filePath = path.join(dir, `sessione_${iduser}.ics`);

        // ✅ Genera ICS
        const ics =
            `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:${new Date(r.dataprova).toISOString().replace(/[-:]/g, "").split(".")[0]}
SUMMARY:Prova test
END:VEVENT
BEGIN:VEVENT
DTSTART:${new Date(r.dataesame).toISOString().replace(/[-:]/g, "").split(".")[0]}
SUMMARY:Test Finale
END:VEVENT
END:VCALENDAR`;

        fs.writeFileSync(filePath, ics);

        // ✅ Invia Email con allegato
        const bcc = await getBCC(iduser);

        await invioMail({
            to: r.email,
            from: "didattica@formazioneintermediari.com",
            subject: "Test finale 60h IVASS: conferma",
            html: body,
            bcc,
            attachments: [filePath]
        });

        console.log("✅ Email conferma inviata con successo");

        // ✅ Cancella ICS dopo invio
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log("🗑️ Allegato ICS cancellato:", filePath);
        }

        await conn60.query(
            `UPDATE prenotazioni SET flagmail = 1 WHERE iduser=? AND idsessione=?`,
            [iduser, idsessione]
        );

    } catch (err) {
        console.error("❌ InviaComunicaConferma60h ERR:", err.message);
    }
}

// ============================================================
// ✅ Inserisce prenotazione + aggiorna posti + anagrafica
// ============================================================
async function insertPrenotazione60h(idsessione, iduser, idcourse) {
    const now = new Date();
    const conn60 = await getConnection("IFAD", "rb60h");
    const connForma = await getConnection("IFAD", "forma4");
    await conn60.query(
        `INSERT INTO prenotazioni (iduser, idsessione, data_prenotazione, idcourse, db)
         VALUES (?,?,?,?, 'forma4')`,
        [iduser, idsessione, now, idcourse]
    );

    // Disponibilità
    await conn60.query(
        `UPDATE sessioni SET Postidisponibili = GREATEST(0, Postidisponibili - 1)
         WHERE id=?`,
        [idsessione]
    );

    // Anagrafica → sincronizza da forma4
    const [u] = await connForma.query(
        `SELECT firstname, lastname, email FROM core_user WHERE idst=?`,
        [iduser]
    );

    if (u.length) {
        await conn60.query(
            `INSERT INTO anagrafiche (id,nome,cognome,email)
             VALUES (?,?,?,?)
             ON DUPLICATE KEY UPDATE nome=VALUES(nome),
                                      cognome=VALUES(cognome),
                                      email=VALUES(email)`,
            [iduser, u[0].firstname, u[0].lastname, u[0].email]
        );
    }
}

async function insertSessione260h({
    update = false,
    idSessione, // ✅ serviva
    iduser,
    idcourse,
    dataprova,
    dataesame,
    note = "",
    nomesessione = "",
    domicilio = ""
}) {
    const conn60 = await getConnection("IFAD", "rb60h");
    const connForma = await getConnection("IFAD", "forma4");

    const maxposti = 1;
    const dNow = new Date().toISOString().slice(0, 19).replace("T", " ");

    try {

        if (update) {
            // ===========================
            // 🔄 UPDATE ESISTENTE (b = TRUE)
            // ===========================

            // Trova sessione
            const [r] = await conn60.query(
                `SELECT id, idparent, nomesessione, flagconferma 
                 FROM sessioni 
                 WHERE idsessione = ?`,
                [idSessione]
            );
            if (!r.length) throw new Error("Sessione non trovata");

            const isTest2 = r[0].nomesessione?.includes("TEST2");

            if (isTest2) {
                // Update su TEST2
                await conn60.query(
                    `UPDATE sessioni
                     SET dataesame=?, dataprova=?, maxposti=?, note=?
                     WHERE id = ?`,
                    [dataesame, dataprova, maxposti, note, idSessione]
                );
            } else {
                // Update su TEST speculare
                await conn60.query(
                    `UPDATE sessioni
                     SET dataprova=?, dataesame=?, maxposti=?, note=?,
                         Postidisponibili=ABS(?-(SELECT COUNT(*) FROM prenotazioni WHERE idsessione=?))
                     WHERE id = ?`,
                    [dataesame, dataprova, maxposti, note, maxposti, idSessione, idSessione]
                );
            }

            if (r[0].flagconferma === 1) {
                // ✅ Conferma già gestita fuori
            }

            return { success: true, message: "Aggiornamento completato" };
        }

        // ===========================
        // ✳️ INSERT (b = FALSE)
        // ===========================

        // 1️⃣ INSERT sessione TEST2
        const [res1] = await conn60.query(
            `INSERT INTO sessioni
             (maxposti, Postidisponibili, dataesame, dataprova, nomesessione, domicilio, note, visible, attivo, idstudio, indirizzosessione, datainvio)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 1, '', ?)`,
            [
                maxposti, maxposti,
                dataesame, dataprova,
                `TEST2 - ${nomesessione || ""}`, domicilio, note, dNow
            ]
        );

        const idsessione1 = res1.insertId;

        await insertPrenotazione60h(idsessione1, iduser, idcourse);

        // 2️⃣ INSERT sessione TEST gemella
        const [res2] = await conn60.query(
            `INSERT INTO sessioni
             (maxposti, Postidisponibili, dataesame, dataprova, nomesessione, domicilio, note, visible, attivo, idstudio, indirizzosessione, idparent, datainvio)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 1, '', ?, ?)`,
            [
                maxposti, maxposti,
                dataprova, dataesame,
                `TEST - ${nomesessione || ""}`, domicilio, note,
                idsessione1, dNow
            ]
        );

        const idsessione2 = res2.insertId;

        await insertPrenotazione60h(idsessione2, iduser, idcourse);

        // 3️⃣ Link parent-child
        await conn60.query(
            `UPDATE sessioni SET idparent = ? WHERE id = ?`,
            [idsessione2, idsessione1]
        );

        // 4️⃣ flagevent=0 su forma4
        await connForma.query(
            `UPDATE learning_certificate_assign 
             SET flagevent = 0
             WHERE id_user = ? AND id_course = ?`,
            [iduser, idcourse]
        );

        return {
            success: true,
            idsessione_main: idsessione1,
            idsessione_alt: idsessione2
        };

    } catch (err) {
        console.error("❌ insertSessione260h ERR:", err);
        return { success: false, error: err.message };
    }
}

async function iscriviACorsoByIdUser(idst, idcorso, status = 0, host = "", db = "forma4") {
    const conn = await getConnection("IFAD", "forma4");

    const now = new Date();
    const date_inscr = toMySQLDateTime(now);
    const date_begin = date_inscr;
    const date_end = toMySQLDateTime(new Date(now.getTime() + 365 * 24 * 3600 * 1000)); // +365 gg

    // 1) Inserimento learning_courseuser (se già presente, ignora)
    try {
        await conn.query(
            `
      INSERT INTO learning_courseuser
      (idUser, idCourse, level, date_inscr, waiting, imported_from_connection,
       absent, cancelled_by, new_forum_post, date_begin_validity, date_expire_validity)
      VALUES (?, ?, 3, ?, 0, 1039, 0, 0, 0, ?, ?)
      ON DUPLICATE KEY UPDATE
        date_inscr = VALUES(date_inscr),
        date_begin_validity = VALUES(date_begin_validity),
        date_expire_validity = VALUES(date_expire_validity)
      `,
            [idst, idcorso, date_inscr, date_begin, date_end]
        );
    } catch (err) {
        console.error("❌ iscriviACorsoByIdUser > INSERT learning_courseuser:", err.message);
        throw err;
    }

    // 2) Casi speciali: allinea la scadenza alla "sorella"
    //    - 429 eredita la scadenza di 428
    //    - 415 eredita la scadenza di 414
    try {
        let sisterCourse = null;
        if (idcorso === 429) sisterCourse = 428;
        if (idcorso === 415) sisterCourse = 414;

        if (sisterCourse) {
            const [rows] = await conn.query(
                `SELECT date_expire_validity FROM learning_courseuser WHERE iduser = ? AND idcourse = ? LIMIT 1`,
                [idst, sisterCourse]
            );
            if (rows.length) {
                const sisterExpire = rows[0].date_expire_validity;
                await conn.query(
                    `UPDATE learning_courseuser
           SET date_expire_validity = ?
           WHERE iduser = ? AND idcourse = ?`,
                    [sisterExpire, idst, idcorso]
                );
            }
        }
    } catch (err) {
        console.warn("⚠️ iscriviACorsoByIdUser > allineamento scadenza sorella:", err.message);
        // non bloccare il flusso
    }

    // 3) Inserimento membership nel gruppo "/lms/course/{idcorso}/subscribed/3"
    try {
        const [g] = await conn.query(
            `SELECT idst
       FROM core_group
       WHERE groupid LIKE ?
       LIMIT 1`,
            [`%/lms/course/${idcorso}/subscribed/3%`]
        );

        if (g.length) {
            const idstgroup = g[0].idst;
            await conn.query(
                `INSERT IGNORE INTO core_group_members (idst, idstMember) VALUES (?, ?)`,
                [idstgroup, idst]
            );
        }
    } catch (err) {
        console.warn("⚠️ iscriviACorsoByIdUser > inserimento group membership:", err.message);
        // non bloccare il flusso
    }

    return { success: true };
}


module.exports = router;