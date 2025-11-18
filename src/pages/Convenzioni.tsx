import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAlert } from "../components/SmartAlertModal";

export default function Convenzioni() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibile, setVisibile] = useState<number | null>(1); // ✅ parte con attive
  const [filtro, setFiltro] = useState<number | null>(0); // ✅ filtro neutro
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
  }, [visibile, filtro]);

  const elimina = async (codice: string) => {
    if (!(await askConfirm("Vuoi cancellare la convenzione?"))) return;
    await fetch(`/api/convenzioni/${codice}`, { method: "DELETE" });
    fetchData();
  };

  const apriDettaglio = (codice: string, readonly = false) =>
    navigate(`/convenzioni/${codice}${readonly ? "?readonly=1" : ""}`);

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
          onClick={() => navigate("/convenzioni/nuova")}
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
                    <a
                      href={row.indirizzoweb}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-500 underline"
                    >
                      {row.indirizzoweb}
                    </a>
                  </td>
                  <td className="p-2">{row.ref1}</td>
                  <td className="p-2">{row.excel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
