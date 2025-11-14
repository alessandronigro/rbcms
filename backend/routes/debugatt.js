// routes/debug.js
const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const { generateCertificate } = require("../utils/generateCertificate");
const { logwrite } = require("../utils/helper");

router.get("/test-template", async (req, res) => {
    try {
        const code = req.query.code || "codDebug";
        const convenzione = req.query.conv || "";
        const hostUrl = process.env.FRONTEND_URL || "https://stagingrb.formazioneintermediari.com";

        const data = {
            "FN": "Mario Rossi",
            "CD": "RSSMRA78A15H501F",
            "DT": "05/11/2025",
            "[DATECOMPLETE]": "05/11/2025",
            "HR": "14:30",
            "TD": "07/11/2025",
            "CS": "Corso di aggiornamento IVASS",
            "VT": "95/100",
            "LS": "Via Crescenzio, 25 - 00193 Roma (RM)",
        };

        const pdfPath = await generateCertificate({
            code,
            corso: "Debug Attestato",
            nominativo: `${data.FIRSTNAME} ${data.LASTNAME}`,
            iduser: "debug",
            data,
            convenzione,
        });

        const pdfUrl = `${hostUrl}/backend/public/certificati/${path.basename(pdfPath)}`;
        const docxUrl = `${hostUrl}/backend/public/temp/${path.basename(pdfPath).replace(/\.pdf$/, ".docx")}`;

        return res.json({
            success: true,
            message: "✅ Test attestato completato",
            pdf: pdfUrl,
            docx: docxUrl,
        });
    } catch (err) {
        logwrite("❌ Errore test-template: " + err.message);
        return res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

module.exports = router;