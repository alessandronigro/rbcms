const crypto = require("crypto");

const SECRET = process.env.AUTO_LOGIN_SECRET || process.env.JWT_SECRET || "auto-login-secret";
const KEY = crypto.createHash("sha256").update(SECRET).digest();
const AUTO_LOGIN_LINK_TTL_MINUTES = Math.max(1, Number(process.env.AUTO_LOGIN_LINK_TTL_MINUTES) || 60);
const AUTO_LOGIN_LINK_TTL_MS = AUTO_LOGIN_LINK_TTL_MINUTES * 60 * 1000;
const AUTO_LOGIN_LINK_ENABLED = String(process.env.AUTO_LOGIN_LINK_ENABLED || "false").toLowerCase() === "true";
const BACKEND_URL = (process.env.BACKEND_URL || "").replace(/\/+$/, "");
const FORM_LOGIN_PATH = process.env.AUTO_LOGIN_FORM_PATH || "/index.php?r=adm/homepage/login&plugin=FormaAuth";
const IV_LENGTH = 12;

function createAutoLoginToken(payload = {}) {
  const now = Date.now();
  const data = {
    ...payload,
    iat: now,
    exp: now + AUTO_LOGIN_LINK_TTL_MS,
  };
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

function decryptAutoLoginToken(token) {
  if (!token) throw new Error("Token mancante");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Token invalido");
  const [ivPart, tagPart, payloadPart] = parts;
  const iv = Buffer.from(ivPart, "base64");
  const tag = Buffer.from(tagPart, "base64");
  const encrypted = Buffer.from(payloadPart, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const parsed = JSON.parse(decrypted.toString("utf8"));
  if (parsed.exp && Date.now() > parsed.exp) throw new Error("Link scaduto");
  return parsed;
}

function buildAutoLoginLink({ username, password, formAction, nominativo }) {
  if (!AUTO_LOGIN_LINK_ENABLED || !BACKEND_URL || !username || !password || !formAction) {
    return null;
  }
  const token = createAutoLoginToken({ username, password, formAction, nominativo });
  return `${BACKEND_URL}/api/auth/autologin?token=${encodeURIComponent(token)}`;
}

module.exports = {
  AUTO_LOGIN_LINK_ENABLED,
  AUTO_LOGIN_LINK_TTL_MINUTES,
  FORM_LOGIN_PATH,
  createAutoLoginToken,
  decryptAutoLoginToken,
  buildAutoLoginLink,
};
