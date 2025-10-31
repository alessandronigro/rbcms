const mysql = require("mysql2/promise");

const connections = {};

/**
 * 🔹 Determina l'host da usare in base alla chiave host della dbMap
 */
function resolveHost(hostKey) {
    switch (hostKey.toUpperCase()) {
        case "IFAD":
            return process.env.MYSQL_IFAD; // ifad.formazioneintermediari.com
        case "EFAD":
            return process.env.MYSQL_EFAD; // efad.formazioneintermediari.com
        case "SITE":
            return process.env.MYSQL_SITE; // www.formazioneintermediari.com
        case "SIMPLY":
            return process.env.MYSQL_SIMPLY; // simplybiz è sullo stesso host
        case "NOVA":
            return process.env.MYSQL_NOVA; // efadnovastudia sta su EFAD
        default:
            throw new Error(`❌ Host non definito per chiave ${hostKey}`);
    }
}

/**
 * 🔧 Ottiene o crea un pool di connessioni MySQL per host/db specificato
 */
async function getConnection(hostKey = "IFAD", dbName = process.env.MYSQL_DATABASE) {
    const host = resolveHost(hostKey);
    const user = process.env.MYSQL_USER;
    const password = process.env.MYSQL_PASSWORD;

    if (!host) throw new Error(`❌ Host non definito per MYSQL_${hostKey}`);
    if (!dbName) throw new Error(`❌ Database non definito`);

    const key = `${hostKey}_${dbName}`;
    if (!connections[key]) {
        connections[key] = mysql.createPool({
            host,
            user,
            password,
            database: dbName,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            charset: "utf8mb4",
            connectTimeout: 10000,   // ⏱ 10s per connettersi
            enableKeepAlive: true,
            keepAliveInitialDelay: 0,
            // timeouts di rete brevi
            socketTimeout: 15000,    // ⏱ 15s max per risposte lente
            timeout: 15000,
        });

        // 🧩 intercetta errori critici e ricrea automaticamente il pool
        connections[key].on("error", (err) => {
            console.error(`❌ MySQL pool error [${key}]:`, err.code);
            if (
                ["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(
                    err.code
                )
            ) {
                console.warn(`⚠️ Ricreo il pool MySQL per ${key}...`);
                delete connections[key];
            }
        });
    }

    return connections[key];
}

module.exports = { getConnection };