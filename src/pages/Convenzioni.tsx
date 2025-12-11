import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAlert } from "../components/SmartAlertModal";

export default function Convenzioni() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibile, setVisibile] = useState<number | null>(1); // ✅ parte con attive
  const [filtro, setFiltro] = useState<number | null>(0); // ✅ filtro neutro
  const [showNewModal, setShowNewModal] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newLoading, setNewLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newError, setNewError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const navigate = useNavigate();
  const { confirm: showConfirm } = useAlert();
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
    try {
      const params = new URLSearchParams();
      if (visibile !== null) params.append("visibile", visibile.toString());
      if (filtro !== null) params.append("filtro", filtro.toString());
      if (searchTerm) params.append("q", searchTerm);

      const res = await fetch(`/api/convenzioni?${params}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [visibile, filtro, searchTerm]);

  const loadRandomCode = useCallback(async () => {
    setNewLoading(true);
    setNewError("");
    try {
      const res = await fetch("/api/convenzioni/code/random");
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error || "Errore generazione codice");
      }
      setNewCode(payload?.code ?? "");
    } catch (err) {
      console.error("Errore generazione codice convenzione:", err);
      setNewError(err instanceof Error ? err.message : "Errore generazione codice");
    } finally {
      setNewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!showNewModal) return;
    setNewName("");
    setNewError("");
    loadRandomCode();
  }, [showNewModal, loadRandomCode]);

  const handleSearch = () => {
    setSearchTerm(searchInput.trim());
  };

  const handleResetSearch = () => {
    setSearchInput("");
    setSearchTerm("");
  };

  const elimina = async (codice: string) => {
    if (!(await askConfirm("Vuoi cancellare la convenzione?"))) return;
    await fetch(`/api/convenzioni/${codice}`, { method: "DELETE" });
    fetchData();
  };

  const apriDettaglio = (codice: string, readonly = false) =>
    navigate(`/convenzioni/${codice}${readonly ? "?readonly=1" : ""}`);

  const handleModalClose = () => {
    setShowNewModal(false);
    setNewError("");
    setNewCode("");
    setNewName("");
    setNewLoading(false);
  };

  const handleCreate = async () => {
    if (!newCode.trim() || !newName.trim()) return;
    setCreating(true);
    setNewError("");
    try {
      const res = await fetch("/api/convenzioni", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codice: newCode.trim(), nome: newName.trim() }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error || "Errore creazione convenzione");
      }
      if (!payload?.codice) {
        throw new Error("Codice creato non disponibile");
      }
      setShowNewModal(false);
      setNewCode("");
      setNewName("");
      navigate(`/convenzioni/${payload.codice}`);
    } catch (err) {
      setNewError(err instanceof Error ? err.message : "Errore creazione convenzione");
    } finally {
      setCreating(false);
    }
  };

  // ✅ stile per pulsanti attivi / inattivi
  const btnClass = (active: boolean) =>
    `px-3 py-1 rounded text-sm font-medium transition-colors ${active
      ? "bg-green-500 text-white shadow"
      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
    }`;

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold text-gray-800">Gestione Convenzioni</h1>
        <button
          onClick={() => setShowNewModal(true)}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
        >
          + Nuova convenzione
        </button>
      </div>

      {/* FILTRI */}
      <div className="flex flex-wrap gap-2 mt-2">
        <button onClick={() => { setVisibile(1); setFiltro(0); }} className={btnClass(visibile === 1 && filtro === 0)}>
          Attive
        </button>
        <button onClick={() => { setVisibile(0); setFiltro(0); }} className={btnClass(visibile === 0 && filtro === 0)}>
          Disattive
        </button>
        <button onClick={() => { setVisibile(1); setFiltro(3); }} className={btnClass(visibile === 1 && filtro === 3)}>
          RB Academy
        </button>
        <button onClick={() => { setVisibile(1); setFiltro(2); }} className={btnClass(visibile === 1 && filtro === 2)}>
          SNA Attive
        </button>
        <button onClick={() => { setVisibile(0); setFiltro(2); }} className={btnClass(visibile === 0 && filtro === 2)}>
          SNA Disattive
        </button>
        <button onClick={() => { setVisibile(null); setFiltro(null); }} className={btnClass(visibile === null)}>
          Tutte
        </button>
      </div>
      <div className="flex flex-wrap gap-2 items-center mt-2">
        <input
          type="text"
          placeholder="Cerca per codice o nome..."
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          className="flex-1 min-w-[200px] rounded border px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={handleSearch}
          className="px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
        >
          Cerca
        </button>
        <button
          type="button"
          onClick={handleResetSearch}
          className="px-3 py-2 text-sm rounded border text-gray-700 hover:bg-gray-100"
        >
          Annulla
        </button>
        {searchTerm && (
          <span className="text-xs text-gray-500">
            Filtro attivo: <strong>{searchTerm}</strong>
          </span>
        )}
      </div>

      {/* TABELLA */}
      {loading ? (
        <p className="text-center text-gray-500 mt-4">Caricamento...</p>
      ) : (
        <div className="overflow-x-auto border rounded-md mt-4">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100 text-gray-600">
              <tr>
                <th className="p-2">Azioni</th>
                <th className="p-2">Convenzione</th>
                <th className="p-2">Codice</th>
                <th className="p-2">Tipo</th>
                <th className="p-2">Indirizzo</th>
                <th className="p-2">Indirizzo 2025</th>
                <th className="p-2">Referente</th>
                <th className="p-2">Excel</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row: any) => (
                <tr key={row.Codice} className="border-t hover:bg-gray-50">
                  <td className="p-2 flex gap-2">
                    <button
                      onClick={() => apriDettaglio(row.Codice)}
                      title="Modifica"
                      className="text-green-600 hover:text-green-800"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => apriDettaglio(row.Codice, true)}
                      title="Visualizza"
                      className="text-yellow-600 hover:text-yellow-800"
                    >
                      👁️
                    </button>
                    <button
                      onClick={() => elimina(row.Codice)}
                      title="Elimina"
                      className="text-red-500 hover:text-red-700"
                    >
                      🗑️
                    </button>
                    <a
                      href={`/convenzioni/${row.Codice}/delegati`}
                      title="Delegati"
                      className="text-blue-600 hover:text-blue-800"
                    >
                      👥
                    </a>
                  </td>
                  <td className="p-2">{row.Name}</td>
                  <td className="p-2">{row.Codice}</td>
                  <td className="p-2">{row.tipo}</td>
                  <td className="p-2">
                    {row.indirizzoweb ? (
                      <a
                        href={row.indirizzoweb}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-500 underline"
                      >
                        {row.indirizzoweb}
                      </a>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="p-2">
                    {row.newindirizzoweb ? (
                      <a
                        href={row.newindirizzoweb}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-500 underline"
                      >
                        {row.newindirizzoweb}
                      </a>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="p-2">{row.ref1}</td>
                  <td className="p-2">{row.excel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showNewModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-lg font-semibold text-gray-800">Nuova convenzione</h2>
              <button
                type="button"
                onClick={handleModalClose}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="p-4 space-y-4 text-sm">
              <div>
                <label className="text-xs text-gray-500">Codice (4 cifre)</label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    value={newCode}
                    onChange={(event) => setNewCode(event.target.value)}
                    className="flex-1 border rounded px-3 py-2 text-sm"
                    disabled={newLoading}
                  />
                  <button
                    type="button"
                    onClick={loadRandomCode}
                    disabled={newLoading}
                    className="rounded border px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {newLoading ? "Generazione…" : "Rigenera"}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Nome convenzione</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  className="mt-1 w-full border rounded px-3 py-2 text-sm"
                />
              </div>
              {newError && (
                <p className="text-xs text-red-600 leading-relaxed">{newError}</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
              <button
                type="button"
                onClick={handleModalClose}
                className="px-3 py-2 text-sm border rounded text-gray-700 hover:bg-gray-100"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={
                  creating ||
                  newLoading ||
                  !newCode.trim() ||
                  !newName.trim()
                }
                className={`px-4 py-2 text-sm rounded text-white ${
                  creating || newLoading || !newCode.trim() || !newName.trim()
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {creating ? "Salvataggio…" : "Crea convenzione"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
