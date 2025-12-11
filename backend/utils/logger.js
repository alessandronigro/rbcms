const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

/**
 * Scrive un log su file organizzato per funzionalità e data.
 * Struttura: public/log/<scope>/YYYY-MM-DD.log
 * 
 * @param {string} scope - La funzionalità o modulo (es. 'fatture', 'mail', 'corsi').
 * @param {string} message - Il messaggio da loggare.
 * @param {string} level - Livello del log (INFO, ERROR, WARN). Default: INFO.
 */
function writeLog(scope, message, level = 'INFO') {
    try {
        const today = dayjs().format('YYYY-MM-DD');
        const timestamp = dayjs().format('HH:mm:ss');
        const logDir = path.join(__dirname, '../public/log', scope);
        const logFile = path.join(logDir, `${today}.log`);

        // Assicura che la cartella esista
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const logEntry = `[${timestamp}] [${level}] ${message}\n`;

        // Append del log su file
        fs.appendFileSync(logFile, logEntry, 'utf8');

        // Output anche in console per debug immediato (opzionale)
        // console.log(`[LOG-${scope}] ${logEntry.trim()}`);

    } catch (err) {
        console.error("❌ Errore durante la scrittura del log:", err);
    }
}

/**
 * Wrapper per loggare errori specifici
 */
function logError(scope, message, errorObject = null) {
    let fullMessage = message;
    if (errorObject) {
        fullMessage += ` | Details: ${errorObject.message || errorObject}`;
        if (errorObject.stack) {
            fullMessage += `\nStack: ${errorObject.stack}`;
        }
    }
    writeLog(scope, fullMessage, 'ERROR');
}

module.exports = { writeLog, logError };
