const fs = require("fs");
const path = require("path");
const axios = require("axios");
const Brevo = require("@getbrevo/brevo");

const brevo = new Brevo.TransactionalEmailsApi();
brevo.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

/**
 * 🔹 Invio PEC (equivalente a InvioMailPEC)
 */
async function invioMailPEC({ from, to, subject, html, attachments = [] }) {
    try {
        if (!to) throw new Error("Destinatario mancante");

        // Conversione allegati: gestisce sia URL che file locali
        const processedAttachments = [];
        for (const item of attachments) {
            if (!item) continue;
            if (item.includes("http")) {
                const response = await axios.get(item, { responseType: "arraybuffer" });
                const filename = item.split("/").pop();
                processedAttachments.push({
                    name: filename,
                    content: Buffer.from(response.data).toString("base64"),
                });
            } else if (fs.existsSync(item)) {
                processedAttachments.push({
                    name: path.basename(item),
                    content: fs.readFileSync(item).toString("base64"),
                });
            }
        }

        const sendEmail = new Brevo.SendSmtpEmail();
        sendEmail.subject = subject;
        sendEmail.htmlContent = html;
        sendEmail.sender = { email: from, name: "PEC RB Consulenza" };
        sendEmail.to = [{ email: to }];
        sendEmail.attachment = processedAttachments;

        const result = await brevo.sendTransacEmail(sendEmail);
        console.log(`✅ PEC inviata a ${to} | ID: ${result.messageId}`);
        return `<br>ESITO PEC INVIATA: ${to}`;
    } catch (err) {
        console.error("❌ Errore InvioMailPEC:", err.message);
        return `Errore invio PEC: ${err.message}`;
    }
}

/**
 * 🔹 Invio email standard con loghi e gestione multi-brand
 * (equivalente a InvioMail)
 */
async function invioMail({
    to,
    from,
    subject,
    html,
    bcc = "",
    cc = "",
    attachments = [],
    brand = "formazioneintermediari",
}) {
    try {
        console.log(`📧 Invio email - Brand: ${brand} | From: ${from} | To: ${to}`);
        if (!to) throw new Error("Indirizzo email destinatario mancante");

        // 🔸 Determina mittente e logo in base al brand
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

        // 🔸 Gestione allegati multipli (locali o remoti)
        const processedAttachments = [];
        for (const file of attachments) {
            if (!file) continue;
            try {
                if (file.startsWith("http")) {
                    const response = await axios.get(file, { responseType: "arraybuffer" });
                    const filename = file.split("/").pop();
                    processedAttachments.push({
                        name: filename,
                        content: Buffer.from(response.data).toString("base64"),
                    });
                } else if (fs.existsSync(file)) {
                    processedAttachments.push({
                        name: path.basename(file),
                        content: fs.readFileSync(file).toString("base64"),
                    });
                }
            } catch (e) {
                console.warn("⚠️ Impossibile caricare allegato:", file);
            }
        }

        // 🔸 Inserisci il logo inline nel body
        const htmlWithLogo = html.replace(
            "[[LOGO]]",
            `<img src="cid:companylogo" alt="Logo" style="max-height:80px"/>`
        );

        // 🔸 Prepara email
        const sendEmail = new Brevo.SendSmtpEmail();
        sendEmail.subject = subject;
        sendEmail.htmlContent = htmlWithLogo;
        sendEmail.sender = { email: from, name: fromName };
        sendEmail.to = to.split(",").map((t) => ({ email: t.trim() }));

        // Aggiunge BCC e CC
        if (bcc) {
            sendEmail.bcc = bcc.split(";").map((b) => ({ email: b.trim() }));
        } else if (bccDefault) {
            sendEmail.bcc = [{ email: bccDefault }];
        }
        if (cc) {
            sendEmail.cc = cc.split(";").map((c) => ({ email: c.trim() }));
        }

        // Allegati
        if (processedAttachments.length > 0) sendEmail.attachment = processedAttachments;

        // 🔸 Invia
        const result = await brevo.sendTransacEmail(sendEmail);
        console.log(`✅ Email inviata a ${to} | ID: ${result.messageId}`);

        if (bcc) {
            return `${to}<br> EMAIL BCC INVIATA: ${bcc}`;
        } else {
            return `${to}<br>`;
        }
    } catch (err) {
        console.error("❌ Errore InvioMail:", err.message);
        return `Errore invio email: ${err.message}`;
    }
}

module.exports = { invioMailPEC, invioMail };