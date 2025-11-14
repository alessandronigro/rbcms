
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./layouts/Layout";
import ReportLayout from "./layouts/ReportLayout";

// ✅ Guard
import ProtectedConv from "./components/ProtectedConv";
import ProtectedAdmin from "./components/ProtectedAdmin";

// ✅ Pagine
import Home from "./pages/Home";
import Convenzioni from "./pages/Convenzioni";
import ConvenzioneDetail from "./pages/ConvenzioneDetail";
import NotFound from "./pages/NotFound";
import IscrizioniIndex from "./pages/Iscrizioni/Index";
import IscrizioniExcel from "./pages/Iscrizioni/IscrizioniExcel";
import IscrizioniSito from "./pages/Iscrizioni/IscrizioniSito";
import IscrizioniAca from "./pages/Iscrizioni/IscrizioniAca";
import IscrizioniNova from "./pages/Iscrizioni/IscrizioniNova";
import RicercaUtenti from "./pages/RicercaUtenti";
import FineCorso60h from "./pages/60h/FineCorso60h";
import Calendario60h from "./pages/60h/Calendario";
import FineCorsoAmm from "./pages/Amm/FineCorsoAmm";
import CalendarioAmm from "./pages/Amm/CalendarioAmm";
import FattureRicevute from "./pages/Fatture/FattureRicevute";
import FattureRicevuteNew from "./pages/Fatture/FattureRicevuteNew";
import QuestionariGradimento from "./pages/Report/QuestionarioGradimento";
import LoginConvenzione from "./pages/Login";
import ReportConvenzione from "./pages/Report/ReportConvenzioni";
import Template from "./pages/MailFormatEditor";
import ReportCorsi from "./pages/ReportCorsi";
import FineCorso from "./pages/FineCorso";
export default function App() {
  return (
    <Routes>
      {/* ✅ LOGIN — libero */}
      <Route path="/login" element={<LoginConvenzione />} />

      {/* ✅ AREA CONVENZIONE */}
      <Route
        path="/report"
        element={
          <ProtectedConv>
            <ReportLayout>
              <ReportConvenzione />
            </ReportLayout>
          </ProtectedConv>
        }
      />

      {/* ✅ AREA ADMIN */}
      <Route
        element={
          <ProtectedAdmin>
            <Layout />
          </ProtectedAdmin>
        }
      >
        <Route index element={<Home />} />

        <Route path="/convenzioni" element={<Convenzioni />} />
        <Route path="/convenzioni/nuova" element={<ConvenzioneDetail />} />
        <Route path="/convenzioni/:codice" element={<ConvenzioneDetail />} />

        <Route path="/iscrizioni" element={<IscrizioniIndex />} />
        <Route path="/iscrizioni/excel" element={<IscrizioniExcel />} />
        <Route path="/iscrizioni/sito" element={<IscrizioniSito />} />
        <Route path="/iscrizioni/aca" element={<IscrizioniAca />} />
        <Route path="/iscrizioni/nova" element={<IscrizioniNova />} />
        <Route path="/template" element={<Template />} />
        <Route path="/report/fatturato" element={<ReportCorsi />} />
        <Route path="/finecorso" element={<FineCorso />} />
        <Route path="/utenti" element={<RicercaUtenti />} />

        <Route path="/calendario/60h/finecorso" element={<FineCorso60h />} />
        <Route path="/calendario/60h/sessioni" element={<Calendario60h />} />

        <Route path="/calendario/Amm/finecorsoamm" element={<FineCorsoAmm />} />
        <Route path="/calendario/Amm/sessioniamm" element={<CalendarioAmm />} />

        <Route path="/fatture/ricevute" element={<FattureRicevute />} />
        <Route path="/fatture/ricevutenew" element={<FattureRicevuteNew />} />

        <Route path="/report/questionari" element={<QuestionariGradimento />} />

        <Route path="*" element={<NotFound />} />
      </Route>

      {/* DEFAULT → HOME */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
