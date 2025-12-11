import { useEffect, useState } from "react";
import { useAlert } from "../../components/SmartAlertModal";

interface ModalePrenotatiProps {
  idSessione: number;
  onClose: () => void;
  onReloadCalendar: () => void; // ✅ aggiunta
}

export default function ModalePrenotati({
  idSessione,
  onClose,
  onReloadCalendar,
}: ModalePrenotatiProps) {
  const [loading, setLoading] = useState(true);
  const [sessione, setSessione] = useState<any>(null);
  const [creatingZoom, setCreatingZoom] = useState(false);
  const { alert: showAlert, confirm: showConfirm } = useAlert();
  const askConfirm = async (message: string) => {
    try {
      await showConfirm(message);
      return true;
    } catch {
      return false;
    }
  };

  const fetchData = async () => {
    setLoading(true);
    const res = await fetch(
      `/api/finecorso60h/sessione/${idSessione}/dettaglio`,
    );
    const json = await res.json();
    setSessione(json);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [idSessione]);

  // ✅ utility per refresh dopo azione
  const postActionRefresh = () => {
    fetchData();
    onReloadCalendar(); // 🔥 refresh calendario
  };

  const updateField = async () => {
    await fetch(`/api/finecorso60h/sessione/${sessione.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataprova: sessione.dataprova || sessione.dataesame,
        dataesame: sessione.dataesame,
        note: sessione.note,
      }),
    });
    await showAlert("✅ Modifiche salvate");
    postActionRefresh();
  };

  const confermaSessione = async () => {
    await fetch(`/api/finecorso60h/sessione/${sessione.id}/conferma`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        iduser: sessione.iduser,
        idcourse: sessione.idcourse,
      }),
    });

    await showAlert("✅ Sessione Confermata");
    postActionRefresh();
  };

  const annullaConferma = async () => {
    await fetch(`/api/finecorso60h/sessione/${sessione.id}/conferma-no`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        iduser: sessione.iduser,
        idcourse: sessione.idcourse,
      }),
    });

    await showAlert("ℹ️ Conferma annullata");
    postActionRefresh();
  };

  const setPagato = async (pagato: number) => {
    await fetch(`/api/finecorso60h/sessione/${sessione.id}/pagato`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pagato,
        iduser: sessione.iduser,
        idcourse: sessione.idcourse,
      }),
    });

    await showAlert(`✅ Buon Fine: ${pagato ? "SI" : "NO"}`);
    postActionRefresh();
  };

  const inviaTest = async () => {
    await fetch(`/api/finecorso60h/sessione/${sessione.id}/invia-test`, {
      method: "POST",
    });

    await showAlert("✅ Test assegnato all’utente");
    postActionRefresh();
  };

  const sbloccaTest = async () => {
    await fetch(`/api/finecorso60h/sessione/${sessione.id}/sblocca-test`, {
      method: "POST",
    });

    await showAlert("✅ Test sbloccato");
    postActionRefresh();
  };

  const deleteSessione = async () => {
    if (!(await askConfirm("⚠️ Eliminare definitivamente questa sessione?"))) return;

    await fetch(`/api/finecorso60h/sessione/${sessione.id}`, {
      method: "DELETE",
    });

    await showAlert("✅ Sessione eliminata");
    onReloadCalendar();
    onClose();
  };

  const creaZoomMeeting = async () => {
    if (!sessione?.id) return;
    try {
      setCreatingZoom(true);
      const res = await fetch(`/api/finecorso60h/sessione/${sessione.id}/zoom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Errore creazione evento Zoom");
      }

      await showAlert(
        `🎥 Meeting Zoom creato. Link inviato all'utente.\nCodice: ${data.meetingId}`,
      );

      const zoomLink = data.startUrl || data.authorizeUrl;
      if (zoomLink) {
        window.open(zoomLink, "_blank", "noopener,noreferrer");
      }
    } catch (err: any) {
      await showAlert(err.message || "Errore creazione evento Zoom");
    } finally {
      setCreatingZoom(false);
    }
  };

  if (!sessione) return null;

  const primarySessionDate = sessione.dataesame || sessione.dataprova;
  const eventLabel = sessione.nomesessione || (sessione.idparent ? "Sessione alternativa" : "Sessione finale");

  const fmt = (v: string) => {
    if (!v) return "";
    const date = new Date(v);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-[700px] p-5 relative">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">
            📌 Gestione Sessione{" "}
            {primarySessionDate
              ? new Date(primarySessionDate).toLocaleString("it-IT", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "Data non disponibile"}
          </h2>

          <div className="flex items-center gap-2">
            <button
              onClick={deleteSessione}
              className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
              title="Cancella definitivamente la sessione"
            >
              ❌ Cancella
            </button>

            <button
              onClick={onClose}
              className="px-2 py-1 bg-gray-300 rounded hover:bg-gray-400 text-sm"
            >
              ✖
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-4">⏳ Caricamento...</div>
        ) : (
          <>
            {/* ✅ Dati Utente */}
            <div className="bg-gray-50 p-3 rounded-md text-sm mb-4">
              <p>
                <b>Nome:</b> {sessione.nome_utente} {sessione.cognome_utente}
              </p>
              <p>
                <b>Email:</b> {sessione.email_utente}
              </p>
              <p>
                <b>CF:</b> {sessione.cf_utente}
              </p>
              <p>
                <b>Telefono:</b> {sessione.telefono_utente}
              </p>
              <p>
                <b>Indirizzo:</b> {sessione.indirizzo_utente}
              </p>
            </div>

            {/* ✅ Data evento */}
            <div className="text-sm mb-4">
              <label className="font-semibold block">
                📅 {eventLabel}
              </label>
              <p className="text-xs text-gray-500 mb-1">
                Modifica solo la data dell'evento selezionato
              </p>
              <input
                type="datetime-local"
                className="w-full border p-1 mt-1"
                value={fmt(sessione.dataesame)}
                onChange={(e) =>
                  setSessione({ ...sessione, dataesame: e.target.value })
                }
              />
            </div>

            {/* ✅ Note sessione */}
            <div className="mt-3">
              <label>📌 Note sessione</label>
              <textarea
                className="w-full border p-2 mt-1 rounded min-h-[70px]"
                value={sessione.note || ""}
                onChange={(e) =>
                  setSessione({ ...sessione, note: e.target.value })
                }
              />
            </div>

            {/* ✅ Fascia Bottoni */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-5 text-sm">
              <button
                onClick={updateField}
                className="bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
              >
                💾 Salva
              </button>

              <button
                onClick={confermaSessione}
                className="bg-green-600 text-white py-2 rounded hover:bg-green-700"
              >
                ✅ Conferma SI
              </button>

              <button
                onClick={annullaConferma}
                className="bg-gray-200 text-gray-900 py-2 rounded border border-gray-400 hover:bg-gray-300"
              >
                🚫 Conferma NO
              </button>

              <button
                onClick={() => setPagato(1)}
                className="bg-pink-300 text-pink-900 font-semibold py-2 rounded hover:bg-pink-200"
              >
                💸 Buon Fine SI
              </button>

              <button
                onClick={() => setPagato(0)}
                className="bg-red-500 text-white py-2 rounded hover:bg-red-600"
              >
                🚫 Buon Fine NO
              </button>

              {!sessione.test_attivo ? (
                <button
                  onClick={inviaTest}
                  className="bg-purple-600 text-white py-2 rounded hover:bg-purple-700"
                >
                  🧠 Attiva Test
                </button>
              ) : (
                <button
                  onClick={sbloccaTest}
                  className="bg-indigo-600 text-white py-2 rounded hover:bg-indigo-700"
                >
                  🔓 Sblocca Test
                </button>
              )}

              <button
                onClick={creaZoomMeeting}
                disabled={creatingZoom}
                className="col-span-2 md:col-span-3 bg-rose-600 text-white py-2 rounded hover:bg-rose-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {creatingZoom ? "⏳ Creazione Zoom..." : "🎥 Crea evento Zoom"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
