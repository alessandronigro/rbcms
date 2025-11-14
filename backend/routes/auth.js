// routes/auth.js
const express = require("express");
const router = express.Router();
const { getConnection } = require("../dbManager");
const jwt = require("jsonwebtoken");

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

module.exports = router;