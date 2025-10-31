import { useEffect, useState } from "react";

interface ModalePrenotatiAmmProps {
  idSessione: number;
  onClose: () => void;
  onReloadCalendar: () => void; // ✅ aggiunta
}

export default function ModalePrenotatiAmm({
  idSessione,
  onClose,
  onReloadCalendar,
}: ModalePrenotatiAmmProps) {
  const [loading, setLoading] = useState(true);
  const [sessione, setSessione] = useState<any>(null);

  const fetchData = async () => {
    setLoading(true);
    const res = await fetch(
      `/api/finecorsoamm/sessione/${idSessione}/dettaglio`,
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
    await fetch(`/api/finecorsoamm/sessione/${sessione.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataprova: sessione.dataprova,
        dataesame: sessione.dataesame,
        note: sessione.note,
      }),
    });
    alert("✅ Modifiche salvate");
    postActionRefresh();
  };

  const confermaSessione = async () => {
    await fetch(`/api/finecorsoamm/sessione/${sessione.id}/conferma`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        iduser: sessione.iduser,
        idcourse: sessione.idcourse,
      }),
    });

    alert("✅ Sessione Confermata");
    postActionRefresh();
  };

  const setPagato = async (pagato: number) => {
    await fetch(`/api/finecorsoamm/sessione/${sessione.id}/pagato`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pagato,
        iduser: sessione.iduser,
        idcourse: sessione.idcourse,
      }),
    });

    alert(`✅ Buon Fine: ${pagato ? "SI" : "NO"}`);
    postActionRefresh();
  };

  const inviaTest = async () => {
    await fetch(`/api/finecorsoamm/sessione/${sessione.id}/invia-test`, {
      method: "POST",
    });

    alert("✅ Test assegnato all’utente");
    postActionRefresh();
  };

  const sbloccaTest = async () => {
    await fetch(`/api/finecorsoamm/sessione/${sessione.id}/sblocca-test`, {
      method: "POST",
    });

    alert("✅ Test sbloccato");
    postActionRefresh();
  };

  const deleteSessione = async () => {
    const ok = window.confirm("⚠️ Eliminare definitivamente questa sessione?");
    if (!ok) return;

    await fetch(`/api/finecorsoamm/sessione/${sessione.id}`, {
      method: "DELETE",
    });

    alert("✅ Sessione eliminata");
    onReloadCalendar();
    onClose();
  };

  if (!sessione) return null;

  const fmt = (v: string) => (v ? new Date(v).toISOString().slice(0, 16) : "");

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-[700px] p-5 relative">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">
            📌 Gestione Sessione{" "}
            {new Date(sessione.dataesame).toLocaleString("it-IT", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
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

            {/* ✅ Date Sessione */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <label>📅 Prima Proposta</label>
                <input
                  type="datetime-local"
                  className="w-full border p-1 mt-1"
                  value={fmt(sessione.dataprova)}
                  onChange={(e) =>
                    setSessione({ ...sessione, dataprova: e.target.value })
                  }
                />
              </div>

              <div>
                <label>📅 Seconda Proposta</label>
                <input
                  type="datetime-local"
                  className="w-full border p-1 mt-1"
                  value={fmt(sessione.dataesame)}
                  onChange={(e) =>
                    setSessione({ ...sessione, dataesame: e.target.value })
                  }
                />
              </div>
            </div>

            {/* ✅ Note */}
            <div className="mt-3">
              <label>📌 Note</label>
              <input
                type="text"
                className="w-full border p-1 mt-1"
                value={sessione.note || ""}
                onChange={(e) =>
                  setSessione({ ...sessione, note: e.target.value })
                }
              />
            </div>

            {/* ✅ Fascia Bottoni */}
            <div className="grid grid-cols-3 gap-3 mt-5 text-sm">
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
                ✅ Conferma
              </button>

              <button
                onClick={() => setPagato(1)}
                className="bg-amber-600 text-white py-2 rounded hover:bg-amber-700"
              >
                💸 Buon Fine SI
              </button>

              <button
                onClick={() => setPagato(0)}
                className="bg-gray-600 text-white py-2 rounded hover:bg-gray-700"
              >
                🚫 Buon Fine NO
              </button>

              <button
                onClick={inviaTest}
                className="bg-purple-600 text-white py-2 rounded hover:bg-purple-700"
              >
                🧠 Attiva Test
              </button>

              <button
                onClick={sbloccaTest}
                className="bg-indigo-600 text-white py-2 rounded hover:bg-indigo-700"
              >
                🔓 Sblocca Test
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
