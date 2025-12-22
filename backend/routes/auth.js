// routes/auth.js
const express = require("express");
const router = express.Router();
const { getConnection } = require("../dbManager");
const jwt = require("jsonwebtoken");
const { decryptAutoLoginToken, AUTO_LOGIN_LINK_ENABLED } = require("../utils/autoLogin");

// ✅ LOGIN
router.post("/login", async (req, res) => {
    try {
        const code = String(req.body.code || "").trim();
        if (!code) return res.status(400).json({ success: false, error: "Codice richiesto" });

        const conn = await getConnection("wpacquisti");
        const [rows] = await conn.query(
            "SELECT * FROM newconvenzioni WHERE codice=? AND (sospendireport IS NULL OR sospendireport=0) LIMIT 1",
            [code]
        );

        if (!rows.length) return res.json({ success: false, error: "Codice non valido" });

        const conv = rows[0];
        const isAdmin = conv.Codice === "9413";

        // ✅ Correzione logo URL ✅
        const logoDomain = (conv.newindirizzoweb || "")
            .replace("https://", "")
            .replace("http://", "")
            .split(".")[0];

        const payload = {
            authenticated: true,
            role: isAdmin ? "admin" : "conv",
            code: conv.Codice,
            nome_convenzione: conv.Name,
            piattaforma: conv.piattaforma,

            logoUrl: logoDomain
                ? `https://${logoDomain}.formazioneintermediari.com/templates/rb_formazione/images/${logoDomain}.png`
                : null
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });


        res.cookie("conv_session", token, {
            httpOnly: true,
            sameSite: "Lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        return res.json({ success: true, role: payload.role });
    } catch (err) {
        console.error("conv-login ERR:", err);
        res.status(500).json({ success: false, error: "Errore server" });
    }
});

router.get("/me", (req, res) => {
    const token = req.cookies.conv_session;
    if (!token) return res.json({ authenticated: false });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        return res.json({
            authenticated: true,
            user: {
                authenticated: true,
                role: decoded.role,
                code: decoded.code || "",
                nome_convenzione: decoded.nome_convenzione || "",
                piattaforma: decoded.piattaforma,

                logoUrl: decoded.logoUrl || null
            }
        });



    } catch (err) {
        console.error("auth /me error:", err);
        return res.json({ authenticated: false });
    }
});

// ✅ LOGOUT
router.post("/logout", (req, res) => {
    res.clearCookie("conv_session");
    return res.json({ success: true });
});

router.get("/autologin", (req, res) => {
    if (!AUTO_LOGIN_LINK_ENABLED) {
        return res.status(404).send("Auto login disabilitato");
    }

    const token = String(req.query.token || "");
    if (!token) {
        return res.status(400).send("Parametro token obbligatorio");
    }

    try {
        const payload = decryptAutoLoginToken(token);
        const { username, password, formAction, nominativo = "" } = payload;
        if (!username || !password || !formAction) {
            return res.status(400).send("Token non valido: credenziali mancanti");
        }

        const escapeHtml = (value) =>
            value
                .toString()
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");

        const htmlAction = escapeHtml(formAction);
        const htmlUser = escapeHtml(username);
        const htmlPass = escapeHtml(password);
        const friendlyName = nominativo ? escapeHtml(nominativo) : "utente";

        const html = `<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8">
    <title>Accesso automatico</title>
    <style>body{font-family:Arial,sans-serif;background:#f4f5f7;color:#1d1d1f;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:#fff;padding:24px;border-radius:12px;box-shadow:0 6px 24px rgba(15,23,42,.1);max-width:480px;width:100%;text-align:center}a{color:#2563eb;text-decoration:none}</style>
  </head>
  <body>
    <div class="card">
      <h1>Accesso in corso</h1>
      <p>Stiamo collegando ${friendlyName} alla piattaforma.</p>
      <form id="autoLogin" method="post" action="${htmlAction}">
        <input type="hidden" name="login_userid" value="${htmlUser}">
        <input type="hidden" name="login_pwd" value="${htmlPass}">
        <noscript>
          <p>Il browser non supporta JavaScript, clicchi sul pulsante per procedere.</p>
          <button type="submit">Accedi</button>
        </noscript>
      </form>
      <p><small>Se non viene reindirizzato automaticamente, <a href="#" onclick="document.getElementById('autoLogin').submit();return false">clicchi qui</a>.</small></p>
    </div>
    <script>document.getElementById("autoLogin").submit();</script>
  </body>
</html>`;

        return res.send(html);
    } catch (err) {
        console.error("autologin ERR:", err);
        return res.status(400).send("Link non valido o scaduto");
    }
});

module.exports = router;
