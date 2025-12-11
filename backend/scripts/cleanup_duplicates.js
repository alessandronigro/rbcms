// Script per pulire le fatture duplicate dal database
const { getConnection } = require('../dbManager');

async function cleanupDuplicates(tableName) {
    console.log(`\n🔍 Pulizia duplicati per tabella: ${tableName}`);
    const conn = await getConnection('newformazione');

    try {
        // Trova gruppi di fatture duplicate (stesso numero + intestatario)
        const [duplicateGroups] = await conn.query(`
            SELECT 
                numerofattura,
                intestatario,
                COUNT(*) as count
            FROM ${tableName}
            WHERE numerofattura != '' AND intestatario != ''
            GROUP BY numerofattura, intestatario
            HAVING count > 1
            ORDER BY count DESC
        `);

        console.log(`📊 Trovati ${duplicateGroups.length} gruppi di fatture duplicate\n`);

        let totalDeleted = 0;

        for (const group of duplicateGroups) {
            const { numerofattura, intestatario, count } = group;

            // Trova tutte le fatture di questo gruppo
            const [invoices] = await conn.query(`
                SELECT id, importofattura, dataemissionefattura, xml
                FROM ${tableName}
                WHERE numerofattura = ? AND intestatario = ?
                ORDER BY 
                    CASE WHEN CAST(REPLACE(REPLACE(importofattura, ',', '.'), '-', '') AS DECIMAL(10,2)) > 0 THEN 0 ELSE 1 END,
                    dataemissionefattura DESC,
                    id ASC
            `, [numerofattura, intestatario]);

            if (invoices.length <= 1) continue;

            // Mantieni la prima (quella con importo > 0 o la più recente)
            const toKeep = invoices[0];
            const toDelete = invoices.slice(1);

            console.log(`📄 ${numerofattura} - ${intestatario.substring(0, 30)}...`);
            console.log(`   ✅ Mantengo: ID ${toKeep.id} (importo: ${toKeep.importofattura})`);

            // Elimina i duplicati
            for (const invoice of toDelete) {
                await conn.query(`DELETE FROM ${tableName} WHERE id = ?`, [invoice.id]);
                console.log(`   ❌ Eliminato: ID ${invoice.id} (importo: ${invoice.importofattura})`);
                totalDeleted++;
            }
        }

        console.log(`\n✅ Pulizia completata per ${tableName}`);
        console.log(`   Gruppi duplicati: ${duplicateGroups.length}`);
        console.log(`   Record eliminati: ${totalDeleted}\n`);

        return totalDeleted;

    } catch (err) {
        console.error(`❌ Errore durante la pulizia di ${tableName}:`, err);
        throw err;
    }
}

async function main() {
    console.log('🧹 Inizio pulizia duplicati fatture...\n');

    try {
        const deleted1 = await cleanupDuplicates('fatturericevute');
        const deleted2 = await cleanupDuplicates('fatturericevutenew');

        console.log('✅ Pulizia completata con successo!');
        console.log(`   Totale record eliminati: ${deleted1 + deleted2}`);

        process.exit(0);
    } catch (err) {
        console.error('❌ Errore durante la pulizia:', err);
        process.exit(1);
    }
}

main();
