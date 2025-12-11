// backend/dbManager.js
require("./loadEnv"); // carica le variabili dall'env corretto (dev/prod)
const mysql = require("mysql2/promise");
const connections = {};
const lastHeartbeat = {};

/**
 * 🔹 Mappa database → host (MYQSL remoto)
 */
const DB_MAP = {
    forma4: process.env.MYSQL_IFAD,
    formazionein: process.env.MYSQL_SITE,
    newformazionein: process.env.MYSQL_EFAD,
    efadnovastudia: process.env.MYSQL_NOVA,
    formatest: process.env.MYSQL_NOVA,
    fadassiac: process.env.MYSQL_SITE,
    formazionecondorb: process.env.MYSQL_SITE,
    rbservizi: process.env.MYSQL_IFAD,
    rb60h: process.env.MYSQL_IFAD,
    rbamministratore: process.env.MYSQL_SITE,
    rbacademy: process.env.MYSQL_SITE,
    newformazione: process.env.MYSQL_SITE,
    wpacquisti: process.env.MYSQL_EFAD,
    simplybiz: process.env.MYSQL_SIMPLY,
    novastudia: process.env.MYSQL_NOVA,
};


/* ---------------------------------------------------------
   ❤️ HEARTBEAT: mantieni viva ogni connessione del pool
--------------------------------------------------------- */
async function heartbeat(pool, key) {
    try {
        // evita heartbeat troppo frequenti
        if (lastHeartbeat[key] && Date.now() - lastHeartbeat[key] < 15000) return;

        lastHeartbeat[key] = Date.now();
        await pool.query("SELECT 1");

    } catch (err) {
        console.error(`💔 Heartbeat fallito per pool ${key}:`, err.code);
        console.warn("Ricreo il pool...");

        delete connections[key]; // pool invalidato
    }
}


/* ---------------------------------------------------------
   🔧 CREA O RECUPERA UNA CONNESSIONE
--------------------------------------------------------- */
async function getPoolStats() {
    const stats = [];
    for (const [key, pool] of Object.entries(connections)) {
        const total = Array.isArray(pool._allConnections) ? pool._allConnections.length : 0;
        const free = Array.isArray(pool._freeConnections) ? pool._freeConnections.length : 0;
        const queue = Array.isArray(pool._connectionQueue) ? pool._connectionQueue.length : 0;
        const stat = {
            key,
            host: pool.config && pool.config.host,
            database: pool.config && pool.config.database,
            total,
            free,
            active: Math.max(total - free, 0),
            queue,
            processListTotal: 0,
            processListActive: 0,
            processListSleeping: 0,
            longestRunningSeconds: 0,
        };

        try {
            const [rows] = await pool.query("SHOW FULL PROCESSLIST");
            stat.processListTotal = rows.length;
            for (const row of rows) {
                const command = (row.Command || row.command || "").toString().toLowerCase();
                const time = Number(row.Time || row.time || 0);
                if (command && command !== "sleep") {
                    stat.processListActive += 1;
                } else {
                    stat.processListSleeping += 1;
                }
                if (!Number.isNaN(time) && time > stat.longestRunningSeconds) {
                    stat.longestRunningSeconds = time;
                }
            }
        } catch (err) {
            console.warn(`⚠️ Impossibile leggere PROCESSLIST per ${key}:`, err.message);
        }

        stats.push(stat);
    }
    return stats;
}

async function getConnection(dbName) {
    if (!dbName) throw new Error("❌ Database non specificato");

    const dbKey = dbName.toLowerCase();
    const host = DB_MAP[dbKey];
    const user = process.env.MYSQL_USER;
    const password = process.env.MYSQL_PASSWORD;

    if (!host) throw new Error(`❌ Host non definito per database: ${dbKey}`);

    const key = `${host}_${dbKey}`;

    // Pool già esistente
    if (connections[key]) {
        heartbeat(connections[key], key).catch(() => { });
        return connections[key];
    }

    // ➕ CREA NUOVO POOL
    console.log(`🧩 Creo nuovo pool per DB: ${dbKey} @ ${host}`);

    const pool = mysql.createPool({
        host,
        user,
        password,
        database: dbKey,
        waitForConnections: true,
        connectionLimit: 5,           // ridotto a 5 connessioni per pool
        queueLimit: 0,
        charset: "utf8mb4",
        idleTimeout: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 1000,
        connectionLimit: 2,
        acquireTimeout: 60000,
        connectTimeout: 60000,
    });

    // Listener errori critici → ricrea pool
    pool.on("error", (err) => {
        console.error(`❌ MySQL pool error [${key}]:`, err.code);
        if (["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(err.code)) {
            console.warn(`⚠️ Ricreo il pool per ${key}...`);
            delete connections[key];
        }
    });

    // 🔄 Heartbeat automatico ogni 60 secondi
    setInterval(() => heartbeat(pool, key), 60000);

    connections[key] = pool;
    return pool;
}

module.exports = { getConnection, getPoolStats, DB_MAP };
