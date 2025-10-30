const express = require("express");
const axios = require("axios");
const router = express.Router();
const { getConnection } = require("../dbManager");
const { convertSecToDate } = require("../utils/helper");

// 🔹 Mappa piattaforme → host e database
const dbMap = {
    rbformazione: {
        IFAD: ["forma4"],
        EFAD: ["newformazionein"],
        SITE: ["formazionein"],
    },
    simplybiz: {
        SIMPLY: ["simplybiz"],
    },
    novastudia: {
        NOVA: ["efadnovastudia"],
    },
    assiac: {
        SITE: ["formazionecondo", "formazionecondorb"],
    },
};

// 🔹 Helper: costruisce la query come nel codice VB
function buildQuery({ nome = "", cognome = "", nominativo = "" }) {
    let sql = "";
    let params = [];

    if (cognome && nome) {
        sql = `
            SELECT lastname, firstname, register_date, idst, userid, lastenter, user_entry
            FROM core_user a
            JOIN core_field_userentry b ON a.idst = b.id_user
            WHERE b.id_common = 23
              AND lastname = ?
              AND firstname = ?
            ORDER BY lastname, firstname
        `;
        params = [cognome, nome];
    } else if (cognome) {
        sql = `
            SELECT DISTINCT lastname, firstname, user_entry, idst
            FROM core_user a
            JOIN core_field_userentry b ON a.idst = b.id_user
            WHERE b.id_common = 23
              AND lastname = ?
            ORDER BY lastname, firstname
        `;
        params = [cognome];
    } else if (nome) {
        sql = `
            SELECT DISTINCT lastname, firstname, user_entry, idst
            FROM core_user a
            JOIN core_field_userentry b ON a.idst = b.id_user
            WHERE b.id_common = 23
              AND firstname = ?
            ORDER BY lastname, firstname
        `;
        params = [nome];
    } else if (nominativo) {
        sql = `
            SELECT DISTINCT lastname, firstname, user_entry, idst
            FROM core_user a
            JOIN core_field_userentry b ON a.idst = b.id_user
            WHERE b.id_common = 23
              AND (
                    firstname LIKE ? 
                 OR lastname LIKE ?
                 OR a.email LIKE ?
              )
            ORDER BY lastname, firstname
        `;
        params = [`%${nominativo}%`, `%${nominativo}%`, `%${nominativo}%`];
    } else {
        sql = `
            SELECT DISTINCT lastname, firstname, user_entry , idst
            FROM core_user a
            JOIN core_field_userentry b ON a.idst = b.id_user
            WHERE b.id_common = 23
              AND (firstname = ? AND lastname LIKE ?)
            ORDER BY lastname, firstname
        `;
        params = [nome, `%${cognome}%`];
    }

    return { sql, params };
}

// 🔍 Ricerca multi-database
router.get("/multi", async (req, res) => {
    const { main, nome = "", cognome = "", nominativo = "" } = req.query;

    // Determina gruppo (piattaforma)
    let groupKey = null;
    if (["formazionein", "newformazionein", "forma4"].includes(main)) groupKey = "rbformazione";
    else if (main === "simplybiz") groupKey = "simplybiz";
    else if (main === "efadnovastudia") groupKey = "novastudia";
    else if (["formazionecondo", "formazionecondorb"].includes(main)) groupKey = "assiac";

    if (!groupKey || !dbMap[groupKey]) {
        return res.status(400).json({ error: `Main '${main}' non valido` });
    }

    const { sql, params } = buildQuery({ nome, cognome, nominativo });
    const results = {};

    try {
        await Promise.all(
            Object.entries(dbMap[groupKey]).flatMap(([hostKey, dbList]) =>
                dbList.map(async (dbName) => {
                    const label = `${hostKey}_${dbName}`;
                    try {
                        const conn = await getConnection(hostKey, dbName);
                        const [rows] = await conn.query(sql, params);

                        results[label] = {
                            status: "ok",
                            count: rows.length,
                            data: rows,
                        };

                        if (conn.release) conn.release(); // ✅ AGGIUNTO
                    } catch (err) {
                        console.error(`❌ Errore su ${label}:`, err.message);
                        results[label] = { status: "error", message: err.message };
                    }
                })
            )
        );

        res.json({ results });
    } catch (err) {
        console.error("❌ Errore ricerca multi:", err);
        res.status(500).json({ error: "Errore nella ricerca combinata", details: err.message });
    }
});

router.get("/detail", async (req, res) => {
    const { host, db, firstname, lastname, user_entry } = req.query;
    if (!host || !db || !firstname || !lastname || !user_entry)
        return res.status(400).json({ error: "Parametri mancanti" });


    const conn = await getConnection(host, db);

    // 1️⃣ Utente base
    const [userRows] = await conn.query(
        `SELECT firstname, lastname, userid, idst,lastenter,  DATE_FORMAT(register_date, '%d/%m/%Y %H:%i:%s') AS register_date, email
         FROM core_user a
         JOIN core_field_userentry b ON a.idst = b.id_user
         WHERE lastname = ? AND firstname = ? AND b.id_common = 23 AND user_entry = ?
         ORDER BY register_date ASC`,
        [lastname, firstname, user_entry]
    );
    if (userRows.length === 0) return res.status(404).json({ error: "Utente non trovato" });
    const user = userRows[0];

    // 2️⃣ Campi anagrafici
    const [extra] = await conn.query(
        `SELECT translation, user_entry
         FROM core_field_userentry a
         LEFT JOIN core_field b ON b.id_common = a.id_common
         WHERE a.id_user = ?
         ORDER BY b.sequence ASC`,
        [user.idst]
    );


    // ✅ 3️⃣ Corsi iscritti + dati completi
    const [courses] = await conn.query(
        `
    SELECT 
        cu.idCourse,
        c.code,
        c.name,
        DATE_FORMAT(cu.date_inscr, '%d/%m/%Y %H:%i:%s') AS date_inscr,
        DATE_FORMAT(cu.date_complete, '%d/%m/%Y %H:%i:%s') AS date_complete,
        DATE_FORMAT(cu.date_expire_validity, '%d/%m/%Y %H:%i:%s') AS date_expire_validity,
        cu.status,
        cu.idUser,

        (
            SELECT SUM(TIME_TO_SEC(TIMEDIFF(lasttime, entertime)))
            FROM learning_tracksession 
            WHERE idUser = cu.idUser
              AND idCourse = cu.idCourse
        ) AS ore_totali,

        DATE_FORMAT((
            SELECT MAX(lasttime)
            FROM learning_tracksession
            WHERE idCourse = cu.idCourse
              AND idUser = cu.idUser
        ), '%d/%m/%Y %H:%i:%s') AS last_access_course,

        DATE_FORMAT((
            SELECT lastenter
            FROM core_user
            WHERE idst = cu.idUser
        ), '%d/%m/%Y %H:%i:%s') AS last_access_platform,

        (
            SELECT 1
            FROM learning_certificate_assign
            WHERE id_course = cu.idCourse
              AND id_user = cu.idUser
            LIMIT 1
        ) AS doc_fine_corso,

        (
            SELECT DATE_FORMAT(on_date, '%d/%m/%Y %H:%i:%s')
            FROM learning_certificate_assign
            WHERE id_course = cu.idCourse
              AND id_user = cu.idUser
            LIMIT 1
        ) AS doc_fine_corso_data

    FROM learning_courseuser cu
    JOIN learning_course c ON cu.idCourse = c.idCourse
    WHERE cu.idUser = ?
    ORDER BY cu.date_inscr ASC
    `,
        [user.idst]
    );

    let addressDocebo = "";
    switch (db) {
        case "forma4":
            addressDocebo = "https://ifad.formazioneintermediari.com";
            break;
        case "efadnovastudia":
            addressDocebo = "https://efad.novastudia.academy";
            break;
        case "fadassiac":
            addressDocebo = "http://fad.assiac.it";
            break;
        case "formazionecondorb":
            addressDocebo = "http://efad.rb-academy.it";
            break;
    }

    // 🔹 Calcola ore_video per ogni corso
    for (const c of courses) {

        c.ore_totali = convertSecToDate(c.totaltime);

        try {
            const url = `${addressDocebo}/gettime.php?database=${db}&idCourse=${c.idCourse}&iduser=${user.idst}`;
            const r = await axios.get(url);
            c.ore_video = r.data || "N/D";
        } catch (err) {
            console.warn(`⚠️ Errore ore_video per corso ${c.idCourse}:`, err.message);
            c.ore_video = "N/D";
        }
    }

    // 4️⃣ Certificati
    const [cert] = await conn.query(
        `SELECT COUNT(*) as count,  DATE_FORMAT(on_date, '%d/%m/%Y %H:%i:%s') AS on_date,  DATE_FORMAT(data_invio, '%d/%m/%Y %H:%i:%s') AS data_invio
         FROM learning_certificate_assign WHERE id_User = ?
        GROUP BY id_User`,
        [user.idst]
    );


    const convenzioneField = extra.find(
        (f) => f.translation?.toLowerCase() === "convenzione"
    );
    const convenzione = convenzioneField?.user_entry || null;

    // 🔹 Seleziona il campo indirizzo corretto in base al database
    let indirizzoField;
    if (db === "formazionein") indirizzoField = "oldindirizzoweb";
    else if (db === "newformazionein") indirizzoField = "indirizzoweb";
    else indirizzoField = "newindirizzoweb";

    const [rows] = await conn.query(
        `SELECT ${indirizzoField} AS address FROM wpacquisti.newconvenzioni WHERE name = ? LIMIT 1`,
        [convenzione]
    );
    const address = rows?.[0]?.address || "https://ifad.formazioneintermediari.com";
    res.json({
        user,
        fields: extra,
        courses,
        certificates: cert,
        address,
        host,
        db
    });
});

module.exports = router;