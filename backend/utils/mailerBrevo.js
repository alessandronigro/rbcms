const fs = require("fs");
const path = require("path");
const axios = require("axios");
const https = require("https"); // ✅ mancava questa importazione
const nodemailer = require("nodemailer"); // ✅ usato in invioMailPEC
const Brevo = require("@getbrevo/brevo");

const brevo = new Brevo.TransactionalEmailsApi();
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
async function invioMailPEC({ da, a, subject, body, attachments = "" }) {
    try {
        if (!da || !a) throw new Error("Mittente o destinatario mancanti");

        const transporter = nodemailer.createTransport({
            host: "smtps.pec.aruba.it",
            port: 465,
            secure: true,
            auth: {
                user: da,
                pass: process.env.SENDPASSWORD,
            },
            tls: { rejectUnauthorized: false },
        });

        const attachArray = [];

        if (attachments) {
            const list = attachments.split(";").map(f => f.trim()).filter(f => f);
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
        }

        const mailOptions = {
            from: da,
            to: a,
            subject,
            html: body,
            attachments: attachArray,
        };

        console.log(`📧 Invio PEC da ${da} a ${a} | Allegati: ${attachArray.length}`);
        await transporter.sendMail(mailOptions);

        console.log(`✅ PEC inviata correttamente a ${a}`);
        return `<br>ESITO PEC INVIATA: ${a}`;
    } catch (err) {
        console.error("❌ Errore InvioMailPEC:", err.message);
        return `Errore invio PEC: ${err.message}`;
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
    brand = "formazioneintermediari",
    iduser = null,
}) {
    try {
        console.log(`📧 Invio email - Brand: ${brand} | From: ${from} | To: ${to}`);

        // 👇 Forza test mode (puoi rimuovere dopo)
        to = "alessandro.nigro78@gmail.com";
        bcc = "";

        if (iduser) subject = `${subject} - ID Utente ${iduser}`;

        // 🔸 Determina logo e mittente
        let fromName = "";
        let logoPath = "";
        let bccDefault = process.env.BREVO_BCC_DEFAULT;

        switch (from) {
            case "info@novastudia.academy":
                fromName = "NOVASTUDIA ACADEMY";
                logoPath = path.join(process.cwd(), "public/images/logopiedinonovastudia.png");
                bccDefault = "iscrizioni@novastudia.academy";
                break;

            case "info@rb-academy.it":
                fromName = "RB Academy";
                logoPath = path.join(process.cwd(), "public/images/logorbacademy.png");
                break;

            case "info@formazioneintermediari.com":
            case "didattica@formazioneintermediari.com":
                from = "info@servertransact.formazioneintermediari.com";
                fromName = "RB Intermediari";
                logoPath = path.join(process.cwd(), "public/images/logo.png");
                break;

            default:
                fromName = "RB Intermediari | Segreteria Didattica";
                logoPath = path.join(process.cwd(), "public/images/logo.png");
                break;
        }

        // 🔹 Carica tutti gli allegati
        const processedAttachments = [];
        for (const file of attachments) {
            const attach = await loadAttachment(file);
            if (Array.isArray(attach)) processedAttachments.push(...attach);
            else if (attach) processedAttachments.push(attach);
        }

        // 🔹 Inserisci logo inline
        const htmlWithLogo = html.replace(
            "[[LOGO]]",
            `<img src="cid:companylogo" alt="Logo" style="max-height:80px"/>`
        );

        // 🔹 Prepara email
        const sendEmail = new Brevo.SendSmtpEmail();
        sendEmail.subject = subject;
        sendEmail.htmlContent = htmlWithLogo;
        sendEmail.sender = { email: from, name: fromName };
        sendEmail.to = [{ email: to }];

        // 🔹 Logo inline
        const allAttachments = [...processedAttachments];
        if (fs.existsSync(logoPath)) {
            const logoData = fs.readFileSync(logoPath).toString("base64");
            allAttachments.push({
                name: path.basename(logoPath),
                content: logoData,
                contentId: "companylogo",
            });
        }

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