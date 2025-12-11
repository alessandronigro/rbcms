const express = require("express");
const { getPoolStats } = require("../dbManager");

const router = express.Router();

router.get("/mysql/connections", async (req, res) => {
  try {
    const stats = await getPoolStats();
    return res.json({ success: true, data: stats });
  } catch (error) {
    console.error("❌ /api/monitor/mysql/connections:", error);
    return res.status(500).json({ success: false, error: "Errore nel recupero delle statistiche MySQL" });
  }
});

module.exports = router;
