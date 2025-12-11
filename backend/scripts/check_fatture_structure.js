require("../loadEnv");
const { getConnection } = require("../dbManager");

async function check() {
    try {
        const conn = await getConnection("newformazione");

        // Mostra struttura tabella
        const [columns] = await conn.query("DESCRIBE fatturericevute");
        console.log("\n=== STRUTTURA TABELLA fatturericevute ===");
        columns.forEach(col => {
            console.log(`${col.Field.padEnd(25)} ${col.Type.padEnd(20)} ${col.Null === 'YES' ? 'NULL' : 'NOT NULL'}`);
        });

        // Mostra esempio di dati
        const [sample] = await conn.query(`
            SELECT xml, fatturapdf, fatturaxml, nomeattachment 
            FROM fatturericevute 
            WHERE YEAR(dataemissionefattura) = 2025 
            LIMIT 2
        `);

        console.log("\n=== ESEMPIO DATI (Gennaio 2025) ===");
        sample.forEach((row, i) => {
            console.log(`\nRiga ${i + 1}:`);
            console.log("xml:", row.xml ? row.xml.toString().substring(0, 100) : "(vuoto)");
            console.log("fatturapdf:", row.fatturapdf ? row.fatturapdf.toString().substring(0, 100) : "(vuoto)");
            console.log("fatturaxml:", row.fatturaxml ? row.fatturaxml.toString().substring(0, 100) : "(vuoto)");
            console.log("nomeattachment:", row.nomeattachment ? row.nomeattachment.toString().substring(0, 100) : "(vuoto)");
        });

        process.exit(0);
    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

check();
