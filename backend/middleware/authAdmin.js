const jwt = require("jsonwebtoken");

function authAdmin(req, res, next) {
    try {
        const token = req.cookies.conv_session;
        if (!token) return res.status(401).json({ error: "Not logged in" });

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role !== "admin") {
            return res.status(403).json({ error: "Unauthorized" });
        }

        req.user = decoded;
        next();
    } catch (err) {
        console.error("authAdmin:", err);
        return res.status(401).json({ error: "Invalid token" });
    }
}

module.exports = authAdmin;