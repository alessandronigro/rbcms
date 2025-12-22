const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer");
const axios = require("axios");

const { DOMParser, XMLSerializer } = require("xmldom");
const { getConnection } = require("../dbManager");
const {
    SaveAndSend,
    getLastTest,
    gettime,

    reinviamail,
} = require("../utils/helper");
const { fileURLToPath } = require("url");
const { PercentCircle } = require("lucide-react");
const log = (...args) => console.log("📘 [CORSI]", ...args);

/**
 * Post sospendi / attiva corso
 */
router.post("/sospendi", async (req, res) => {
    const { db, iduser, idcourse, status = 3 } = req.body;
    if (!db || !iduser || !idcourse) {
        return res.status(400).json({ error: "Parametri mancanti" });
    }

    const conn = await getConnection(db);
    try {
        await conn.query(
            `UPDATE learning_courseuser SET status=? WHERE idUser=? AND idCourse=?`,
            [status, iduser, idcourse]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Errore sospensione corso" });
    } finally {

    }
});

/**
 * Cancella utente def.
 */
router.delete("/utenti/:db/:iduser", async (req, res) => {
    const { db, iduser } = req.params;
    const conn = await getConnection(db);
    try {
        await conn.query(`DELETE FROM core_user WHERE idst=?`, [iduser]);
        await conn.query(`DELETE FROM core_field_userentry WHERE id_user=?`, [iduser]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Errore cancellazione utente" });
    } finally {

    }
});

/**
 * Cancella iscrizione corso
 */
router.delete("/:db/:iduser/:idcourse", async (req, res) => {
    const { db, iduser, idcourse } = req.params;
    const conn = await getConnection(db);

    try {
        await conn.query(
            `DELETE FROM learning_courseuser WHERE idUser=? AND idCourse=?`,
            [iduser, idcourse]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Errore cancellazione corso" });
    } finally {

    }
});

/**
 * Sblocca corso
 */
router.post("/sblocca", async (req, res) => {
    const { db, iduser } = req.body;
    if (!db || !iduser) return res.status(400).json({ error: "Parametri mancanti" });

    const conn = await getConnection(db);
    try {
        await conn.query(
            `UPDATE learning_common_track SET status = 'completed' WHERE idUser=? AND status != 'completed' where iduser=?`,
            [iduser]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Errore sblocco corso" });
    } finally {

    }
});

/**
 * Reinvia email iscrizione
 */
router.post("/reinvia-mail", async (req, res) => {
    const { db, iduser, idcourse, nome, cognome, email, userid, courseName } = req.body;
    log(`📧 Reinvia mail → ${email}, ${nome} ${cognome}`);
    try {
        const result = await reinviamail({ db, iduser, idcourse, nome, cognome, email, userid, corso: courseName });
        res.json({ success: true, message: "Mail reinviata correttamente", result });
    } catch (err) {
        console.error("❌ reinvia-mail:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get("/info", async (req, res) => {
    const { db, iduser, idcourse } = req.query;
    try {
        const conn = await getConnection(db);

        const [[course]] = await conn.query(`
            SELECT date_inscr,date_complete,status,date_expire_validity,
                (SELECT date_invio FROM learning_attestati 
                 WHERE idcourse=? AND iduser=? ORDER BY date_invio DESC LIMIT 1) AS date_invio,
                (SELECT COUNT(*)>0 FROM learning_certificate_assign 
                 WHERE id_course=? AND id_user=?) AS has_doc,
                (SELECT date_certificate FROM learning_certificate_assign 
                 WHERE id_course=? AND id_user=? LIMIT 1) AS doc_generated_at
            FROM learning_courseuser WHERE iduser=? AND idcourse=?
        `, [idcourse, iduser, idcourse, iduser, idcourse, iduser, iduser, idcourse]);

        const [[lastAccessCourse]] = await conn.query(`
            SELECT lasttime FROM learning_tracksession 
            WHERE idcourse=? AND iduser=? ORDER BY lasttime DESC LIMIT 1
        `, [idcourse, iduser]);

        course.last_access_course = lastAccessCourse?.lasttime || null;
        course.evaso = course.status == 2;

        res.json({ success: true, course });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


/**
 * 📄 GETTIME (replica fedele VB.NET)
 * Genera un PDF Report del corso con tutti i dati attività
 */

router.get("/gettime", async (req, res) => {
    try {
        const { db, iduser, idcourse, nome, cognome } = req.query;
        await gettime(iduser, idcourse, nome, cognome, db, false, res);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


/**
 * 📝 GET Ultimo Test corso (genera PDF)
 * /api/corsi/getlasttest?db=...&idst=...&firstname=...&lastname=...&idcourse=...
 */
router.get("/getlasttest", async (req, res) => {
    try {
        const { db, iduser, firstname, lastname, idcourse } = req.query;
        console.log("🔹 getLastTest params:", { db, iduser, firstname, lastname, idcourse });
        if (!db || !iduser || !idcourse)
            return res.status(400).json({ error: "Parametri mancanti" });

        await getLastTest(iduser, idcourse, firstname, lastname, db, false, 1, res);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post("/normalize-time", async (req, res) => {
    try {
        const { idUser, idCourse, db, extraHours = 1 } = req.body;
        if (!idUser || !idCourse)
            return res.status(400).json({ error: "idUser e idCourse richiesti" });

        const cn = await getConnection(db);

        const [[course]] = await cn.query(
            `SELECT timeleft FROM learning_course WHERE idCourse=?`,
            [idCourse]
        );

        if (!course)
            return res.status(404).json({ error: "Corso non trovato" });

        const requiredHours = Number(course.timeleft || 0);
        const extraHoursNum = Number(extraHours) || 0;

        const [sessions] = await cn.query(
            `
            SELECT idEnter, enterTime, lastTime
            FROM learning_tracksession
            WHERE idUser=? AND idCourse=?
            ORDER BY enterTime ASC
            `,
            [idUser, idCourse]
        );

        if (!sessions.length)
            return res.status(400).json({ error: "Nessuna sessione trovata" });

        const sessionInfos = sessions
            .map((s) => {
                const enterRaw = new Date(s.enterTime ?? s.entertime).getTime();
                if (!Number.isFinite(enterRaw)) return null;
                const enter = enterRaw;
                const lastRaw = new Date(s.lastTime ?? s.lasttime).getTime();
                const last = Number.isFinite(lastRaw) ? lastRaw : enter;
                const durationMs = Math.max(0, last - enter);
                return { s, enter, durationMs };
            })
            .filter(Boolean);

        const currentHours =
            sessionInfos.reduce((acc, info) => acc + info.durationMs, 0) / 3600000;

        let targetHours;
        if (extraHoursNum > 0) {
            targetHours = currentHours + extraHoursNum;
        } else {
            targetHours = Math.max(requiredHours, currentHours + extraHoursNum);
        }

        const diffHours = targetHours - currentHours;
        if (Math.abs(diffHours) < 1e-8) {
            return res.json({
                updated: false,
                beforeHours: currentHours,
                afterHours: currentHours,
                message: "Tempo già coerente"
            });
        }

        const sessionCount = sessionInfos.length;
        if (!sessionCount) {
            return res.status(400).json({ error: "Nessuna sessione valida trovata" });
        }

        const diffMs = diffHours * 3600000;
        const baseMs = diffMs / sessionCount;
        const jitterSequence = [12000, -5000, 3000, -4500, 2500, -5000];

        const adjustments = sessionInfos.map((info, index) => ({
            ...info,
            adjustedDuration: info.durationMs + baseMs + jitterSequence[index % jitterSequence.length],
        }));

        for (const info of adjustments) {
            if (!Number.isFinite(info.adjustedDuration)) continue;
            const clampedDuration = Math.max(0, info.adjustedDuration);
            const newLast = new Date(info.enter + clampedDuration);
            await cn.query(
                `
                UPDATE learning_tracksession
                SET lastTime=?
                WHERE idEnter=?
                `,
                [newLast, info.s.idEnter]
            );
        }

        const afterHours =
            adjustments.reduce((acc, info) => acc + Math.max(0, info.adjustedDuration), 0) / 3600000;

        return res.json({
            updated: true,
            beforeHours: currentHours,
            afterHours,
            message: `Tempo normalizzato e distribuito su ${sessionCount} sessioni`,
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

router.get("/orglist", async (req, res) => {
    const { db, idcourse } = req.query;
    if (!db || !idcourse) return res.status(400).json({ error: "Parametri mancanti" });

    const conn = await getConnection(db);
    try {
        const [rows] = await conn.query(
            `SELECT idOrg, title, objecttype, idResource
       FROM learning_organization
       WHERE objecttype='scormorg' and idcourse = ?
       ORDER BY path ASC`,
            [idcourse]
        );

        console.log("📦 Risultati trovati:", rows.length);
        return res.json({ success: true, orgs: rows });
    } catch (err) {
        console.error("❌ Errore orglist:", err);
        res.status(500).json({ success: false, error: err.message });
    } finally {

    }
});
router.get("/fillslide", async (req, res) => {
    const { db, idorg } = req.query;
    if (!db || !idorg) return res.status(400).json({ error: "Parametri mancanti" });

    try {
        // 🔹 Mappa piattaforme → endpoint PHP remoto
        const endpoints = {
            forma4: "https://ifad.formazioneintermediari.com/getfilelist.php",
            newformazionein: "https://efad.formazioneintermediari.com/getfilelist.php",
            simplybiz: "https://simplybiz.formazioneintermediari.com/getfilelist.php",
            formazionecondorb: "https://efad.rb-academy.it/getfilelist.php",
            efadnovastudia: "https://efad.novastudia.academy/getfilelist.php"
        };

        const endpoint = endpoints[db];
        if (!endpoint) throw new Error(`Database '${db}' non supportato`);

        const url = `${endpoint}?idorg=${idorg}&db=${db}`;
        const { data } = await axios.get(url, {
            httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false })
        });

        if (!data.success) throw new Error(data.error || "Errore remoto");
        res.json({ success: true, slides: data.files || [] });
    } catch (err) {
        console.error("❌ Errore fillslide remoto:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});


router.post("/cambiaslide", async (req, res) => {
    try {
        let { db, iduser, selectedOrg, newLessonLocation, lessonlocation, lesson_location } = req.body;
        newLessonLocation = newLessonLocation || lessonlocation || lesson_location;

        if (!db || !iduser || !selectedOrg || !newLessonLocation) {
            return res.status(400).json({
                success: false,
                error: "Parametri mancanti (db, iduser, selectedOrg, newLessonLocation)",
                received: req.body,
            });
        }

        console.log("🟡 [cambiaslide] Parametri ricevuti:", {
            db,
            iduser,
            selectedOrg,
            newLessonLocation,
        });

        const conn = await getConnection(db);
        const [dbCheck] = await conn.query("SELECT DATABASE() AS currentDb, @@hostname AS host");
        console.log(`✅ Connessione attiva → ${dbCheck[0].currentDb} @ ${dbCheck[0].host}`);

        // 1️⃣ Recupera XML attuale
        const [rows] = await conn.query(
            "SELECT xmldata, lesson_location FROM learning_scorm_tracking WHERE idUser=? AND idReference=? LIMIT 1",
            [Number(iduser), Number(selectedOrg)]
        );

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                error: `Tracking non trovato per utente=${iduser}, idReference=${selectedOrg}`,
            });
        }

        let xmlRaw = rows[0].xmldata?.toString("utf8") || "";
        console.log("📄 Lunghezza XML:", xmlRaw.length);

        // 2️⃣ Parsing XML
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlRaw, "text/xml");

        const locationNode = xmlDoc.getElementsByTagName("location")[0];
        if (!locationNode) {
            return res.status(400).json({
                success: false,
                error: "Tag <location> non trovato nel tracking XML",
            });
        }

        const oldLessonLocation = locationNode.textContent.trim();
        locationNode.textContent = newLessonLocation;

        const updatedXml = new XMLSerializer().serializeToString(xmlDoc);

        // 3️⃣ Aggiornamento in DB
        const [result] = await conn.query(
            "UPDATE learning_scorm_tracking SET lesson_location=?, xmldata=? WHERE idUser=? AND idReference=?",
            [newLessonLocation, updatedXml, Number(iduser), Number(selectedOrg)]
        );

        res.json({
            success: true,
            message: "✅ Slide aggiornata con successo",
            oldLessonLocation,
            newLessonLocation,
            affectedRows: result.affectedRows,
        });
    } catch (err) {
        console.error("❌ Errore in /api/scorm/cambiaslide:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/ricrea-test", async (req, res) => {
    const { db, iduser, idcourse } = req.body;
    if (!db || !iduser || !idcourse) {
        return res.status(400).json({ error: "Parametri mancanti" });
    }

    try {
        const conn = await getConnection(db);

        const [targetRows] = await conn.query(
            `SELECT lt.idtrack, lt.idtest
             FROM learning_testtrack lt
             WHERE lt.iduser=? AND lt.idreference IN (
                 SELECT idorg FROM learning_organization WHERE idcourse=? AND isterminator=1
             )
             ORDER BY lt.date_attempt DESC
             LIMIT 1`,
            [iduser, idcourse]
        );

        if (!targetRows.length) {
            return res.status(404).json({ error: "Nessun tentativo test trovato per questo utente" });
        }

        const target = targetRows[0];

        const [sourceRows] = await conn.query(
            `SELECT lt.idtrack, lt.score
             FROM learning_testtrack lt
             WHERE lt.idtest=? AND lt.idtrack <> ?
             ORDER BY (lt.score IS NULL), lt.score DESC, lt.date_attempt DESC
             LIMIT 1`,
            [target.idtest, target.idtrack]
        );

        if (!sourceRows.length) {
            return res.status(404).json({ error: "Nessun test valido da cui copiare i dati" });
        }

        const source = sourceRows[0];

        await conn.query(`DELETE FROM learning_testtrack_answer WHERE idtrack=?`, [target.idtrack]);

        const [insertResult] = await conn.query(
            `INSERT INTO learning_testtrack_answer
             (idTrack, idQuest, idAnswer, score_assigned, more_info, manual_assigned, user_answer, number_time, created_at, updated_at, idtemp)
             SELECT ?, idQuest, idAnswer, score_assigned, more_info, manual_assigned, user_answer, number_time, created_at, updated_at, idtemp
             FROM learning_testtrack_answer
             WHERE idTrack=?`,
            [target.idtrack, source.idtrack]
        );

        await conn.query(
            `UPDATE learning_testtrack
             SET score=?
             WHERE idtrack=?`,
            [source.score, target.idtrack]
        );

        res.json({
            success: true,
            targetTrack: target.idtrack,
            sourceTrack: source.idtrack,
            copiedAnswers: insertResult.affectedRows || 0,
        });
    } catch (err) {
        console.error("ricrea-test ERR:", err);
        res.status(500).json({ error: "Errore durante la ricostruzione del test" });
    }
});


/**
 * Elimina autocertificazione (certificato assegnato)
 */
router.get("/deleteautocert", async (req, res) => {
    const { db, iduser, idcourse } = req.query;
    if (!db || !iduser || !idcourse) {
        return res.status(400).json({ error: "Parametri mancanti" });
    }

    const conn = await getConnection(db);
    try {
        const [result] = await conn.query(
            `DELETE FROM learning_certificate_assign WHERE id_user=? AND id_course=?`,
            [iduser, idcourse]
        );

        if (result.affectedRows > 0) {
            res.send("✅ Autocertificazione eliminata con successo. Puoi chiudere questa finestra.");
        } else {
            res.send("⚠️ Nessuna autocertificazione trovata per questo utente/corso.");
        }
    } catch (err) {
        console.error("❌ Errore deleteautocert:", err);
        res.status(500).send("Errore durante l'eliminazione: " + err.message);
    } finally {

    }
});

module.exports = router;
