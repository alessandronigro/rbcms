import { useState } from "react";
import { Download } from "lucide-react";
interface Course {
  idCourse?: number;
  code: string;
  name: string;
  date_inscr?: string;
  date_complete?: string;
  last_access_course?: string;
  date_expire_validity?: string;
  doc_generated_at?: string;
  evaso?: string;
  date_invio?: string;
  has_doc?: boolean;
  status?: number | string;
  stato_descrizione?: string;
  ore_video?: string;
  ore_totali?: string;
}

interface Fields {
  translation?: string;
  user_entry?: string;
}

interface User {
  firstname: string;
  lastname: string;
  idst: string;
  userid: string;
  email?: string;
  cf?: string;
  lastenter: string;
  convenzione?: string;
  password?: string;
}

export interface UserDetail {
  user: User;
  courses: Course[];
  fields: Fields[];
  address?: string;
  pass?: string;
  host?: string;
  db?: string;
}

interface Props {
  detail: UserDetail | null;
  onAction?: (action: string, course: Course) => void;
}

export default function UtenteDettaglio({ detail, onAction }: Props) {
  const [attUrlMap] = useState<{ [key: number]: string | null }>(
    {},
  );
  const [errorMap] = useState<{ [key: number]: string | null }>(
    {},
  );
  const [loading, setLoading] = useState(false);
  if (!detail)
    return <p className="text-gray-500">Nessun dettaglio disponibile</p>;
  console.log("📌 DETAIL OBJECT:", detail);

  const { user, courses = [], fields = [] } = detail;

  const getField = (label: string) =>
    fields.find((f) => f.translation?.toLowerCase() === label.toLowerCase())
      ?.user_entry || "";

  const password = getField("Password") || detail.pass || user.password || "";

  const cleanUser = user.userid.replace("/", "");
  // ✅ Stato globale di caricamento attestato

  const handleGeneraAttestato = async (idcorso: string) => {
    if (!user?.idst) return alert("Utente non valido");
    const scelta = window.confirm(
      "Vuoi inviare l’attestato al corsista (attestato + test + report) oppure solo visualizzarlo?",
    );

    setLoading(true);
    try {
      const payload = {
        iduser: user.idst,
        idcorso,
        webdb: detail.db || "formazionein", // o passa dal parent RicercaUtenti
        host: detail.host || "EFAD", // o passa dal parent RicercaUtenti
      };

      let url = "";
      if (scelta) {
        // 📤 INVIA attestato + test + report
        const res = await fetch(`/api/attestati/sendcertificate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.success)
          throw new Error(data.error || "Errore invio attestato");
        alert("✅ Attestato inviato correttamente al corsista!");
      } else {
        // 👁️ SOLO VISUALIZZA attestato
        const res = await fetch(`/api/attestati/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.success)
          throw new Error(data.error || "Errore generazione attestato");
        url = data.file;
        window.open(url, "_blank");
      }
    } catch (err: any) {
      alert("❌ Errore: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gradient-to-b from-gray-50 to-gray-100 min-h-screen p-6">
      {/* ✅ HEADER UTENTE */}
      <div className="bg-white border rounded-lg p-4 shadow-sm mb-4">
        <h1 className="text-2xl font-bold text-gray-800 mb-3">
          {user.firstname} {user.lastname}
        </h1>

        {/* ✅ Login piattaforma */}
        <form
          className="inline-block mr-2"
          target="_blank"
          method="post"
          action={`${detail.address}/index.php?r=adm/homepage/login&plugin=FormaAuth`}
        >
          <input type="hidden" name="login_userid" value={cleanUser} />
          <input type="hidden" name="login_pwd" value={password} />
          <button
            type="submit"
            className="bg-indigo-600 text-white text-sm px-3 py-1 rounded-md shadow hover:bg-indigo-700"
          >
            🔑 Login piattaforma
          </button>
        </form>

        {/* 🗑 Cancella utente */}
        <a
          href={`${import.meta.env.VITE_BACKEND_URL}/api/corsi/utenti/${detail.db}/${user.idst}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-red-600 text-white text-sm px-3 py-1 rounded-md shadow-sm hover:bg-red-700"
        >
          🗑 Cancella utente
        </a>

        {/* ✅ DATI ANAGRAFICI ORIZZONTALI */}
        <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm text-gray-800 mt-4">
          <p>
            <b>Username:</b> {cleanUser}
          </p>
          <p>
            <b>Password:</b> {password}
          </p>

          {getField("cellulare") && (
            <p>
              <b>Cellulare:</b> {getField("cellulare")}
            </p>
          )}

          <p>
            <b>Email utente:</b>{" "}
            {getField("Indirizzo Email")?.toLowerCase() || user.email}
          </p>

          {getField("PEC") && (
            <p>
              <b>PEC:</b> {getField("PEC")}
            </p>
          )}

          <p>
            <b>Codice Fiscale:</b> {getField("Codice Fiscale") || user.cf}
          </p>

          {getField("Ragione Sociale") && (
            <p>
              <b>Ragione Sociale:</b> {getField("Ragione Sociale")}
            </p>
          )}

          {getField("Sede") && (
            <p>
              <b>Sede:</b> {getField("Sede")}
            </p>
          )}

          {getField("P.I./C.F.") && (
            <p>
              <b>P.I./C.F.:</b> {getField("P.I./C.F.").toUpperCase()}
            </p>
          )}

          {getField("PEC Fattura") && (
            <p>
              <b>PEC Fattura:</b> {getField("PEC Fattura")}
            </p>
          )}

          {getField("Codice Destinatario") && (
            <p>
              <b>Codice Destinatario:</b> {getField("Codice Destinatario")}
            </p>
          )}

          <p>
            <b>Convenzione:</b> {getField("Convenzione") || user.convenzione}
          </p>
        </div>
      </div>

      {/* ✅ CORSI */}
      {courses.map((c) => (
        <div
          key={c.idCourse}
          className="bg-white border rounded-lg p-4 shadow-sm mb-4"
        >
          <p className="text-sm mb-2">
            <b className="text-red-600">{c.code}</b> — {c.name}
          </p>
          {/* ✅ Stato & Info corso */}
          <div className="text-sm space-y-1 text-gray-700">
            <p>
              <b>Data Iscrizione:</b> {c.date_inscr || "N/D"}
            </p>
            <p>
              <b>Data Completamento:</b> {c.date_complete || "N/D"}
            </p>
            <p>
              <b>Ultimo Accesso al corso:</b> {c.last_access_course || "—"}
            </p>
            <p>
              <b>Ultimo Accesso piattaforma:</b> {detail.user.lastenter || "—"}
            </p>

            <p>
              <b>Stato:</b> {c.stato_descrizione || c.status}
              {c.evaso ? " /Evaso" : ""} —<b>Data Scadenza:</b>{" "}
              {c.date_expire_validity || "N/A"}
            </p>

            <p>
              <b>Documento fine corso:</b> {c.has_doc ? "✅" : "❌"} —
              <b>Generato il:</b> {c.doc_generated_at || "—"}
              {c.has_doc && (
                <button
                  onClick={() => onAction?.("delete_doc", c)}
                  className="ml-2 bg-red-600 text-white px-2 py-0.5 rounded text-xs hover:bg-red-700"
                >
                  🗑 Elimina Documento
                </button>
              )}
            </p>

            <p>
              <b>Invio Attestato:</b> {c.date_invio || "—"}
            </p>
            <p>
              <b>Ore VideoCorsi:</b> {c.ore_video || "00m 00s"}
            </p>
            <p>
              <b>Ore Totali:</b> {c.ore_totali || "00h 00m 00s"}
            </p>
          </div>
          {/* 🔘 Azioni */}
          <div className="flex flex-wrap gap-2 mb-3">
            <a
              href={`${import.meta.env.VITE_BACKEND_URL}/api/corsi/sbloccacorso?iduser=${user.idst}&idcourse=${c.idCourse}&nome=${user.firstname}&cognome=${user.lastname}&host=${detail.host}&db=${detail.db}`}
              target="_blank"
              className="bg-blue-700 text-white px-3 py-1 rounded-md"
            >
              Sblocca
            </a>

            <a
              href={`${import.meta.env.VITE_BACKEND_URL}/api/corsi/reinviamail?iduser=${user.idst}&email=${user.email}code=${c.code}&idcourse=${c.idCourse}&userid=${user.userid}nome=${user.firstname}&cognome=${user.lastname}&host=${detail.host}&db=${detail.db}`}
              target="_blank"
              className="bg-blue-700 text-white px-3 py-1 rounded-md">
              Reinvia mail
            </a>

            {/* 📜 Genera Attestato */}
            <button
              onClick={() => handleGeneraAttestato(c.idCourse!.toString())}
              disabled={loading}
              className={`inline-flex items-center gap-1 px-3 py-1 rounded text-sm text-white ${loading ? "bg-gray-400" : "bg-blue-600 hover:bg-blue-700"
                }`}
            >
              <Download size={14} />
              {loading ? "Attendi..." : "Genera Attestato"}
            </button>

            {/* 📊 Report */}
            <a
              href={`${import.meta.env.VITE_BACKEND_URL}/api/corsi/gettime?iduser=${user.idst}&idcourse=${c.idCourse}&nome=${user.firstname}&cognome=${user.lastname}&host=${detail.host}&db=${detail.db}`}
              target="_blank"
              className="bg-blue-700 text-white px-3 py-1 rounded-md"
            >
              📊 Report
            </a>

            {/* 📄 Ultimo Test */}
            <a
              href={`${import.meta.env.VITE_BACKEND_URL}/api/corsi/getlasttest?iduser=${user.idst}&idcourse=${c.idCourse}&firstname=${user.firstname}&lastname=${user.lastname}&&host=${detail.host}&db=${detail.db}`}
              target="_blank"
              className="bg-cyan-600 text-white px-3 py-1 rounded-md"
            >
              📄 Ultimo Test
            </a>
          </div>

          {/* ✅ Link Attestato */}
          {attUrlMap[c.idCourse!] && (
            <a
              href={attUrlMap[c.idCourse!]!}
              target="_blank"
              className="bg-green-600 text-white px-4 py-1 rounded-md hover:bg-green-700"
            >
              ✅ Apri Attestato
            </a>
          )}

          {/* ⚠️ Errori */}
          {errorMap[c.idCourse!] && (
            <p className="text-red-600 text-sm mt-1">
              ❌ {errorMap[c.idCourse!]}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
