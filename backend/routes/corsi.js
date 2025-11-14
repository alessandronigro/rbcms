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
    const { db, iduser, idcourse, nome, cognome, email, userid } = req.body;
    log(`📧 Reinvia mail → ${email}, ${nome} ${cognome}`);
    const result = await reinviamail({ db, iduser, idcourse, nome, cognome, email, userid });
    res.json({ success: true, message: "Mail reinviata (placeholder)" });
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


module.exports = router;