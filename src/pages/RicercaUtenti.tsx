import React, { useState } from "react";
import UtenteDettaglio from "@/components/UtenteDettaglio";


interface User {
  idst: number;
  firstname: string;
  lastname: string;
  user_entry: string;
}

interface DetailData {
  user: any;
  fields: { translation: string; user_entry: string }[];
  courses: { name: string; code: string; date_inscr: string; status: number }[];
}

export default function RicercaUtenti() {
  const [mainDb, setMainDb] = useState("formazionein");
  const [filters, setFilters] = useState({
    nome: "",
    cognome: "",
    nominativo: "",
  });
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Record<string, User[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, DetailData | null>>({});

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    if (name === "mainDb") setMainDb(value);
    else setFilters((prev) => ({ ...prev, [name]: value }));
  };

  function getPlatformLabel(key: string) {
    if (key.includes("IFAD") || key.includes("forma4")) return "Piattaforma 2025";
    if (key.includes("EFAD") || key.includes("newformazionein"))
      return "Piattaforma 2018–2024";
    if (key.includes("SITE") || key.includes("formazionein"))
      return "Piattaforma 2011–2018";
    return key.replace("_", " → ");
  }

  function getPlatformColor(key: string) {
    const k = key.toLowerCase();
    if (k.includes("ifad") || k.includes("forma4"))
      return "bg-green-200 text-green-900 border-green-400";
    if (k.includes("efad") || k.includes("newformazionein"))
      return "bg-blue-200 text-blue-900 border-blue-400";
    if (k.includes("site") || k.includes("formazionein"))
      return "bg-amber-200 text-amber-900 border-amber-400";
    return "bg-gray-200 text-gray-800 border-gray-400";
  }

  const handleSearch = async () => {
    setLoading(true);
    setResults({});
    try {
      const params = new URLSearchParams({
        main: mainDb,
        nome: filters.nome,
        cognome: filters.cognome,
        nominativo: filters.nominativo,
      });
      const res = await fetch(`/api/utenti/multi?${params.toString()}`);
      const data = await res.json();
      console.log("🟢 Risultati:", data);
      setResults(data.results || {});
    } catch (err) {
      console.error("❌ Errore ricerca utenti:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = async (key: string, user: User) => {
    const uniqueKey = `${key}_${user.idst}`;
    if (expanded === uniqueKey) {
      setExpanded(null);
      return;
    }

    setExpanded(uniqueKey);

    if (!details[uniqueKey]) {
      try {
        const [host, db] = key.split("_");
        const params = new URLSearchParams({
          host,
          db,
          firstname: user.firstname,
          lastname: user.lastname,
          user_entry: user.user_entry,
        });
        const res = await fetch(`/api/utenti/detail?${params.toString()}`);
        const data = await res.json();
        setDetails((prev) => ({ ...prev, [uniqueKey]: data }));
      } catch (err) {
        console.error("❌ Errore caricamento dettaglio:", err);
        setDetails((prev) => ({ ...prev, [uniqueKey]: null }));
      }
    }
  };



  return (
    <div className="p-4 space-y-6">
      <h1 className="text-xl font-semibold text-gray-800">🔍 Ricerca Utenti</h1>

      {/* 🔹 Barra di ricerca */}
      <div className="bg-white rounded-lg shadow p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <select
          name="mainDb"
          value={mainDb}
          onChange={handleChange}
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="formazionein">RB Formazione</option>
          <option value="simplybiz">SimplyBiz</option>
          <option value="formazionecondo">Assiac</option>
          <option value="efadnovastudia">Nova Studia</option>
        </select>

        <input
          name="nome"
          placeholder="Nome"
          value={filters.nome}
          onChange={handleChange}
          className="border rounded px-3 py-2 text-sm"
        />
        <input
          name="cognome"
          placeholder="Cognome"
          value={filters.cognome}
          onChange={handleChange}
          className="border rounded px-3 py-2 text-sm"
        />
        <input
          name="nominativo"
          placeholder="Codice fiscale o email"
          value={filters.nominativo}
          onChange={handleChange}
          className="border rounded px-3 py-2 text-sm"
        />

        <div className="md:col-span-4 flex justify-end">
          <button
            onClick={handleSearch}
            disabled={loading}
            className={`px-4 py-2 rounded text-white text-sm ${loading ? "bg-gray-400" : "bg-blue-600 hover:bg-blue-700"
              }`}
          >
            {loading ? "Ricerca in corso..." : "Cerca"}
          </button>
        </div>
      </div>

      {/* 🔹 Risultati */}
      {loading && (
        <p className="text-gray-500 text-center">Caricamento risultati...</p>
      )}

      {!loading && Object.keys(results).length === 0 && (
        <p className="text-gray-500 text-center italic">
          Nessun risultato da mostrare
        </p>
      )}

      <div className="space-y-6">
        {Object.entries(results).map(([key, block]) => {
          const rows = (block as any)?.data || [];

          return (
            <div
              key={key}
              className="bg-white rounded-lg shadow overflow-x-auto border"
            >
              <div
                className={`p-3 font-semibold border-b ${getPlatformColor(key)}`}
              >
                {getPlatformLabel(key)} ({rows.length} risultati)
              </div>

              <table className="min-w-full text-sm text-left">
                <thead className="bg-gray-100 text-gray-700 uppercase text-xs">
                  <tr>
                    <th className="px-3 py-2 w-12">#</th>
                    <th className="px-3 py-2">Nome</th>
                    <th className="px-3 py-2">Cognome</th>
                    <th className="px-3 py-2">Codice Fiscale</th>
                    <th className="px-3 py-2">ID Utente</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.isArray(rows) && rows.length > 0 ? (
                    rows.map((r: any) => {
                      const uniqueKey = `${key}_${r.idst}`;
                      const isExpanded = expanded === uniqueKey;
                      const detail = details[uniqueKey];

                      return (
                        <React.Fragment key={uniqueKey}>
                          <tr
                            className={`border-b ${isExpanded ? "bg-blue-50" : "hover:bg-gray-50"}`}
                          >
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => toggleExpand(key, r)}
                                className="text-blue-600 hover:underline text-xs"
                              >
                                {isExpanded ? "−" : "+"}
                              </button>
                            </td>
                            <td className="px-3 py-2">{r.firstname}</td>
                            <td className="px-3 py-2">{r.lastname}</td>
                            <td className="px-3 py-2">{r.user_entry}</td>
                            <td className="px-3 py-2">{r.idst}</td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={5}>
                                <UtenteDettaglio
                                  detail={detail}
                                  onAction={(action, corso) => {
                                    console.log(
                                      "Azione richiesta:",
                                      action,
                                      corso,
                                    );
                                    // qui chiameremo le API: /api/corsi/sospendi, /api/corsi/delete, ecc.
                                  }}
                                />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        className="text-center text-gray-400 py-3 italic"
                      >
                        Nessun risultato in {key}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
