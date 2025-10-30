// middleware/authConv.js
const jwt = require("jsonwebtoken");

const COOKIE_NAME = "conv_session";
const { JWT_SECRET = "change-me" } = process.env;

function readSession(req) {
    const raw = req.cookies?.[COOKIE_NAME];
    if (!raw) return null;
    try {
        return jwt.verify(raw, JWT_SECRET);
    } catch {
        return null;
    }
}

function requireConv(req, res, next) {
    const sess = readSession(req);
    if (!sess) return res.status(401).json({ error: "Non autenticato" });
    req.conv = sess; // { code,name,piattaforma,host,role }
    next();
}

function setSession(res, payload) {
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: false, // -> true in produzione su HTTPS
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: "/",
    });
}

function clearSession(res) {
    res.clearCookie(COOKIE_NAME, { path: "/" });
}

module.exports = { requireConv, setSession, clearSession, readSession, COOKIE_NAME };