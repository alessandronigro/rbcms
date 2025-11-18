// backend/routes/calendario60.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const { getConnection } = require("../dbManager");
const { getMailFormat } = require("../utils/helper");
const { invioMail } = require("../utils/mailerBrevo");
const { toMySQLDateTime } = require("../utils/helper.js");
const { piedinorbacademy, getBCC } = require("../utils/helper.js");
// ============================================================
//   FINE CORSO Amm - ROUTES
// ============================================================

/**
 * 1️⃣  GET /api/finecorsoAmm
 *     → Restituisce elenco corsisti con stato e date
 */
router.get("/", async (req, res) => {
    try {
        const conn = await getConnection(process.env.MYSQL_formazionecondorb);

        const sql = `
      select distinct(concat(a.id_user,a.id_course)) as id,firstname,lastname,a.flagevent,a.note,c.user_entry as convenzione,d.code, a.on_date,a.evaso,a.data_invio,a.id_user,a.id_course as idcourse,(select distinct(iduser) from rbamministratore.prenotazioni where iduser=a.id_user) as aggiunto  from (((learning_certificate_assign a  join core_user b on b.idst=a.id_user) left join core_field_userentry c on c.id_user=b.idst)  left join learning_course d on d.idcourse=a.id_course)   where (a.pagato !=1 OR a.pagato IS NULL)  and    id_common=25   And user_entry='RB Academy' AND  a.id_course in (18,9,29,31,33) order by on_date desc
    `;

        const [rows] = await conn.query(sql);
        res.json(rows);
    } catch (err) {
        console.error("❌ Errore GET /finecorsoAmm:", err.message);
        res.status(500).json({ error: "Errore nel caricamento elenco" });
    }
});

/**
 * 2️⃣  GET /api/finecorsoAmm/calendario
 *     → Eventi per FullCalendar
 */
router.get("/calendario", async (req, res) => {
    try {
        const conn = await getConnection("rbamministratore");

        const [rows] = await conn.query(`
        SELECT s.id, s.dataesame, s.dataprova, s.flagconferma,
               p.iduser, p.idcourse,
               a.nome AS nome_utente, a.cognome AS cognome_utente,
               l.flagevent, l.note AS note_cert
        FROM sessioni s
        LEFT JOIN prenotazioni p ON s.id = p.idsessione
        LEFT JOIN anagrafiche a ON p.iduser = a.id
        LEFT JOIN formazionecondorb.learning_certificate_assign l
               ON l.id_user = p.iduser AND l.id_course = p.idcourse
        ORDER BY s.dataesame DESC`);

        const colorMap = {
            0: "#bbf7d0", // da confermare
            1: "#059669", // confermata
            2: "#6b7280", // non confermata → resta solo nella tabella
            3: "#f87171", // buon fine NO
            4: "#f9a8d4"  // buon fine SI
        };

        const events = rows
            .filter(r => r.flagevent !== 2) // le non confermate restano soltanto in FineCorsoAmm
            .map(r => {
                const bg = colorMap[r.flagevent] || colorMap[0];

                return {
                    id: r.id,
                    title: `${r.cognome_utente} ${r.nome_utente || ""}`,
                    start: r.dataesame,
                    backgroundColor: bg,
                    extendedProps: {
                        flagevent: r.flagevent,
                        iduser: r.iduser,
                        idcourse: r.idcourse,
                        dataprova: r.dataprova,
                        note: r.note_cert || ""
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
 * 3️⃣  GET /api/finecorsoAmm/sessione/:idsessione/dettaglio
 *     → Dati completi per modale
 */
router.get("/sessione/:idsessione/dettaglio", async (req, res) => {
    const { idsessione } = req.params;
    try {
        const conn = await getConnection("rbamministratore");
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
        st.tipologia AS tipologia_studio,
        l.note AS note_cert
      FROM sessioni s
      LEFT JOIN prenotazioni p ON p.idsessione = s.id
      LEFT JOIN anagrafiche a ON a.id = p.iduser
      LEFT JOIN studi st ON st.id = s.idstudio
      LEFT JOIN formazionecondorb.learning_certificate_assign l
        ON l.id_user = p.iduser AND l.id_course = p.idcourse
      WHERE s.id = ?
    `,
            [idsessione]
        );

        if (!rows.length) return res.status(404).json({ error: "Sessione non trovata" });
        const row = rows[0];

        // ✅ Recupera telefono anche dal campo aggiuntivo se mancante
        let telefonoUtente = (row.telefono_utente || "").trim();
        if ((!telefonoUtente || telefonoUtente.length < 5) && row.iduser) {
            try {
                const userDbName = row.db || process.env.MYSQL_formazionecondorb;
                if (userDbName) {
                    const connUser = await getConnection(userDbName);
                    const [telefonoRows] = await connUser.query(
                        `SELECT user_entry
                         FROM core_field_userentry
                         WHERE id_user = ?
                           AND id_common IN (20, 14)
                         ORDER BY FIELD(id_common, 20, 14)
                         LIMIT 1`,
                        [row.iduser]
                    );
                    telefonoUtente = (telefonoRows?.[0]?.user_entry || telefonoUtente || "").trim();
                }
            } catch (err) {
                console.warn("⚠️ AMM telefono non disponibile:", err.message);
            }
        }

        const noteSessione = typeof row.note === "string" ? row.note : "";
        const enrichedRow = {
            ...row,
            note: noteSessione || row.note_cert || "",
            telefono_utente: telefonoUtente,
        };

        let testAttivo = false;
        if (row.iduser && row.idcourse) {
            let testCourseId = Number(row.idcourse);
            if (testCourseId === 73) testCourseId = 74;
            else if (testCourseId === 85) testCourseId = 86;

            if (testCourseId) {
                try {
                    const connForma = await getConnection(process.env.MYSQL_formazionecondorb);
                    const [exists] = await connForma.query(
                        `SELECT 1 FROM learning_courseuser WHERE idUser=? AND idCourse=? LIMIT 1`,
                        [row.iduser, testCourseId]
                    );
                    testAttivo = exists.length > 0;
                } catch (err) {
                    console.warn("⚠️ Check test_attivo AMM fallita:", err.message);
                }
            }
        }

        res.json({ ...enrichedRow, test_attivo: testAttivo });
    } catch (err) {
        console.error("❌ Errore dettaglio sessione:", err);
        res.status(500).json({ error: "Errore caricamento dettaglio sessione" });
    }
});

/**
 * 4️⃣  POST /api/finecorsoAmm/sessione
 *     → Crea le due proposte: TEST2 (principale) + TEST (alternativa)
 *        e inserisce prenotazioni. flagevent=0 su learning_certificate_assign
 */
router.post("/sessione", async (req, res) => {
    const { iduser, idcourse, dataprova, dataesame, ckmail, note, convenzione } = req.body;

    if (!iduser || !idcourse || !dataprova || !dataesame) {
        return res.status(400).json({ error: "Parametri mancanti" });
    }

    try {
        const connAmm = await getConnection("rbamministratore");
        const connForma = await getConnection(process.env.MYSQL_formazionecondorb);

        // se esiste già una proposta per l'utente evito duplicati
        const [exists] = await connAmm.query(
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
        const [res1] = await connAmm.query(
            `
      INSERT INTO sessioni
      (maxposti, Postidisponibili, dataesame, dataprova, nomesessione, domicilio, note, visible, attivo, idstudio, indirizzosessione, datainvio)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, '', ?)
      `,
            [maxposti, maxposti, dEsame, dProva, `TEST2 - ${convenzione || ""}`, "", note || "", idstudio, dNow]
        );
        const idsessione1 = res1.insertId;

        await connAmm.query(
            `INSERT INTO prenotazioni (idsessione, iduser, idcourse, db) VALUES (?,?,?,?)`,
            [idsessione1, iduser, idcourse, process.env.MYSQL_formazionecondorb]
        );

        // TEST (alternata invertita)
        const [res2] = await connAmm.query(
            `
      INSERT INTO sessioni
      (maxposti, Postidisponibili, dataesame, dataprova, nomesessione, domicilio, note, visible, attivo, idstudio, indirizzosessione, idparent, datainvio)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, '', ?, ?)
      `,
            [maxposti, maxposti, dProva, dEsame, `TEST - ${convenzione || ""}`, "", note || "", idstudio, idsessione1, dNow]
        );
        const idsessione2 = res2.insertId;

        await connAmm.query(
            `INSERT INTO prenotazioni (idsessione, iduser, idcourse, db) VALUES (?,?,?,?)`,
            [idsessione2, iduser, idcourse, process.env.MYSQL_formazionecondorb]
        );

        // flagevent = 0 (proposta inviata)
        await connForma.query(
            `UPDATE learning_certificate_assign SET flagevent = 0 WHERE id_user = ? AND id_course = ?`,
            [iduser, idcourse]
        );

        if (ckmail) {
            try {
                await axios.post(`${process.env.BACKEND_URL}/api/finecorsoAmm/email/proposta`, {
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

        const connIFAD = await getConnection(process.env.MYSQL_formazionecondorb);

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
 * 5️⃣  POST /api/finecorsoAmm/sessione/:idsessione/conferma
 *     → Conferma la sessione scelta, elimina la gemella, flagevent=1
 */
router.post("/sessione/:idsessione/conferma", async (req, res) => {
    const { idsessione } = req.params;
    const { iduser, idcourse } = req.body;

    if (!iduser || !idcourse) {
        return res.status(400).json({ error: "Parametri mancanti" });
    }

    try {
        const connAmm = await getConnection("rbamministratore");
        const connForma = await getConnection(process.env.MYSQL_formazionecondorb);

        // segna conferma
        await connAmm.query(`UPDATE sessioni SET flagconferma = 1 WHERE id = ?`, [idsessione]);

        // elimina la "gemella": trovando parent <-> child
        const [r] = await connAmm.query(`SELECT id, idparent FROM sessioni WHERE id = ?`, [idsessione]);
        if (r.length) {
            const row = r[0];
            if (row.idparent) {
                // io sono la figlia → elimina il parent
                await connAmm.query(`DELETE FROM sessioni WHERE id = ?`, [row.idparent]);
                await connAmm.query(`DELETE FROM prenotazioni WHERE idsessione = ?`, [row.idparent]);
            } else {
                // io sono il parent → elimina tutte con idparent = me
                await connAmm.query(`DELETE FROM sessioni WHERE idparent = ?`, [row.id]);
                await connAmm.query(`DELETE FROM prenotazioni WHERE idsessione IN (SELECT id FROM sessioni WHERE idparent = ?)`, [row.id]);
            }
        }

        // flagevent = 1
        await connForma.query(
            `UPDATE learning_certificate_assign SET flagevent = 1 WHERE id_user = ? AND id_course = ?`,
            [iduser, idcourse]
        );

        InviaComunicaConfermaAmm(iduser, idsessione)
        res.json({ success: true, message: "Sessione confermata" });
    } catch (err) {
        console.error("❌ Errore conferma sessione:", err);
        res.status(500).json({ error: "Errore conferma sessione" });
    }
});

/**
 * 5️⃣.bis POST /api/finecorsoAmm/sessione/:idsessione/conferma-no
 *        → Annulla la conferma riportando flagevent=0
 */
router.post("/sessione/:idsessione/conferma-no", async (req, res) => {
    const { idsessione } = req.params;
    const { iduser, idcourse } = req.body;

    if (!iduser || !idcourse) {
        return res.status(400).json({ error: "Parametri mancanti" });
    }

    try {
        const connAmm = await getConnection("rbamministratore");
        const connForma = await getConnection(process.env.MYSQL_formazionecondorb);

        await connAmm.query(`UPDATE sessioni SET flagconferma = 0 WHERE id = ?`, [idsessione]);
        await connForma.query(
            `UPDATE learning_certificate_assign SET flagevent = 0 WHERE id_user = ? AND id_course = ?`,
            [iduser, idcourse]
        );

        res.json({ success: true, message: "Conferma annullata" });
    } catch (err) {
        console.error("❌ Errore annulla conferma sessione Amm:", err);
        res.status(500).json({ error: "Errore annullamento conferma" });
    }
});

/**
 * 6️⃣  POST /api/finecorsoAmm/sessione/:idsessione/pagato
 *     body: { pagato: 0|1, iduser, idcourse }
 *     → pagato=1 => flagevent=4 (Buon fine SI)
 *       pagato=0 => flagevent=3 (Buon fine NO)
 */
router.post("/sessione/:idsessione/pagato", async (req, res) => {
    const { idsessione } = req.params;
    const { pagato, iduser, idcourse } = req.body;

    if (typeof pagato === "undefined" || !iduser || !idcourse) {
        return res.status(400).json({ error: "Parametri mancanti" });
    }

    try {
        const connAmm = await getConnection("rbamministratore");
        const connForma = await getConnection(process.env.MYSQL_formazionecondorb);

        await connAmm.query(`UPDATE sessioni SET pagato = ? WHERE id = ?`, [pagato ? 1 : 0, idsessione]);

        const flagevent = pagato ? 4 : 3;
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
 * ✅ Attiva Test (equiv. InviaTestAmm)
 * → Iscrive l'utente al test corretto su process.env.MYSQL_formazionecondorb
 */
router.post("/sessione/:idsessione/invia-test", async (req, res) => {
    const { idsessione } = req.params;

    try {
        const connAmm = await getConnection("rbamministratore");
        const connForma = await getConnection(process.env.MYSQL_formazionecondorb);

        // Recupero iduser e idcourse della prenotazione
        const [r] = await connAmm.query(
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
        await iscriviACorsoByIdUser(iduser, idcourse, 0, "", process.env.MYSQL_formazionecondorb);

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
 * 8️⃣  POST /api/finecorsoAmm/sessione/:idsessione/sblocca-test
 *     → Sblocca test (status=1) sul corso TEST
 */
/**
 * ✅ Sblocca test finale (riabilita checktest)
 * VB: sbloccatest60(idsessione)
 */
router.post("/sessione/:idsessione/sblocca-test", async (req, res) => {
    const { idsessione } = req.params;

    try {
        const connAmm = await getConnection("rbamministratore");
        const connForma = await getConnection(process.env.MYSQL_formazionecondorb);

        // Recupera utente già prenotato alla sessione
        const [r] = await connAmm.query(
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

        // ✅ VB: update process.env.MYSQL_formazionecondorb.learning_Testtrack set checktest=0 where iduser=.. and idtest in (969,1372)
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
 * 9️⃣  Stub: POST /api/finecorsoAmm/email/proposta
 *     → Placeholder per invio email proposta (integrazione futura)
 */
router.post("/email/proposta", async (req, res) => {
    const { iduser, idcourse, dataprova, dataesame, note } = req.body;

    const result = await insertSessione2Amm({
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

    await InviaComunicazionePropostaAmm(iduser, result.idsessione_main);

    res.json({
        success: true,
        message: "Proposta inviata e sessioni create correttamente"
    });
});


/**
 * ✅  PUT /api/finecorsoAmm/sessione/:idsessione
 *     → Aggiorna date e note della sessione
 */
router.put("/sessione/:idsessione", async (req, res) => {
    const { idsessione } = req.params;
    const { dataprova, dataesame, note } = req.body;

    if (!dataprova || !dataesame) {
        return res.status(400).json({ error: "Dati mancanti" });
    }

    try {
        const connAmm = await getConnection("rbamministratore");

        // ✅ Update sessione
        await connAmm.query(
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
 * 🚫 DELETE /api/finecorsoAmm/sessione/:idsessione
 * Cancella SOLO la sessione selezionata
 * Se era confermata → flagevent=2
 */
router.delete("/sessione/:idsessione", async (req, res) => {
    const { idsessione } = req.params;

    try {
        const connAmm = await getConnection("rbamministratore");
        const connForma = await getConnection(process.env.MYSQL_formazionecondorb);

        // Recupero info (mi serve iduser e idcourse)
        const [info] = await connAmm.query(
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
        await connAmm.query(`DELETE FROM prenotazioni WHERE idsessione = ?`, [idsessione]);
        await connAmm.query(`DELETE FROM sessioni WHERE id = ?`, [idsessione]);

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
async function InviaComunicazionePropostaAmm(iduser, idsessione) {
    try {
        const connAmm = await getConnection("rbamministratore");

        const [rows] = await connAmm.query(
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
            await getMailFormat("mailformatAmmproposta2") +
            `</div>`;

        body = body.replace("[NOME]", r.nome)
            .replace("[COGNOME]", r.cognome)
            .replace("[DATAESAME]", new Date(r.dataesame).toLocaleDateString("it-IT"))
            .replace("[ORA]", new Date(r.dataesame).toLocaleTimeString("it-IT"));

        if (r.dataprova) {
            body = body.replace("[DATAPROVA]", new Date(r.dataprova).toLocaleDateString("it-IT"))
                .replace("[ORAPROVA]", new Date(r.dataprova).toLocaleTimeString("it-IT"));
        }

        body += "<br>" + piedinorbacademy;

        // ✅ Invia Email con allegato
        const bcc = await getBCC(iduser);

        await invioMail({
            to: r.email,
            from: "info@rb-academy.it",
            subject: "Test finale Amministratore: proposte",
            html: body,
            bcc
        });
    } catch (err) {
        console.error("❌ InviaComunicazionePropostaAmm ERR:", err.message);
    }
}

// ============================================================
// ✅ Email conferma sessione + invio ICS
// ============================================================
async function InviaComunicaConfermaAmm(iduser, idsessione) {
    try {
        const connAmm = await getConnection("rbamministratore");

        const [rows] = await connAmm.query(
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

        let body = await getMailFormat("mailformatAmmconferma2");
        body = body
            .replace("[NOME]", r.nome)
            .replace("[COGNOME]", r.cognome)
            .replace("[DATAESAME]", new Date(r.dataesame).toLocaleDateString("it-IT"))
            .replace("[ORA]", new Date(r.dataesame).toLocaleTimeString("it-IT"))
            .replace("[DATAPROVA]", new Date(r.dataprova).toLocaleDateString("it-IT"))
            .replace("[ORAPROVA]", new Date(r.dataprova).toLocaleTimeString("it-IT"));

        body += "<br>" + piedinorbacademy;

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
            from: "info@rb-academy.it",
            subject: "Test finale Amministratore di condominio: conferma",
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

        await connAmm.query(
            `UPDATE prenotazioni SET flagmail = 1 WHERE iduser=? AND idsessione=?`,
            [iduser, idsessione]
        );

    } catch (err) {
        console.error("❌ InviaComunicaConfermaAmm ERR:", err.message);
    }
}

// ============================================================
// ✅ Inserisce prenotazione + aggiorna posti + anagrafica
// ============================================================
async function insertPrenotazioneAmm(idsessione, iduser, idcourse) {
    const now = new Date();
    const connAmm = await getConnection("rbamministratore");
    const connForma = await getConnection(process.env.MYSQL_formazionecondorb);
    await connAmm.query(
        `INSERT INTO prenotazioni (iduser, idsessione, data_prenotazione, idcourse, db)
         VALUES (?,?,?,?, 'process.env.MYSQL_formazionecondorb')`,
        [iduser, idsessione, now, idcourse]
    );

    // Disponibilità
    await connAmm.query(
        `UPDATE sessioni SET Postidisponibili = GREATEST(0, Postidisponibili - 1)
         WHERE id=?`,
        [idsessione]
    );

    // Anagrafica → sincronizza da process.env.MYSQL_formazionecondorb
    const [u] = await connForma.query(
        `SELECT firstname, lastname, email FROM core_user WHERE idst=?`,
        [iduser]
    );

    if (u.length) {
        await connAmm.query(
            `INSERT INTO anagrafiche (id,nome,cognome,email)
             VALUES (?,?,?,?)
             ON DUPLICATE KEY UPDATE nome=VALUES(nome),
                                      cognome=VALUES(cognome),
                                      email=VALUES(email)`,
            [iduser, u[0].firstname, u[0].lastname, u[0].email]
        );
    }
}

async function insertSessione2Amm({
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
    const connAmm = await getConnection("rbamministratore");
    const connForma = await getConnection(process.env.MYSQL_formazionecondorb);

    const maxposti = 1;
    const dNow = new Date().toISOString().slice(0, 19).replace("T", " ");

    try {

        if (update) {
            // ===========================
            // 🔄 UPDATE ESISTENTE (b = TRUE)
            // ===========================

            // Trova sessione
            const [r] = await connAmm.query(
                `SELECT id, idparent, nomesessione, flagconferma 
                 FROM sessioni 
                 WHERE idsessione = ?`,
                [idSessione]
            );
            if (!r.length) throw new Error("Sessione non trovata");

            const isTest2 = r[0].nomesessione?.includes("TEST2");

            if (isTest2) {
                // Update su TEST2
                await connAmm.query(
                    `UPDATE sessioni
                     SET dataesame=?, dataprova=?, maxposti=?, note=?
                     WHERE id = ?`,
                    [dataesame, dataprova, maxposti, note, idSessione]
                );
            } else {
                // Update su TEST speculare
                await connAmm.query(
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
        const [res1] = await connAmm.query(
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

        await insertPrenotazioneAmm(idsessione1, iduser, idcourse);

        // 2️⃣ INSERT sessione TEST gemella
        const [res2] = await connAmm.query(
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

        await insertPrenotazioneAmm(idsessione2, iduser, idcourse);

        // 3️⃣ Link parent-child
        await connAmm.query(
            `UPDATE sessioni SET idparent = ? WHERE id = ?`,
            [idsessione2, idsessione1]
        );

        // 4️⃣ flagevent=0 su process.env.MYSQL_formazionecondorb
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
        console.error("❌ insertSessione2Amm ERR:", err);
        return { success: false, error: err.message };
    }
}

async function iscriviACorsoByIdUser(idst, idcorso, status = 0, host = "", db = process.env.MYSQL_formazionecondorb) {
    const conn = await getConnection(process.env.MYSQL_formazionecondorb);

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
