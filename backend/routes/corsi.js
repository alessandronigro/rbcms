const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer");
const axios = require("axios");
const { getConnection } = require("../dbManager");
const {


    getLastTest,
    gettime,
} = require("../utils/helper");
const log = (...args) => console.log("📘 [CORSI]", ...args);

/**
 * Post sospendi / attiva corso
 */
router.post("/sospendi", async (req, res) => {
    const { db, iduser, idcourse, status = 1, host } = req.body;
    if (!db || !iduser || !idcourse) {
        return res.status(400).json({ error: "Parametri mancanti" });
    }

    const conn = await getConnection(host, db);
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
router.delete("/:db/:host/:iduser/:idcourse", async (req, res) => {
    const { db, host, iduser, idcourse } = req.params;
    const conn = await getConnection(host, db);

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
    const { db, host, iduser } = req.body;
    if (!db || !iduser) return res.status(400).json({ error: "Parametri mancanti" });

    const conn = await getConnection(host, db);
    try {
        await conn.query(
            `UPDATE learning_courseuser SET status = 1 WHERE idUser=? AND status>1`,
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
    const { email, nome, cognome } = req.body;
    log(`📧 Reinvia mail → ${email}, ${nome} ${cognome}`);
    res.json({ success: true, message: "Mail reinviata (placeholder)" });
});

/**
 * Cancella utente def.
 */
router.delete("/utenti/:db/:host/:iduser", async (req, res) => {
    const { db, host, iduser } = req.params;
    const conn = await getConnection(host, db);
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
    const { db, host, iduser, idcourse } = req.query;
    try {
        const conn = await getConnection(host, db);

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

        await getLastTest(idcourse, iduser, firstname, lastname, db, false, 1, res);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});







module.exports = router;