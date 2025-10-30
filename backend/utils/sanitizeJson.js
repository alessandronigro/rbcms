/**
 * Ripulisce e valida un JSON testuale proveniente da un modello AI (es. Replicate o OpenAI)
 * Restituisce un array o oggetto JSON valido, oppure null se il parsing fallisce.
 */
function sanitizeAndParseJson(raw) {
    if (!raw || typeof raw !== "string") return null;

    try {
        // 1️⃣ Rimuove caratteri di controllo invisibili e virgolette strane
        let cleaned = raw
            .replace(/[\u0000-\u001F]+/g, " ")
            .replace(/\r?\n|\r/g, " ")
            .replace(/\t/g, " ")
            .replace(/“|”|«|»/g, '"')
            .replace(/‘|’/g, "'")
            .replace(/ +/g, " ")
            .trim();

        // 2️⃣ Isola la parte che contiene JSON
        const firstBracket = Math.min(
            cleaned.indexOf("[") === -1 ? Infinity : cleaned.indexOf("["),
            cleaned.indexOf("{") === -1 ? Infinity : cleaned.indexOf("{")
        );
        const lastBracket = Math.max(
            cleaned.lastIndexOf("]"),
            cleaned.lastIndexOf("}")
        );

        if (firstBracket !== Infinity && lastBracket !== -1) {
            cleaned = cleaned.slice(firstBracket, lastBracket + 1);
        }

        // 3️⃣ Controlla e corregge eventuali sbilanciamenti
        const openBrackets = (cleaned.match(/\[/g) || []).length;
        const closeBrackets = (cleaned.match(/\]/g) || []).length;
        const openBraces = (cleaned.match(/{/g) || []).length;
        const closeBraces = (cleaned.match(/}/g) || []).length;

        if (openBrackets !== closeBrackets || openBraces !== closeBraces) {
            console.warn("⚠️ JSON non bilanciato, tentativo di correzione soft...");
            const minEnd = Math.min(
                cleaned.lastIndexOf("]") + 1 || cleaned.length,
                cleaned.lastIndexOf("}") + 1 || cleaned.length
            );
            cleaned = cleaned.slice(0, minEnd);
        }

        // 4️⃣ Parsing
        const parsed = JSON.parse(cleaned);
        return parsed;
    } catch (err) {
        console.error("❌ Errore durante la sanificazione del JSON:", err.message);

        // 📜 Logga in console le prime e ultime righe del testo
        console.error("🧾 Estratto testo problematico:\n", raw.slice(0, 200), "…", raw.slice(-200));
        return null;
    }
}

module.exports = { sanitizeAndParseJson };
