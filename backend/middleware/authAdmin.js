/**
 * Autenticazione area amministrativa
 * Richiede che l'utente admin sia loggato tramite express-session.
 *
 * req.session.admin = {
 *     id: Number,
 *     username: String,
 *     role: "admin" | "superadmin"
 * }
 */

module.exports.authAdmin = (req, res, next) => {
    try {
        if (!req.session || !req.session.admin) {
            return res.status(403).json({
                error: "Accesso negato: admin non autenticato"
            });
        }

        req.admin = req.session.admin;
        next();
    } catch (err) {
        console.error("❌ authAdmin error:", err);
        return res.status(500).json({ error: "Errore autenticazione admin" });
    }
};

/**
 * Middleware opzionale:
 * richiede ruolo SUPERADMIN
 */
module.exports.requireSuperadmin = (req, res, next) => {
    try {
        if (!req.session || !req.session.admin) {
            return res.status(403).json({ error: "Accesso negato" });
        }

        if (req.session.admin.role !== "superadmin") {
            return res.status(403).json({
                error: "Accesso negato: privilegi insufficienti"
            });
        }

        req.admin = req.session.admin;
        next();
    } catch (err) {
        console.error("❌ requireSuperadmin error:", err);
        return res.status(500).json({ error: "Errore autenticazione superadmin" });
    }
};