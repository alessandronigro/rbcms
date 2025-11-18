const axios = require("axios");
const jwt = require("jsonwebtoken");

const ZOOM_API_BASE = "https://api.zoom.us/v2";
const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
let cachedOAuthToken = null;
let cachedOAuthExpiry = 0;

function buildZoomJwt() {
    const apiKey = process.env.ZOOM_API_KEY || process.env.ZOOM_API;
    const apiSecret = process.env.ZOOM_API_SECRET || process.env.ZOOM_SECRET;

    if (!apiKey || !apiSecret) {
        throw new Error("Credenziali Zoom mancanti. Imposta ZOOM_API_KEY/ZOOM_API e ZOOM_API_SECRET/ZOOM_SECRET");
    }

    const payload = {
        iss: apiKey,
        exp: Math.floor(Date.now() / 1000) + 60,
    };

    return jwt.sign(payload, apiSecret);
}

async function getOAuthToken() {
    const clientId = process.env.ZOOM_API_KEY || process.env.ZOOM_API;
    const clientSecret = process.env.ZOOM_API_SECRET || process.env.ZOOM_SECRET;
    const accountId = process.env.ZOOM_ACCOUNT_ID;

    if (!clientId || !clientSecret || !accountId) return null;

    if (cachedOAuthToken && cachedOAuthExpiry > Date.now()) {
        return cachedOAuthToken;
    }

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const { data } = await axios.post(
        `${ZOOM_TOKEN_URL}?grant_type=account_credentials&account_id=${accountId}`,
        null,
        {
            headers: {
                Authorization: `Basic ${basic}`,
            },
        },
    );

    cachedOAuthToken = data.access_token;
    cachedOAuthExpiry = Date.now() + (data.expires_in - 15) * 1000; // refresh slightly earlier

    return cachedOAuthToken;
}

async function getZoomAuthHeader() {
    try {
        const oauthToken = await getOAuthToken();
        if (oauthToken) return `Bearer ${oauthToken}`;
    } catch (err) {
        console.warn("⚠️ Zoom OAuth token non disponibile:", err.message);
    }

    return `Bearer ${buildZoomJwt()}`;
}

async function createZoomMeeting({
    topic,
    startTime,
    duration = 60,
    agenda = "",
    timezone = "Europe/Rome",
}) {
    if (!startTime) {
        startTime = new Date();
    }

    const authHeader = await getZoomAuthHeader();

    const payload = {
        topic: topic || "Sessione RB",
        type: 2,
        start_time: new Date(startTime).toISOString(),
        duration,
        timezone,
        agenda,
        settings: {
            join_before_host: true,
            waiting_room: false,
            approval_type: 0,
            registration_type: 1,
            mute_upon_entry: true,
            participant_video: false,
            host_video: true,
        },
    };

    const { data } = await axios.post(
        `${ZOOM_API_BASE}/users/me/meetings`,
        payload,
        {
            headers: {
                Authorization: authHeader,
                "Content-Type": "application/json",
            },
        },
    );

    return data;
}

module.exports = {
    createZoomMeeting,
};
