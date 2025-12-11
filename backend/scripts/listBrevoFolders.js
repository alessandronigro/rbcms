const path = require("path");
const axios = require("axios");
const { envPath } = require("../loadEnv");

require("dotenv").config({ path: envPath });

const BREVO_API_KEY = process.env.BREVO_API_KEY;

if (!BREVO_API_KEY) {
  console.error("╳ BREVO_API_KEY non configurata");
  process.exit(1);
}

(async () => {
  try {
    const response = await axios.get("https://api.brevo.com/v3/contacts/folders", {
      headers: {
        Accept: "application/json",
        "api-key": BREVO_API_KEY,
      },
    });
    console.log("😀 Folder trovate:");
    const folders = response.data?.folders || [];
    folders.forEach((folder) => {
      console.log(`- ${folder.name}: ${folder.id}`);
    });
  } catch (error) {
    console.error(
      "Errore durante la chiamata a Brevo:",
      error.response?.data || error.message,
    );
    process.exit(1);
  }
})();
