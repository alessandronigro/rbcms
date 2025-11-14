
import { useState, useEffect } from "react";
import { Download } from "lucide-react";

interface Course {
  idCourse?: number;
  code: string;
  name: string;
  date_inscr?: string;
  date_complete?: string;
  last_access_course?: string;
  last_access_platform?: string;
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
  lastenter?: string;
  convenzione?: string;
  password?: string;
}

export interface UserDetail {
  user?: User;
  courses?: Course[];
  fields?: Fields[];
  address?: string;
  pass?: string;
  db?: string;
}

interface Props {
  detail: UserDetail | null;
  onAction?: (action: string, course: Course) => void;
}

export function CambiaSlideModal({ db, idcourse, iduser, onClose }: any) {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [slides, setSlides] = useState<string[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [selectedSlide, setSelectedSlide] = useState("");
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [loadingSlides, setLoadingSlides] = useState(false);

  // 🔹 Carica i SCORM associati al corso
  useEffect(() => {
    async function loadOrgs() {
      try {
        const res = await fetch(`/api/corsi/orglist?db=${db}&idcourse=${idcourse}&_=${Date.now()}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (data.success) setOrgs(data.orgs || []);
      } catch (err) {
        console.error("Errore caricamento org:", err);
      } finally {
        setLoadingOrgs(false);
      }
    }
    loadOrgs();
  }, [db, idcourse]);

  // 🔹 Carica slide del SCORM selezionato
  async function loadSlides(idorg: string) {
    setLoadingSlides(true);
    setSlides([]);
    try {
      const res = await fetch(`/api/corsi/fillslide?db=${db}&idorg=${idorg}`);
      const data = await res.json();
      if (data.success) setSlides(data.slides || []);
    } catch (err) {
      console.error("Errore caricamento slide:", err);
    } finally {
      setLoadingSlides(false);
    }
  }

  async function handleChange() {
    if (!selectedOrg) {
      alert("Seleziona prima un oggetto SCORM");
      return;
    }
    if (!selectedSlide) return alert("Seleziona una slide");
    try {
      const res = await fetch(`/api/corsi/cambiaslide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ db, iduser, selectedOrg, lessonlocation: selectedSlide }),
      });
      const data = await res.json();
      alert(data.message || data.error);
      onClose();
    } catch (err: any) {
      alert("Errore: " + err.message);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white p-5 rounded-lg w-[480px] shadow-lg border">
        <h3 className="text-lg font-semibold mb-4">Cambia slide</h3>

        {loadingOrgs ? (
          <p>Caricamento corsi SCORM...</p>
        ) : orgs.length === 0 ? (
          <p className="text-red-500 text-sm">Nessun videocorso SCORM trovato per questo corso.</p>
        ) : (
          <>
            {/* Seleziona SCORM */}
            <label className="text-sm font-medium">Videocorso / SCORM</label>
            <select
              className="border rounded px-3 py-2 w-full mb-3"
              value={selectedOrg}
              onChange={(e) => {
                setSelectedOrg(e.target.value);
                loadSlides(e.target.value);
              }}
            >
              <option value="">Seleziona un SCORM</option>
              {orgs.map((o) => (
                <option key={o.idOrg} value={o.idOrg}>
                  {o.title}
                </option>
              ))}
            </select>

            {/* Seleziona slide */}
            {loadingSlides ? (
              <p>Caricamento slide...</p>
            ) : slides.length > 0 ? (
              <>
                <label className="text-sm font-medium">Slide</label>
                <select
                  className="border rounded px-3 py-2 w-full"
                  value={selectedSlide}
                  onChange={(e) => setSelectedSlide(e.target.value)}
                >
                  <option value="">Seleziona una slide</option>
                  {slides.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              selectedOrg && <p className="text-gray-500 text-sm mt-2">Nessuna slide trovata.</p>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1 bg-gray-200 rounded">
            Annulla
          </button>
          <button
            onClick={handleChange}
            disabled={!selectedSlide}
            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UtenteDettaglio({ detail }: Props) {
  const [] = useState<{ [key: number]: string | null }>({});
  const [] = useState<{ [key: number]: string | null }>({});
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [activeCourse, setActiveCourse] = useState<Course | null>(null);
  // 🧩 Protezione: se non ho ancora i dati, non renderizzo nulla
  if (!detail?.user) {
    return (
      <p className="text-gray-500 italic px-4 py-2">
        ⏳ Caricamento dati utente...
      </p>
    );
  }

  const { user, courses = [], fields = [] } = detail;

  // 🔹 Helper campi anagrafici
  const getField = (label: string) =>
    fields.find((f) => f.translation?.toLowerCase() === label.toLowerCase())
      ?.user_entry || "";

  const password =
    getField("Password") || detail.pass || user.password || "";

  const cleanUser = user.userid?.replace("/", "") || "";

  // 🔹 Generazione attestato
  const handleGeneraAttestato = async (idcorso: string) => {
    if (!user?.idst) return alert("Utente non valido");
    const scelta = window.confirm(
      "Vuoi inviare l’attestato al corsista (attestato + test + report) oppure solo visualizzarlo?"
    );

    setLoading(true);
    try {
      const payload = {
        iduser: user.idst,
        idcorso,
        webdb: detail.db || "formazionein",
      };

      if (scelta) {
        // 📤 INVIA attestato
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
        // 👁️ SOLO VISUALIZZA
        const res = await fetch(`/api/attestati/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.success)
          throw new Error(data.error || "Errore generazione attestato");
        window.open(data.file, "_blank");
      }
    } catch (err: any) {
      alert("❌ Errore: " + err.message);
    } finally {
      setLoading(false);
    }
  };


  const getStatusBadge = (status?: number | string) => {
    const s = Number(status);
    switch (s) {
      case 0:
        return (
          <span className="px-2 py-0.5 text-xs font-semibold bg-gray-200 text-gray-800 rounded">
            Iscritto
          </span>
        );
      case 1:
        return (
          <span className="px-2 py-0.5 text-xs font-semibold bg-blue-200 text-blue-800 rounded">
            In itinere
          </span>
        );
      case 2:
        return (
          <span className="px-2 py-0.5 text-xs font-semibold bg-green-200 text-green-800 rounded">
            Completato
          </span>
        );
      case 3:
        return (
          <span className="px-2 py-0.5 text-xs font-semibold bg-red-200 text-red-800 rounded">
            Sospeso
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-700 rounded">
            N/D
          </span>
        );
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

        {/* ✅ DATI ANAGRAFICI */}
        <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm text-gray-800 mt-4">
          <p>
            <b>Username:</b> {cleanUser}
          </p>
          <p>
            <b>Password:</b> {password || "—"}
          </p>
          <p>
            <b>Email utente:</b>{" "}
            {getField("Indirizzo Email")?.toLowerCase() || user.email || "—"}
          </p>
          <p>
            <b>Codice Fiscale:</b> {getField("Codice Fiscale") || user.cf || "—"}
          </p>
          <p>
            <b>Convenzione:</b> {getField("Convenzione") || user.convenzione || "—"}
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

          <div className="text-sm space-y-1 text-gray-700">
            <p><b>Data Iscrizione:</b> {c.date_inscr || "N/D"}</p>
            <p><b>Data Completamento:</b> {c.date_complete || "N/D"}</p>
            <p><b>Ultimo Accesso Corso:</b> {c.last_access_course || "—"}</p>
            <p><b>Ultimo Accesso Piattaforma:</b> {c.last_access_platform || "—"}</p>
            <p className="flex items-center gap-2">
              <b>Stato:</b> {getStatusBadge(c.status)}
            </p>
            <p>
              <b>Scadenza:</b>{" "}
              {c.date_expire_validity || "N/A"}
            </p>
            <p>
              <b>Ore Video:</b> {c.ore_video || "00m 00s"} — <b>Tempo Piattaforma:</b>{" "}
              {c.ore_totali || "00h 00m 00s"}
            </p>
          </div>

          {/* 🔘 Azioni corso */}


          <div className="flex flex-wrap gap-2 mb-3 mt-2">

            {/* 🚫 Sospendi corso */}
            <a
              href={`${import.meta.env.VITE_BACKEND_URL}/api/courses/${detail.db}/${user.idst}/${c.idCourse}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-red-600 text-white px-3 py-1 rounded-md hover:bg-yellow-700 text-sm"
            >
              🚫 Cancella corso
            </a>

            {/* 🔓 Sblocca corso */}
            <a
              href={`${import.meta.env.VITE_BACKEND_URL}/api/corsi/sbloccacorso?iduser=${user.idst}&idcourse=${c.idCourse}&nome=${user.firstname}&cognome=${user.lastname}&db=${detail.db}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-emerald-600 text-white px-3 py-1 rounded-md hover:bg-emerald-700 text-sm"
            >
              🔓 Sblocca corso
            </a>

            {/* 🗑 Elimina autocertificazione */}
            <a
              href={`${import.meta.env.VITE_BACKEND_URL}/api/corsi/deleteautocert?iduser=${user.idst}&idcourse=${c.idCourse}&db=${detail.db}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-red-600 text-white px-3 py-1 rounded-md hover:bg-red-700 text-sm"
            >
              🗑 Elimina autocert.
            </a>

            {/* 🚫 Sospendi corso */}
            <a
              href={`${import.meta.env.VITE_BACKEND_URL}/api/corsi/sospendi?iduser=${user.idst}&idcourse=${c.idCourse}&db=${detail.db}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-yellow-600 text-white px-3 py-1 rounded-md hover:bg-yellow-700 text-sm"
            >
              🚫 Sospendi corso
            </a>

            {showModal && activeCourse && (
              <CambiaSlideModal
                db={detail.db}
                idcourse={activeCourse.idCourse}
                iduser={user.idst}
                onClose={() => {
                  setShowModal(false);
                  setActiveCourse(null);
                }}
              />
            )}

            <button
              onClick={() => {
                setActiveCourse(c);
                setShowModal(true);
              }}
              className="bg-indigo-600 text-white px-3 py-1 rounded-md text-sm hover:bg-indigo-700"
            >
              🔄 Cambia Slide
            </button>
            {/* 📊 Report */}
            <a
              href={`${import.meta.env.VITE_BACKEND_URL}/api/corsi/gettime?iduser=${user.idst}&idcourse=${c.idCourse}&nome=${user.firstname}&cognome=${user.lastname}&db=${detail.db}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-blue-700 text-white px-3 py-1 rounded-md hover:bg-blue-800 text-sm"
            >
              📊 Report
            </a>

            {/* 📄 Ultimo Test */}
            <a
              href={`${import.meta.env.VITE_BACKEND_URL}/api/corsi/getlasttest?iduser=${user.idst}&idcourse=${c.idCourse}&firstname=${user.firstname}&lastname=${user.lastname}&db=${detail.db}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-cyan-600 text-white px-3 py-1 rounded-md hover:bg-cyan-700 text-sm"
            >
              📄 Ultimo Test
            </a>

            {/* 📜 Genera Attestato */}
            <button
              onClick={() => handleGeneraAttestato(c.idCourse!.toString())}
              disabled={loading}
              className={`inline-flex items-center gap-1 px-3 py-1 rounded text-sm text-white ${loading ? "bg-gray-400" : "bg-green-600 hover:bg-green-700"
                }`}
            >
              <Download size={14} />
              {loading ? "Attendi..." : "Genera Attestato"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
