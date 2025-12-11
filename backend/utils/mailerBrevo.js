const fs = require("fs");
const path = require("path");
const axios = require("axios");
const https = require("https"); // ✅ mancava questa importazione
const nodemailer = require("nodemailer"); // ✅ usato in invioMailPEC
const Brevo = require("@getbrevo/brevo");

const normalizeEnv = (...keys) => {
    for (const key of keys) {
        const value = process.env[key];
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed) return trimmed;
        }
    }
    return null;
};

const parseBooleanEnv = (key, fallback = false) => {
    const raw = process.env[key];
    if (typeof raw !== "string") return fallback;
    return ["1", "true", "yes", "on"].includes(raw.toLowerCase().trim());
};

const REQUIRED_BCC = "vendite@formazioneintermediari.com";

const brevo = new Brevo.TransactionalEmailsApi();
const LOGOS_DIR = path.join(__dirname, "..", "public", "images");
brevo.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

/* ======================================================
   📎 CARICAMENTO ALLEGATI (locale o remoto)
   ====================================================== */
async function loadAttachment(file, baseDir = "backend/public/certificati") {
    if (!file) return null;

    try {
        // Gestione percorsi multipli concatenati con ";"
        if (file.includes(";")) {
            const parts = file.split(";").map(f => f.trim()).filter(f => f);
            const results = [];
            for (const p of parts) {
                const att = await loadAttachment(p);
                if (att) results.push(att);
            }
            return results.length ? results : null;
        }

        const filename = decodeURIComponent(file.split("/").pop().trim());
        const localPath = path.isAbsolute(file)
            ? file
            : path.join(process.cwd(), baseDir, filename);

        // 📁 File locale esistente
        if (fs.existsSync(localPath)) {
            console.log("📎 Allegato caricato localmente:", localPath);
            return {
                name: path.basename(localPath),
                content: fs.readFileSync(localPath).toString("base64"),
            };
        }

        // 🌐 Fallback → URL remoto
        if (file.startsWith("http")) {
            const agent = new https.Agent({ rejectUnauthorized: false });
            const safeUrl = encodeURI(file.trim());
            const response = await axios.get(safeUrl, {
                responseType: "arraybuffer",
                httpsAgent: agent,
            });
            console.log("🌐 Allegato scaricato da remoto:", file);
            return {
                name: filename.replace(/\s+/g, "_"),
                content: Buffer.from(response.data).toString("base64"),
            };
        }

        console.warn("⚠️ Allegato non trovato:", file);
        return null;
    } catch (err) {
        console.warn("⚠️ Errore caricamento allegato:", file, "|", err.message);
        return null;
    }
}

/* ======================================================
   🔹 INVIO PEC (SMTP Aruba)
   ====================================================== */
async function invioMailPEC({ da, a, from, to, subject, body, attachments = [] }) {
    try {
        // Supporto alias (helper.js usa from/to, qui usavamo da/a)
        const mittente = da || from;
        const destinatario = a || to;

        if (!mittente || !destinatario) throw new Error("Mittente o destinatario mancanti");

        const smtpUser = normalizeEnv("PEC_SMTP_USER", "PEC_USER") || mittente;
        const smtpPass = normalizeEnv("PEC_SMTP_PASSWORD", "PEC_PASSWORD", "SENDPASSWORD");
        if (!smtpUser || !smtpPass) {
            throw new Error("Credenziali PEC mancanti (PEC_SMTP_USER / PEC_SMTP_PASSWORD)");
        }

        const smtpHost = normalizeEnv("PEC_SMTP_HOST") || "smtps.pec.aruba.it";
        const smtpPortEnv = normalizeEnv("PEC_SMTP_PORT");
        const smtpPort = smtpPortEnv ? Number(smtpPortEnv) : 465;
        const smtpAuthMethod =
            normalizeEnv("PEC_SMTP_AUTH_METHOD", "PEC_AUTH_METHOD") || "LOGIN";
        const smtpSecure = parseBooleanEnv("PEC_SMTP_SECURE", smtpPort === 465);

        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpSecure,
            auth: {
                user: smtpUser,
                pass: smtpPass,
            },
            tls: { rejectUnauthorized: false },
            authMethod: smtpAuthMethod,
        });

        const attachArray = [];
        const candidates = [];

        if (Array.isArray(attachments)) {
            for (const item of attachments) {
                if (!item) continue;
                if (typeof item === "string") {
                    candidates.push(item.trim());
                } else if (item.path) {
                    candidates.push(item.path.toString());
                }
            }
        } else if (typeof attachments === "string" && attachments.trim()) {
            candidates.push(...attachments.split(";").map((f) => f.trim()));
        }

        const list = candidates.filter(Boolean);
        for (const fi of list) {
            try {
                if (fi.startsWith("http")) {
                    const safeUrl = fi.replace(/^http:\/\//, "https://");
                    const agent = new https.Agent({ rejectUnauthorized: false });
                    const response = await axios.get(safeUrl, {
                        responseType: "arraybuffer",
                        httpsAgent: agent,
                    });

                    const filename = decodeURIComponent(fi.split("/").pop());
                    const certDir = path.join(process.cwd(), "backend/public/certificati");
                    const localFile = path.join(certDir, filename);

                    fs.writeFileSync(localFile, response.data);
                    attachArray.push({
                        filename,
                        path: localFile,
                    });
                    console.log("📎 Allegato remoto scaricato:", safeUrl);
                } else if (fs.existsSync(fi)) {
                    attachArray.push({ filename: path.basename(fi), path: fi });
                    console.log("📎 Allegato locale:", fi);
                }
            } catch (e) {
                console.warn("⚠️ Errore allegato PEC:", fi, e.message);
            }
        }

        const mailOptions = {
            from: mittente,
            to: destinatario,
            subject,
            html: body,
            attachments: attachArray,
        };

        console.log(`🔐 PEC auth ${smtpUser} @ ${smtpHost}:${smtpPort} secure=${smtpSecure} method=${smtpAuthMethod}`);
        console.log(`📧 Invio PEC da ${mittente} a ${destinatario} | Allegati: ${attachArray.length}`);
        console.log("📨 PEC options:", {
            from: mailOptions.from,
            to: mailOptions.to,
            subject: mailOptions.subject,
            attachments: mailOptions.attachments.map((f) => ({
                filename: f.filename,
                path: f.path,
            })),
        });

        const sendInfo = await transporter.sendMail(mailOptions);
        console.log("✉️ PEC sendInfo:", {
            messageId: sendInfo.messageId,
            envelope: sendInfo.envelope,
            accepted: sendInfo.accepted,
            rejected: sendInfo.rejected,
            pending: sendInfo.pending,
            response: sendInfo.response,
        });
        console.log(`✅ PEC inviata correttamente a ${destinatario}`);
        return `<br>ESITO PEC INVIATA: ${destinatario}`;
    } catch (err) {
        const detailParts = [];
        if (err.code) detailParts.push(err.code);
        if (err.responseCode) detailParts.push(err.responseCode);
        const detailInfo = detailParts.join(" | ");
        console.error("❌ Errore InvioMailPEC:", detailInfo, err.message);
        console.error("❌ Errore dettagliato sendMail:", err);
        return `Errore invio PEC: ${err.message}${detailInfo ? ` (${detailInfo})` : ""}`;
    }
}

/* ======================================================
   🔹 INVIO EMAIL STANDARD (Brevo)
   ====================================================== */
async function invioMail({
    to,
    from,
    subject,
    html,
    bcc = "",
    cc = "",
    attachments = [],
    replyTo = null,
    brand = "formazioneintermediari",
    iduser = null,
}) {
    try {
        console.log(`📧 Invio email - Brand: ${brand} | From: ${from} | To: ${to}`);

        // 👇 Forza test mode (puoi rimuovere dopo)
        const debugMailFlag = String(process.env.DEBUGMAIL || "").trim().toLowerCase();
        const debugMailEnabled = ["1", "true", "yes", "on"].includes(debugMailFlag);
        if (debugMailEnabled) {
            console.log("⚙️  DEBUGMAIL attivo -> destinatario forzato a supporto@rbconsulenza.com");
            to = "supporto@rbconsulenza.com";
            bcc = "";
        }

        if (iduser) subject = `${subject} - ID Utente ${iduser}`;

        // 🔸 Determina logo e mittente
        let fromName = "";
        let logoPath = "";
        let bccDefault = process.env.BREVO_BCC_DEFAULT;

        switch (from) {
            case "info@novastudia.academy":
                fromName = "NOVASTUDIA ACADEMY";
                logoPath = path.join(LOGOS_DIR, "logopiedinonovastudia.png");
                bccDefault = "iscrizioni@novastudia.academy";
                break;

            case "info@rb-academy.it":
                fromName = "RB Academy";
                logoPath = path.join(LOGOS_DIR, "logorbacademy.png");
                break;

            case "info@formazioneintermediari.com":
                from = "info@formazioneintermediari.com";
                fromName = "RB Intermediari";
                logoPath = path.join(LOGOS_DIR, "logo.png");
                break;
            case "didattica@formazioneintermediari.com":
                from = "didattica@formazioneintermediari.com";
                fromName = "RB Intermediari";
                logoPath = path.join(LOGOS_DIR, "logo.png");
                break;

            default:
                fromName = "RB Intermediari | Segreteria Didattica";
                logoPath = path.join(LOGOS_DIR, "logo.png");
                break;
        }

        // 🔹 Carica tutti gli allegati
        const processedAttachments = [];
        for (const file of attachments) {
            const attach = await loadAttachment(file);
            if (Array.isArray(attach)) processedAttachments.push(...attach);
            else if (attach) processedAttachments.push(attach);
        }

        // 🔹 Inserisci logo inline (Embed base64 → niente allegato separato)
        const logoPlaceholder = "[[LOGO]]";
        const logoFileName = path.basename(logoPath || "logo.png");
        const backendHost = (process.env.BACKEND_URL || process.env.VITE_BACKEND_URL || "")
            .replace(/\/$/, "");
        const logoHost = backendHost || "https://www.formazioneintermediari.com";
        const logoUrl = `${logoHost}/public/images/${logoFileName}`;

        let inlineLogoDataUri = null;
        const resolvedLogoPath = fs.existsSync(logoPath || "")
            ? logoPath
            : path.join(process.cwd(), "public/images", logoFileName);

        if (resolvedLogoPath && fs.existsSync(resolvedLogoPath)) {
            const logoBuffer = fs.readFileSync(resolvedLogoPath);
            const base64 = logoBuffer.toString("base64");
            const ext = path.extname(resolvedLogoPath).toLowerCase();
            const mimeMap = {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".gif": "image/gif",
                ".svg": "image/svg+xml",
            };
            const mime = mimeMap[ext] || "image/png";
            inlineLogoDataUri = `data:${mime};base64,${base64}`;
        }

        const logoSrc = inlineLogoDataUri || logoUrl;
        const logoTag = `<img src="${logoSrc}" alt="Logo" style="max-height:80px"/>`;

        let htmlWithLogo = html;
        if (htmlWithLogo.includes(logoPlaceholder)) {
            htmlWithLogo = htmlWithLogo.split(logoPlaceholder).join(logoTag);
        }

        // 🔹 Prepara email
        const sendEmail = new Brevo.SendSmtpEmail();
        sendEmail.subject = subject;
        sendEmail.htmlContent = htmlWithLogo;
        sendEmail.sender = { email: from, name: fromName };
        sendEmail.to = [{ email: to }];
        if (replyTo) {
            sendEmail.replyTo = typeof replyTo === "string"
                ? { email: replyTo }
                : replyTo;
        }

        console.log(`📨 mailerBrevo - bcc param: ${bcc || "(none)"} | bccDefault: ${bccDefault || "(none)"}`);

        const normalizeBcc = value => {
            if (!value) return [];
            const entries = Array.isArray(value) ? value : value.split(/[;,]/);
            return entries
                .map(email => (email || "").trim())
                .filter(Boolean);
        };

        const normalizedRequired = (REQUIRED_BCC || "").trim().toLowerCase();
        const normalizedTo = (to || "").trim().toLowerCase();
        const ccSet = new Set();

        normalizeBcc(bccDefault).forEach(email => {
            const e = email.toLowerCase();
            if (e !== normalizedRequired && e !== normalizedTo) ccSet.add(email);
        });
        normalizeBcc(bcc).forEach(email => {
            const e = email.toLowerCase();
            if (e !== normalizedRequired && e !== normalizedTo) ccSet.add(email);
        });

        const ccList = Array.from(ccSet);
        const logParts = [
            normalizedRequired ? `BCC: ${REQUIRED_BCC}` : "BCC: (none)",
            ccList.length ? `CC: ${ccList.join(", ")}` : "CC: (none)",
        ];
        console.log(`🧾 Brevo recipients => ${logParts.join(" | ")}`);

        if (normalizedRequired && normalizedRequired !== normalizedTo) {
            sendEmail.bcc = [{ email: REQUIRED_BCC }];
        }
        if (ccList.length > 0) {
            sendEmail.cc = ccList.map(email => ({ email }));
        }

        // 🔹 Allegati (solo allegati reali)
        const allAttachments = [...processedAttachments];
        if (allAttachments.length > 0) sendEmail.attachment = allAttachments;

        const result = await brevo.sendTransacEmail(sendEmail);
        console.log(
            `✅ Email inviata a ${to} | Subject: "${subject}" | Allegati: ${allAttachments.length}`
        );
        return `<br>EMAIL TEST INVIATA a ${to} (${allAttachments.length} allegati)`;
    } catch (err) {
        console.error("❌ Errore InvioMail:", err.response?.data || err.message);
        return `Errore invio email: ${err.message}`;
    }
}

module.exports = { invioMailPEC, invioMail };
