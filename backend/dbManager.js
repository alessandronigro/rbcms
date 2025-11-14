// backend/dbManager.js
const mysql = require("mysql2/promise");

const connections = {};

/**
 * 🔹 Mappa database → host (non serve più passare hostKey)
 */
const DB_MAP = {
    forma4: process.env.MYSQL_IFAD,
    formazionein: process.env.MYSQL_SITE,
    newformazionein: process.env.MYSQL_EFAD,      // ifad.formazioneintermediari.com
    efadnovastudia: process.env.MYSQL_NOVA,
    formatest: process.env.MYSQL_NOVA,// fallback     // efad.novastudia.academy
    fadassiac: process.env.MYSQL_SITE,           // fad.assiac.it
    formazionecondorb: process.env.MYSQL_SITE,     // efad.rb-academy.it
    rbservizi: process.env.MYSQL_IFAD,             // www.formazioneintermediari.com
    rb60h: process.env.MYSQL_IFAD,
    rbamministratore: process.env.MYSQL_SITE,
    rbacademy: process.env.MYSQL_SITE,
    newformazione: process.env.MYSQL_SITE,
    wpacquisti: process.env.MYSQL_EFAD,
    simplybiz: process.env.MYSQL_SIMPLY
};

/**
 * 🔧 Ottiene o crea un pool di connessioni MySQL in base al nome del database
 */
async function getConnection(dbName) {
    if (!dbName) throw new Error("❌ Database non specificato");

    const dbKey = dbName.toLowerCase();
    const host = DB_MAP[dbKey] || DB_MAP.default;
    const user = process.env.MYSQL_USER;
    const password = process.env.MYSQL_PASSWORD;

    if (!host) throw new Error(`❌ Host non definito per il database ${dbKey}`);

    const key = `${host}_${dbKey}`;
    if (!connections[key]) {
        console.log(`🧩 Creo nuovo pool per DB: ${dbKey} @ ${host}`);
        connections[key] = mysql.createPool({
            host,
            user,
            password,
            database: dbKey,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            charset: "utf8mb4",
            connectTimeout: 10000,
            enableKeepAlive: true,
            keepAliveInitialDelay: 0,
        });

        // 🧩 intercetta errori e resetta il pool se necessario
        connections[key].on("error", (err) => {
            console.error(`❌ MySQL pool error [${key}]:`, err.code);
            if (["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(err.code)) {
                console.warn(`⚠️ Ricreo il pool MySQL per ${key}...`);
                delete connections[key];
            }
        });
    }

    return connections[key];
}

module.exports = { getConnection };