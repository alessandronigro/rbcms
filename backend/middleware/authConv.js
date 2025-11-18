const jwt = require("jsonwebtoken");

module.exports.requireConv = (req, res, next) => {
    try {
        if (req.session && req.session.conv) {
            req.conv = req.session.conv;
            return next();
        }

        const token = req.cookies?.conv_session;
        if (!token) {
            return res.status(403).json({ error: "Non autorizzato (nessuna convenzione attiva)" });
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.conv = {
                role: decoded.role,
                code: decoded.code,
                nome_convenzione: decoded.nome_convenzione,
                piattaforma: decoded.piattaforma,
                logoUrl: decoded.logoUrl,
            };
            return next();
        } catch (err) {
            console.error("authConv token error:", err.message);
            return res.status(403).json({ error: "Sessione convenzione non valida" });
        }
    } catch (err) {
        console.error("authConv error:", err);
        return res.status(500).json({ error: "Errore autenticazione convenzione" });
    }
};
