// Script per eliminare fatture con importo a 0
const { getConnection } = require('../dbManager');

async function deleteZeroAmountInvoices(tableName) {
    console.log(`\n🔍 Analisi fatture a 0 per tabella: ${tableName}`);
    const conn = await getConnection('newformazione');

    try {
        // Conta le fatture con importo 0
        // Gestiamo vari formati di 0 (0, 0.00, 0,00) e conversioni da stringa
        const [countResult] = await conn.query(`
            SELECT COUNT(*) as count 
            FROM ${tableName}
            WHERE 
                importofattura = '0' OR 
                importofattura = '0.00' OR 
                importofattura = '0,00' OR
                CAST(REPLACE(REPLACE(importofattura, ',', '.'), '-', '') AS DECIMAL(10,2)) = 0
        `);

        const count = countResult[0].count;

        if (count === 0) {
            console.log(`   ✅ Nessuna fattura con importo 0 trovata.`);
            return 0;
        }

        console.log(`   ⚠️  Trovate ${count} fatture con importo 0.`);

        // Esegui l'eliminazione
        const [deleteResult] = await conn.query(`
            DELETE FROM ${tableName}
            WHERE 
                importofattura = '0' OR 
                importofattura = '0.00' OR 
                importofattura = '0,00' OR
                CAST(REPLACE(REPLACE(importofattura, ',', '.'), '-', '') AS DECIMAL(10,2)) = 0
        `);

        console.log(`   🗑️  Eliminate ${deleteResult.affectedRows} fatture.`);
        return deleteResult.affectedRows;

    } catch (err) {
        console.error(`❌ Errore durante l'eliminazione in ${tableName}:`, err);
        throw err;
    }
}

async function main() {
    console.log('🧹 Inizio eliminazione fatture con importo 0...\n');

    try {
        const deleted1 = await deleteZeroAmountInvoices('fatturericevute');
        const deleted2 = await deleteZeroAmountInvoices('fatturericevutenew');

        console.log('\n✅ Operazione completata!');
        console.log(`   Totale fatture eliminate: ${deleted1 + deleted2}`);
        console.log(`\nℹ️  Nota: Le fatture eliminate verranno riscaricate alla prossima sincronizzazione.`);
        console.log(`   Se sono file XML standard, verranno aggiornate con gli importi corretti.`);
        console.log(`   Se sono file .p7m, potrebbero tornare con importo 0.`);

        process.exit(0);
    } catch (err) {
        console.error('❌ Errore generale:', err);
        process.exit(1);
    }
}

main();
