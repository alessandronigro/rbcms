const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const ROOT_DIR = __dirname;

function resolveEnvCandidates() {
    const candidates = [];

    if (process.env.ENV_FILE) {
        candidates.push(process.env.ENV_FILE);
    }

    const nodeEnv = process.env.NODE_ENV ? process.env.NODE_ENV.toLowerCase() : null;
    if (nodeEnv) {
        candidates.push(`.env.${nodeEnv}`);
    }

    candidates.push(".env.development", ".env.production", ".env");
    return [...new Set(candidates)];
}

const envFileName = resolveEnvCandidates().find((fileName) => {
    const filePath = path.join(ROOT_DIR, fileName);
    return fs.existsSync(filePath);
}) || ".env";

const envPath = path.join(ROOT_DIR, envFileName);
dotenv.config({ path: envPath });

module.exports = {
    envFileName,
    envPath,
};
