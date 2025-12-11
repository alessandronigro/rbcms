// backend/scripts/verifyMysql.js
// Utility to verify MySQL connections defined in dbManager.js

const { getConnection, getPoolStats, DB_MAP } = require('../dbManager');

async function verifyAll() {
    const results = [];
    for (const [dbKey, host] of Object.entries(DB_MAP)) {
        try {
            const pool = await getConnection(dbKey);
            // simple test query
            await pool.query('SELECT 1');
            results.push({ db: dbKey, host, status: 'OK' });
        } catch (err) {
            results.push({ db: dbKey, host, status: 'FAIL', error: err.message });
        }
    }
    console.table(results);
    // optional: show pool stats
    const stats = await getPoolStats();
    console.log('Pool stats:', stats);
}

if (require.main === module) {
    verifyAll().catch(err => {
        console.error('Verification failed:', err);
        process.exit(1);
    });
}

module.exports = { verifyAll };
