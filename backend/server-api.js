/***********************************************
 * 1) CARICO LE VARIABILI AMBIENTE
 ***********************************************/
const { envFileName } = require("./loadEnv");

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const cookieParser = require("cookie-parser");

const app = express();

/***********************************************
 * 2) LA PORTA ORA VIENE DA process.env.PORT
 ***********************************************/
const PORT = process.env.PORT || 4200;
console.log("🌍 Server avviato con env file:", envFileName);
console.log("🚪 Porta configurata:", PORT);
console.log("✉️  DEBUGMAIL attivo:", process.env.DEBUGMAIL || "(non impostato)");

app.use(cors());
app.use(bodyParser.json());
app.use(cookieParser());

app.use("/public", express.static(path.join(__dirname, "public")));

/***********************************************
 * 3) LE TUE ROUTES
 ***********************************************/
app.use("/api/convenzioni", require("./routes/convenzioni"));
app.use("/api/utenti", require("./routes/utenti"));
app.use("/api/iscrizioni", require("./routes/Iscrizioni"));
app.use("/api/finecorso60h", require("./routes/calendario60"));
app.use("/api/finecorsoamm", require("./routes/calendarioAmm"));
app.use("/api/public-slots", require("./routes/publicSlots"));
app.use("/api/attestati", require("./routes/certificati"));
app.use("/api/corsi", require("./routes/corsi"));
app.use("/api/fatture", require("./routes/fatture"));
app.use("/api/report", require("./routes/report"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/mailformat", require("./routes/mailformat"));
app.use("/api/reminder", require("./routes/reminder"));
app.use("/api/finecorso", require("./routes/finecorso"));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/monitor", require("./routes/monitor"));
app.use("/api/simulazione", require("./routes/simulazione"));

app.use("/public", express.static(path.join(process.cwd(), "public")));

app.use((req, res, next) => {
    res.setTimeout(10000, () => {
        console.error("⏰ Timeout interno su", req.originalUrl);
        res.status(504).json({ success: false, error: "Timeout server" });
    });
    next();
});

/***********************************************
 * 4) AVVIO SERVER
 ***********************************************/
app.listen(PORT, () => {
    console.log(`📦 API server in ascolto su http://localhost:${PORT}`);
});
