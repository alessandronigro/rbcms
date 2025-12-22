
import { useState, useEffect } from "react";
import { Download } from "lucide-react";
import { useAlert } from "./SmartAlertModal";
import { backendUrl } from "@/config/backend";
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
  id_common?: number | string;
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

const pad = (value: number) => value.toString().padStart(2, "0");

const formatDate = (value?: string, includeTime = false) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();
  if (!includeTime) {
    return `${day}/${month}/${year}`;
  }
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
};

export function CambiaSlideModal({ db, idcourse, iduser, onClose }: any) {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [slides, setSlides] = useState<string[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [selectedSlide, setSelectedSlide] = useState("");
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [loadingSlides, setLoadingSlides] = useState(false);
  const { alert: showAlert } = useAlert();

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
      await showAlert("Seleziona prima un oggetto SCORM");
      return;
    }
    if (!selectedSlide) {
      await showAlert("Seleziona una slide");
      return;
    }
    try {
      const res = await fetch(`/api/corsi/cambiaslide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ db, iduser, selectedOrg, lessonlocation: selectedSlide }),
      });
      const data = await res.json();
      await showAlert(data.message || data.error);
      onClose();
    } catch (err: any) {
      await showAlert("Errore: " + err.message);
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
  const { alert: showAlert, confirm: showConfirm } = useAlert();
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [activeCourse, setActiveCourse] = useState<Course | null>(null);
  const [restoringCourseId, setRestoringCourseId] = useState<number | null>(null);
  const [deletingCourseId, setDeletingCourseId] = useState<number | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [syncingPassword, setSyncingPassword] = useState(false);
  const [normalizingCourseId, setNormalizingCourseId] = useState<number | null>(null);
  const initialCourses = detail?.courses || [];
  const [courseList, setCourseList] = useState<Course[]>(initialCourses);

  useEffect(() => {
    setCourseList(detail?.courses || []);
  }, [detail?.courses]);

  const handleCancellaCorso = async (course: Course) => {
    const db = detail?.db;
    const userId = detail?.user?.idst;
    if (!db || !userId || !course.idCourse) {
      await showAlert("Impossibile determinare il corso da cancellare");
      return;
    }
    try {
      await showConfirm(
        "Confermi di cancellare definitivamente l'iscrizione a questo corso?"
      );
    } catch {
      return;
    }

    setDeletingCourseId(course.idCourse);
    try {
      const res = await fetch(`/api/corsi/${db}/${userId}/${course.idCourse}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Errore cancellazione corso");
      }

      setCourseList((prev) =>
        prev.filter((item) => String(item.idCourse) !== String(course.idCourse))
      );
      await showAlert("✅ Corso cancellato correttamente");
    } catch (err: any) {
      await showAlert("❌ Errore cancellazione: " + err.message);
    } finally {
      setDeletingCourseId(null);
    }
  };
  // 🧩 Protezione: se non ho ancora i dati, non renderizzo nulla
  if (!detail?.user) {
    return (
      <p className="text-gray-500 italic px-4 py-2">
        ⏳ Caricamento dati utente...
      </p>
    );
  }

  const { user, fields = [] } = detail;
  const mappedFields = fields
    .map((f, index) => {
      const label =
        (f.translation && f.translation.trim()) ||
        (f.id_common ? `Campo ${f.id_common}` : `Campo #${index + 1}`);
      const value = f.user_entry?.trim() || "";
      return { label, value, id: `${f.id_common ?? label ?? index}` };
    })
    .filter((f) => f.value);

  // 🔹 Helper campi anagrafici
  const getField = (label: string) =>
    fields.find((f) => f.translation?.toLowerCase() === label.toLowerCase())
      ?.user_entry || "";

  const dbValue = (detail?.db || "").toLowerCase();
  const isSimplybizDb = dbValue === "simplybiz";

  const buildSimplybizPassword = (lastname?: string) => {
    if (!lastname) return "";
    const cleaned = lastname.trim().replace(/\s+/g, "");
    if (!cleaned) return "";
    const normalized =
      cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
    return `${normalized}12345@`;
  };

  const defaultPassword =
    getField("Password") || detail.pass || user.password || "";
  const password = isSimplybizDb
    ? buildSimplybizPassword(user.lastname)
    : defaultPassword;

  const cleanUser = user.userid?.replace("/", "") || "";

  // 🔹 Generazione attestato
  const handleReinviaMail = async (course: Course) => {
    if (!detail.db || !user?.idst || !course.idCourse) {
      await showAlert("Impossibile determinare utente o corso per reinvio");
      return;
    }
    if (!user.email && !getField("Indirizzo Email")) {
      await showAlert("Email mancante, impossibile reinviare");
      return;
    }

    const payload = {
      db: detail.db,
      iduser: user.idst,
      idcourse: course.idCourse,
      nome: user.firstname,
      cognome: user.lastname,
      email: (user.email || getField("Indirizzo Email") || "").trim(),
      userid: user.userid,
      code: course.code,
      corso: course.name,
    };

    try {
      const res = await fetch("/api/corsi/reinvia-mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || "Errore reinvio mail");
      }
      await showAlert(data.message || "Mail reinviata correttamente");
    } catch (err: any) {
      await showAlert(`❌ Errore reinvio mail: ${err.message}`);
    }
  };

  const handleCancellaUtente = async () => {
    if (!detail.db || !user?.idst) {
      await showAlert("Informazioni utente incomplete");
      return;
    }

    try {
      await showConfirm("Confermi di eliminare definitivamente questo utente?");
    } catch {
      return;
    }

    setDeletingUser(true);
    try {
      const res = await fetch(
        `/api/corsi/utenti/${detail.db}/${user.idst}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Errore cancellazione utente");
      }
      await showAlert("Utente cancellato correttamente");
    } catch (err: any) {
      await showAlert(`❌ ${err.message}`);
    } finally {
      setDeletingUser(false);
    }
  };

  const handleGeneraAttestato = async (idcorso: string) => {
    if (!user?.idst) {
      await showAlert("Utente non valido");
      return;
    }

    let scelta = false;
    try {
      await showConfirm(
        "Vuoi inviare l’attestato al corsista (attestato + test + report) oppure solo visualizzarlo?"
      );
      scelta = true;
    } catch {
      scelta = false;
    }

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
        await showAlert("✅ Attestato inviato correttamente al corsista!");
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
      await showAlert("❌ Errore: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSospendiCorso = async (course: Course) => {
    if (!detail.db || !user?.idst || !course.idCourse) return;

    const isSuspended = Number(course.status) === 3;
    // Se sospeso (3) -> Attiva (1). Se non sospeso -> Sospendi (3).
    // Nota: status=2 è completato, usiamo 1 per "In itinere/Attivo".
    const newStatus = isSuspended ? 1 : 3;

    try {
      const res = await fetch(`${backendUrl}/api/corsi/sospendi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          db: detail.db,
          iduser: user.idst,
          idcourse: course.idCourse,
          status: newStatus,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCourseList((prev) =>
          prev.map((c) =>
            c.idCourse === course.idCourse ? { ...c, status: newStatus } : c
          )
        );
        await showAlert(
          `Corso ${isSuspended ? "attivato" : "sospeso"} correttamente`
        );
      } else {
        throw new Error(data.error || "Errore aggiornamento stato");
      }
    } catch (e: any) {
      await showAlert("Errore: " + e.message);
    }
  };

  const handleRicreaTest = async (course: Course) => {
    if (!detail.db || !course.idCourse) {
      await showAlert("Impossibile determinare piattaforma o corso");
      return;
    }
    try {
      await showConfirm(
        "Ricreare il test copierà risposte da un tentativo valido e sovrascriverà i dati attuali. Vuoi continuare?"
      );
    } catch {
      return;
    }

    setRestoringCourseId(course.idCourse);
    try {
      const res = await fetch("/api/corsi/ricrea-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          db: detail.db,
          iduser: user.idst,
          idcourse: course.idCourse,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Operazione non riuscita");
      }
      await showAlert("✅ Test ricreato correttamente");
    } catch (err: any) {
      await showAlert(`❌ Errore ricreazione test: ${err.message}`);
    } finally {
      setRestoringCourseId(null);
    }
  };

  const handleSincronizzaPassword = async () => {
    if (!detail.db || !user?.idst) {
      await showAlert("Informazioni utente incomplete");
      return;
    }
    setSyncingPassword(true);
    try {
      const res = await fetch("/api/utenti/sincr-pass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ db: detail.db, iduser: user.idst }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Operazione non riuscita");
      }
      await showAlert("✅ Password sincronizzata dal campo 26");
    } catch (err: any) {
      await showAlert(
        `❌ Errore sincronizzazione password: ${err.message || "richiesta fallita"}`
      );
    } finally {
      setSyncingPassword(false);
    }
  };

  const handleNormalizzaTempo = async (course: Course) => {
    if (!detail.db || !course.idCourse || !user?.idst) {
      await showAlert("Impossibile determinare piattaforma o corso");
      return;
    }
    const extraInput = window.prompt("Ore extra da aggiungere (default 1)", "1");
    if (extraInput === null) return;
    const extraHours = Number(extraInput) || 1;
    setNormalizingCourseId(course.idCourse);
    try {
      const res = await fetch("/api/corsi/normalize-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          db: detail.db,
          idUser: user.idst,
          idCourse: course.idCourse,
          extraHours,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || "Errore normalizzazione");
      await showAlert(data.message || "Tempo normalizzato correttamente");
    } catch (err: any) {
      await showAlert(`❌ Errore normalizzazione: ${err.message || "richiesta fallita"}`);
    } finally {
      setNormalizingCourseId(null);
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
        <button
          onClick={handleCancellaUtente}
          disabled={deletingUser}
          className={`inline-block text-white text-sm px-3 py-1 rounded-md shadow-sm ${deletingUser ? "bg-red-300 cursor-not-allowed" : "bg-red-600 hover:bg-red-700"
            }`}
        >
          {deletingUser ? "Cancellazione…" : "🗑 Cancella utente"}
        </button>

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

        {mappedFields.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">
              Campi aggiuntivi (core_field_userentry)
            </h3>
            <div className="border rounded-lg overflow-hidden">
              <table className="min-w-full text-sm">
                <tbody className="divide-y divide-slate-200">
                  {mappedFields.map((field) => (
                    <tr key={field.id} className="bg-white">
                      <td className="px-3 py-2 font-medium text-slate-600 w-1/3">
                        {field.label}
                      </td>
                      <td className="px-3 py-2 text-slate-900 break-words">
                        {field.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ✅ CORSI */}
      {courseList.map((c) => {
        const isCourseCompleted = Number(c.status) === 2;
        const documentDate = formatDate(c.doc_generated_at, true);
        const invioDate = formatDate(c.date_invio);
        return (
          <div
            key={c.idCourse}
            className="bg-white border rounded-lg p-4 shadow-sm mb-4"
          >
            <p className="text-sm mb-2">
              <b className="text-red-600">{c.code}</b> — {c.name}{" "}
              <span className="text-xs text-slate-500">(ID {c.idCourse ?? "N/D"})</span>
            </p>

            <div className="text-sm space-y-1 text-gray-700">
              <p><b>Data Iscrizione:</b> {c.date_inscr || "N/D"}</p>
              <p><b>Data Completamento:</b> {c.date_complete || "N/D"}</p>
              <p><b>Ultimo Accesso Corso:</b> {c.last_access_course || "—"}</p>
              <p><b>Ultimo Accesso Piattaforma:</b> {c.last_access_platform || "—"}</p>
              <p>
                <b>Documento fine corso:</b>{" "}
                {c.has_doc
                  ? `1 - Generato il ${documentDate || c.doc_generated_at || "N/D"}`
                  : "0"}
                {c.doc_generated_at && (
                  <span className="ml-2 text-xs text-slate-500">
                    (campo on_date in learning_certificate_assign)
                  </span>
                )}
              </p>
              <p>
                <b>Invio Attestato:</b>{" "}
                {invioDate || c.date_invio || "N/D"}
                {c.date_invio && (
                  <span className="ml-2 text-xs text-slate-500">
                    (data_invio in learning_certificate_assign)
                  </span>
                )}
              </p>
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

              <button
                onClick={() => handleCancellaCorso(c)}
                disabled={!c.idCourse || deletingCourseId === c.idCourse}
                className={`px-3 py-1 rounded-md text-sm text-white ${deletingCourseId === c.idCourse
                  ? "bg-red-300 cursor-not-allowed"
                  : "bg-red-600 hover:bg-red-700"
                  }`}
              >
                {deletingCourseId === c.idCourse ? "Cancellazione…" : "🚫 Cancella corso"}
              </button>

              {/* 🔓 Sblocca corso */}
              <a
                href={`${backendUrl}/api/corsi/sbloccacorso?iduser=${user.idst}&idcourse=${c.idCourse}&nome=${user.firstname}&cognome=${user.lastname}&db=${detail.db}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-emerald-600 text-white px-3 py-1 rounded-md hover:bg-emerald-700 text-sm"
              >
                🔓 Sblocca corso
              </a>

              {/* 🗑 Elimina autocertificazione */}
              <a
                href={`${backendUrl}/api/corsi/deleteautocert?iduser=${user.idst}&idcourse=${c.idCourse}&db=${detail.db}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-red-600 text-white px-3 py-1 rounded-md hover:bg-red-700 text-sm"
              >
                🗑 Elimina autocert.
              </a>

              {/* 🚫 Sospendi / Attiva corso */}
              <button
                onClick={() => handleSospendiCorso(c)}
                className={`${Number(c.status) === 3 ? "bg-green-600 hover:bg-green-700" : "bg-yellow-600 hover:bg-yellow-700"
                  } text-white px-3 py-1 rounded-md text-sm`}
              >
                {Number(c.status) === 3 ? "✅ Attiva utente" : "🚫 Sospendi corso"}
              </button>

              <button
                onClick={() => handleReinviaMail(c)}
                className="bg-purple-600 text-white px-3 py-1 rounded-md hover:bg-purple-700 text-sm"
              >
                📧 Reinvia benvenuto
              </button>

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
                href={`${backendUrl}/api/corsi/gettime?iduser=${user.idst}&idcourse=${c.idCourse}&nome=${user.firstname}&cognome=${user.lastname}&db=${detail.db}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-blue-700 text-white px-3 py-1 rounded-md hover:bg-blue-800 text-sm"
              >
                📊 Report
              </a>

              {c.idCourse && (
                <button
                  onClick={() => handleRicreaTest(c)}
                  disabled={restoringCourseId === c.idCourse}
                  className={`px-3 py-1 rounded-md text-sm text-white ${restoringCourseId === c.idCourse
                    ? "bg-purple-300 cursor-not-allowed"
                    : "bg-purple-600 hover:bg-purple-700"
                    }`}
                >
                  {restoringCourseId === c.idCourse ? "Ricreazione…" : "🧪 Ricrea test"}
                </button>
              )}

              <button
                onClick={handleSincronizzaPassword}
                disabled={syncingPassword}
                className={`px-3 py-1 rounded-md text-sm text-white ${syncingPassword
                  ? "bg-emerald-300 cursor-not-allowed"
                  : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
              >
                {syncingPassword ? "Sincronizzazione…" : "🔐 Sincr. pass"}
              </button>

              <button
                onClick={() => handleNormalizzaTempo(c)}
                disabled={normalizingCourseId === c.idCourse}
                className={`px-3 py-1 rounded-md text-sm text-white ${normalizingCourseId === c.idCourse
                  ? "bg-blue-300 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700"
                  }`}
              >
                {normalizingCourseId === c.idCourse ? "Normalizzazione…" : "⏱ Normalizza tempo"}
              </button>

              {isCourseCompleted && (
                <>
                  {/* 📄 Ultimo Test */}
                  <a
                    href={`${backendUrl}/api/corsi/getlasttest?iduser=${user.idst}&idcourse=${c.idCourse}&firstname=${user.firstname}&lastname=${user.lastname}&db=${detail.db}`}
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
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
