require('dotenv').config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const cookieParser = require("cookie-parser");



const app = express();
const port = 4200;
app.use(cors());
app.use(bodyParser.json());
app.use(cookieParser());

app.use("/public", express.static(path.join(__dirname, "public")));

app.use("/api/convenzioni", require("./routes/convenzioni"));
app.use("/api/utenti", require("./routes/utenti"));



const iscrizioniRoutes = require("./routes/Iscrizioni");
app.use("/api/iscrizioni", iscrizioniRoutes);

const calendario60Routes = require("./routes/calendario60");
app.use("/api/finecorso60h", calendario60Routes);

const calendarioAmm = require("./routes/calendarioAmm");
app.use("/api/finecorsoamm", calendarioAmm);

const getattestati = require("./routes/getattestati");
app.use("/api/attestatild", getattestati);

app.use("/api/attestati", require("./routes/certificati"));

const corsiRoutes = require("./routes/corsi");
app.use("/api/corsi", corsiRoutes);

app.use("/api/fatture", require("./routes/fatture"));

app.use("/api/report", require("./routes/report"));

app.use("/api/admin", require("./routes/admin"));
app.use("/api/mailformat", require("./routes/mailformat"));
app.use("/api/finecorso", require("./routes/finecorso"));
app.use("/api/auth", require("./routes/auth"));

const debugRoutes = require("./routes/debugatt");
app.use("/api/debug", debugRoutes);
// static
app.use("/public", express.static(path.join(process.cwd(), "public")));
app.use((req, res, next) => {
    res.setTimeout(10000, () => { // 20s timeout
        console.error("⏰ Timeout interno su", req.originalUrl);
        res.status(504).json({ success: false, error: "Timeout server" });
    });
    next();
});

app.listen(port, () => {
    console.log(`📦 API server in ascolto su http://localhost:${port}`);
});
