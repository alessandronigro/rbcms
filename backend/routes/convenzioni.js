const express = require("express");
const router = express.Router();
const { getConnection } = require("../dbManager");


function normalizeWebField(dbName) {
    if (dbName === "forma4") return "newindirizzoweb";
    if (dbName === "newformazionein") return "indirizzoweb";
    return "oldindirizzoweb";
}

/***************************************
* ✅ LISTA CONVENZIONI
***************************************/
/***************************************
* ✅ LISTA CONVENZIONI con FILTRI
***************************************/
/***************************************
* ✅ LISTA CONVENZIONI con FILTRI (default = attive)
***************************************/
router.get("/", async (req, res) => {
    try {
        const { visibile, filtro } = req.query;
        const conn = await getConnection("EFAD", "wpacquisti");

        let sql = `
            SELECT Codice, Name, indirizzoweb, visibilita, tipo, ref1, excel
            FROM newconvenzioni
        `;

        const where = [];

        // 🔹 Se non c'è filtro visibile, di default mostra SOLO attive
        if (visibile === undefined || visibile === "" || visibile === "null") {
            where.push(`visibilita = 1`);
        } else if (visibile === "0" || visibile === "1") {
            where.push(`visibilita = ${conn.escape(visibile)}`);
        }

        // 🔹 Filtro tipo convenzione (SNA / RB Academy / ecc.)
        if (filtro) {
            switch (filtro) {
                case "2": // SNA
                    where.push(`Name LIKE '%SNA%'`);
                    break;
                case "3": // RB Academy
                    where.push(`Name LIKE '%RB Academy%'`);
                    break;
                default:
                    // se filtro numerico o stringa specifica
                    if (filtro !== "0") where.push(`Name = ${conn.escape(filtro)}`);
                    break;
            }
        }

        // 🔹 Componi query finale
        if (where.length > 0) sql += " WHERE " + where.join(" AND ");
        sql += " ORDER BY Name";

        const [rows] = await conn.query(sql);
        res.json(rows);
    } catch (err) {
        console.error("GET convenzioni ERR:", err.message);
        res.status(500).json({ error: "Errore lettura convenzioni" });
    }
});
/***************************************
* ✅ CREA NUOVA CONVENZIONE
***************************************/
router.post("/", async (req, res) => {
    try {
        const { codice, nome } = req.body;
        if (!codice || !nome) {
            return res.status(400).json({ error: "Codice e nome obbligatori" });
        }

        const conn = await getConnection("EFAD", "wpacquisti");

        // Controllo duplicati
        const [exists] = await conn.query(
            "SELECT Codice FROM newconvenzioni WHERE Codice = ? LIMIT 1",
            [codice]
        );
        if (exists.length) {
            return res.status(409).json({ error: "Codice già esistente" });
        }

        await conn.query(
            "INSERT INTO newconvenzioni (Codice, Name, visibilita, indirizzoweb, ref1) VALUES (?, ?, 1, '', '')",
            [codice, nome]
        );

        res.json({ success: true, message: "Convenzione creata con successo" });
    } catch (err) {
        console.error("POST convenzione ERR:", err.message);
        res.status(500).json({ error: "Errore creazione convenzione" });
    }
});

/***************************************
* ✅ ELIMINA CONVENZIONE
***************************************/
router.delete("/:codice", async (req, res) => {
    try {
        const conn = await getConnection("EFAD", "wpacquisti");

        // Elimina eventuali riferimenti collegati (opzionale)
        await conn.query("DELETE FROM tblprezzi WHERE Codice = ?", [req.params.codice]);
        await conn.query("DELETE FROM newconvenzioni WHERE Codice = ?", [req.params.codice]);

        res.json({ success: true });
    } catch (err) {
        console.error("DELETE convenzione ERR:", err.message);
        res.status(500).json({ error: "Errore eliminazione convenzione" });
    }
});
/***************************************
* ✅ DETTAGLIO CONVENZIONE
***************************************/
router.get("/:codice", async (req, res) => {
    try {
        const conn = await getConnection("EFAD", "wpacquisti");
        const [rows] = await conn.query(
            "SELECT * FROM newconvenzioni WHERE Codice = ? LIMIT 1",
            [req.params.codice]
        );

        if (!rows.length) return res.status(404).json({ error: "Non trovata" });
        res.json(rows[0]);
    } catch (err) {
        console.error("GET codice ERR:", err.message);
        res.status(500).json({ error: "Errore lettura" });
    }
});

/***************************************
* ✅ UPDATE DETTAGLI CONVENZIONE
***************************************/
router.put("/:codice", async (req, res) => {
    try {
        const data = req.body;
        const conn = await getConnection("EFAD", "wpacquisti");
        const updates = Object.keys(data).map(k => `${k} = ?`).join(", ");
        const values = [...Object.values(data), req.params.codice];

        await conn.query(
            `UPDATE newconvenzioni SET ${updates} WHERE Codice = ?`,
            values
        );

        res.json({ success: true });
    } catch (err) {
        console.error("PUT convenzione ERR:", err.message);
        res.status(500).json({ error: "Errore aggiornamento" });
    }
});

/***************************************
* ✅ PREZZI per codice corso
***************************************/
router.post("/:codice/prezzi", async (req, res) => {
    try {
        const { codiceCorso, prezzo } = req.body;
        const conn = await getConnection("EFAD", "wpacquisti");

        await conn.query(
            `INSERT INTO tblprezzi (Codice, corso, prezzo)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE prezzo = VALUES(prezzo)`,
            [req.params.codice, codiceCorso, prezzo]
        );

        res.json({ success: true });
    } catch (err) {
        console.error("SAVE prezzo ERR:", err.message);
        res.status(500).json({ error: "Errore salvataggio prezzo" });
    }
});

/***************************************
* ✅ FULL — SOLO corsi di tblprezzi (IFAD forma4), storico per varianti
***************************************/
router.get("/:codice/full", async (req, res) => {
    const { codice } = req.params;

    try {
        // Connessioni
        const connWP = await getConnection("EFAD", "wpacquisti");       // 2011→2018
        const connIFAD = await getConnection("IFAD", "forma4");             // 2025→oggi
        const connEFAD = await getConnection("EFAD", "newformazionein");    // 2018→2024
        const connSITE = await getConnection("SITE", "formazionein");       // 2011→2018

        // 1) Convenzione
        const [conv] = await connWP.query(
            "SELECT * FROM newconvenzioni WHERE Codice = ? LIMIT 1",
            [codice]
        );
        if (!conv.length) return res.json({ error: "Convenzione non trovata" });

        const convenzione = conv[0];
        const nomeConv = convenzione.Name;

        // 2) Lista corsi per la convenzione (SOLO da tblprezzi) → base canonica
        const [prezziRows] = await connWP.query(
            "SELECT corso AS codice, prezzo FROM tblprezzi WHERE Codice = ? ORDER BY corso ASC",
            [codice]
        );

        // 3) Anni 2011→oggi (desc)
        const currentYear = new Date().getFullYear();
        const years = [];
        for (let y = currentYear; y >= 2011; y--) years.push(y);

        // 4) Query unica per DB → YEAR + CODE (niente filtro per code qui)
        const qYearCode = `
      SELECT YEAR(a.date_inscr) AS y, c.code
      FROM learning_courseuser a
      LEFT JOIN core_field_userentry b ON a.idUser = b.id_user
      JOIN learning_course c ON c.idCourse = a.idcourse
      WHERE b.id_common = 25
        AND b.user_entry = ?
        AND a.date_inscr BETWEEN ? AND ?
    `;

        // finestre temporali per ciascun DB
        const winSITE = ["2011-01-01 00:00:00", "2018-12-31 23:59:59"];
        const winEFAD = ["2018-01-01 00:00:00", "2024-12-31 23:59:59"];
        const winIFAD = ["2025-01-01 00:00:00", `${currentYear}-12-31 23:59:59`];

        const [rowsSITE] = await connSITE.query(qYearCode, [nomeConv, winSITE[0], winSITE[1]]);
        const [rowsEFAD] = await connEFAD.query(qYearCode, [nomeConv, winEFAD[0], winEFAD[1]]);
        const [rowsIFAD] = await connIFAD.query(qYearCode, [nomeConv, winIFAD[0], winIFAD[1]]);

        const allRows = [...rowsSITE, ...rowsEFAD, ...rowsIFAD];

        // 5) Normalizza → mappa contatori per CODE (string) e anno
        //    (case-sensitive by default: JS confronta stringhe in modo case-sensitive)
        const countsByCodeYear = new Map(); // key: code → value: { [year]: count }
        for (const r of allRows) {
            const code = String(r.code || "");
            const y = Number(r.y);
            if (!code || !Number.isInteger(y)) continue;

            if (!countsByCodeYear.has(code)) {
                const init = {};
                for (const yy of years) init[yy] = 0;
                countsByCodeYear.set(code, init);
            }
            countsByCodeYear.get(code)[y] += 1;
        }

        // 6) Nomi corsi (per canonical) presi da IFAD (forma4) → code = canonical
        const canonicalCodes = prezziRows.map(r => r.codice);
        const placeholders = canonicalCodes.map(() => "?").join(",");
        let nameByCanonical = new Map();
        if (canonicalCodes.length) {
            const [namesIFAD] = await connIFAD.query(
                `SELECT code, name FROM learning_course WHERE code IN (${placeholders})`,
                canonicalCodes
            );
            nameByCanonical = new Map(namesIFAD.map(r => [r.code, r.name]));
        }

        // 7) Regole di mappatura varianti → canonical
        //    (match tramite "startsWith" su prefissi indicati)
        const prefixMap = [
            { prefix: "cod60", canon: "cod6035" },
            { prefix: "cod30", canon: "cod3035" },
            { prefix: "codoam15", canon: "codOAM1535" },
            { prefix: "codoam30", canon: "codOAM3035" },
            { prefix: "codoam45", canon: "codOAM4535" }, // correzione "IAM" → "OAM"
            { prefix: "codoam9", canon: "codOAM935" },
            { prefix: "codoampv", canon: "codOAMpv35" },
        ];

        const toCanon = (code) => {
            const low = code.toLowerCase();
            for (const m of prefixMap) {
                if (low.startsWith(m.prefix)) return m.canon;
            }
            // default: il codice resta se coincide esattamente con un canonical noto
            return canonicalCodes.includes(code) ? code : null;
        };

        // 8) Pre-aggregazione: per ogni codice "grezzo" → somma in canonical
        const countsByCanonical = new Map(); // key canon → {year: tot}
        for (const code of countsByCodeYear.keys()) {
            const canon = toCanon(code);
            if (!canon) continue; // ignora codici fuori mappatura
            if (!countsByCanonical.has(canon)) {
                const init = {};
                for (const yy of years) init[yy] = 0;
                countsByCanonical.set(canon, init);
            }
            const src = countsByCodeYear.get(code);
            const dst = countsByCanonical.get(canon);
            for (const yy of years) dst[yy] += (src[yy] || 0);
        }

        // 9) Costruzione corsi finali:
        //    - solo i canonical presenti in tblprezzi per questa convenzione
        //    - escludi codOAM4
        //    - mostra righe SOLO se prezzo>0 oppure somma counts>0 (regola ABC)
        const items = [];
        for (const row of prezziRows) {
            const canon = row.codice;
            if (canon === "codOAM4") continue; // esclusione richiesta

            // counts (se non presenti, inizializza a zero)
            const ymap = countsByCanonical.get(canon) || (() => {
                const init = {}; for (const yy of years) init[yy] = 0; return init;
            })();

            // somma totale iscritti
            let total = 0;
            for (const yy of years) total += (ymap[yy] || 0);

            const prezzoStr = (row.prezzo == null ? "" : String(row.prezzo));
            const prezzoNum = Number(prezzoStr.replace(",", "."));
            const hasPrice = !Number.isNaN(prezzoNum) && prezzoNum > 0;

            // ABC: mostralo solo se (prezzo > 0) OR (tot iscritti > 0)
            if (!hasPrice && total === 0) {
                continue;
            }

            // Nome: da IFAD forma4 se disponibile, altrimenti usa il canonical
            const nome = nameByCanonical.get(canon) || canon;

            items.push({
                codice: canon,
                nome,
                prezzo: prezzoStr === "" ? "" : String(prezzoStr),
                years: ymap
            });
        }

        // 10) Ordina per codice ASC
        items.sort((a, b) => a.codice.localeCompare(b.codice));

        // 11) Log di debug utili
        console.log("📌 Convenzione:", nomeConv);
        console.log("📌 Corsi (tblprezzi):", prezziRows.map(r => r.codice));
        console.log("📌 Years:", years);
        console.log("📌 Rows SITE:", rowsSITE.length, "EFAD:", rowsEFAD.length, "IFAD:", rowsIFAD.length);
        console.log("📌 Canon disponibili:", [...countsByCanonical.keys()]);
        console.log("📌 Final rows:", items.length);
        if (items[0]) {
            console.log("📌 Esempio prima riga:", {
                codice: items[0].codice,
                prezzo: items[0].prezzo,
                somma: years.reduce((s, y) => s + (items[0].years[y] || 0), 0),
                anni: items[0].years
            });
        }

        // 12) Risposta
        return res.json({
            convenzione,
            corsi: items,
            years
        });

    } catch (err) {
        console.error("❌ FULL ERR:", err.stack || err.message);
        res.status(500).json({ error: "Errore aggregazione dati" });
    }
});

module.exports = router;