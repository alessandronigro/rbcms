// Helper per il parsing dei file XML FatturaPA
const fs = require('fs');
const path = require('path');

/**
 * Estrae i dati principali da un file XML FatturaPA
 * @param {string} xmlFilePath - Path assoluto al file XML
 * @returns {Object} Dati estratti dalla fattura
 */
function parseFatturaPA(xmlFilePath) {
    try {
        // Leggi il file XML
        let xmlContent = fs.readFileSync(xmlFilePath, 'utf-8');

        // Se è un file .p7m firmato, non possiamo parsarlo direttamente
        // Per ora gestiamo solo XML non firmati
        if (xmlFilePath.endsWith('.p7m')) {
            console.warn(`⚠️  File firmato .p7m, parsing non supportato: ${path.basename(xmlFilePath)}`);
            return null;
        }

        const result = {
            tipoDocumento: extractValue(xmlContent, 'TipoDocumento'),
            numero: extractValue(xmlContent, 'Numero'),
            data: extractValue(xmlContent, 'Data'),
            cedentePrestatore: {
                denominazione: extractValue(xmlContent, 'DenominazioneCedentePrestatore') ||
                    extractValue(xmlContent, 'Denominazione'),
                partitaIVA: extractValue(xmlContent, 'IdFiscaleIVA>IdCodice'),
                codiceFiscale: extractValue(xmlContent, 'CodiceFiscale')
            },
            importi: {
                imponibile: 0,
                iva: 0,
                totale: 0
            },
            allegati: []
        };

        // Estrai importi dai DatiRiepilogo
        const riepiloghiMatch = xmlContent.match(/<DatiRiepilogo>[\s\S]*?<\/DatiRiepilogo>/g);
        if (riepiloghiMatch) {
            riepiloghiMatch.forEach(riepilogo => {
                const imponibile = parseFloat(extractValue(riepilogo, 'ImponibileImporto') || '0');
                const imposta = parseFloat(extractValue(riepilogo, 'Imposta') || '0');

                result.importi.imponibile += imponibile;
                result.importi.iva += imposta;
            });
        }

        // Calcola il totale
        result.importi.totale = result.importi.imponibile + result.importi.iva;

        // Estrai allegati
        const allegatiMatch = xmlContent.match(/<Allegati>[\s\S]*?<\/Allegati>/g);
        if (allegatiMatch) {
            allegatiMatch.forEach(allegato => {
                const nomeAttachment = extractValue(allegato, 'NomeAttachment');
                if (nomeAttachment) {
                    result.allegati.push(nomeAttachment);
                }
            });
        }

        return result;

    } catch (err) {
        console.error(`❌ Errore parsing XML ${path.basename(xmlFilePath)}:`, err.message);
        return null;
    }
}

/**
 * Estrae un valore da un tag XML
 * @param {string} xml - Contenuto XML
 * @param {string} tagName - Nome del tag da estrarre
 * @returns {string|null} Valore estratto o null
 */
function extractValue(xml, tagName) {
    // Gestisce sia tag semplici che tag con namespace
    const regex = new RegExp(`<(?:\\w+:)?${tagName}[^>]*>([^<]*)<\\/(?:\\w+:)?${tagName}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
}

/**
 * Formatta un importo per il database MySQL
 * @param {number} amount - Importo numerico
 * @param {boolean} isNegative - Se true, aggiunge il segno meno
 * @returns {string} Importo formattato
 */
function formatAmount(amount, isNegative = false) {
    const formatted = amount.toFixed(2);
    return isNegative ? `-${formatted}` : formatted;
}

module.exports = {
    parseFatturaPA,
    extractValue,
    formatAmount
};
