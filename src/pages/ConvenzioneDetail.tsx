import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";

/** ============================
 *  Tipi
 * ============================ */
interface Convenzione {
  Codice?: string;
  Name?: string;
  tipo?: string;
  piattaforma?: string;
  indirizzoweb?: string;
  mailbcc?: string;

  ragsoc?: string;
  sede?: string;
  sedesocieta?: string;
  cap?: string;
  regione?: string;
  provincia?: string;
  comune?: string;

  piva?: string;
  cf?: string;
  pec?: string;
  codicedestinatario?: string;

  tel?: string;
  email?: string;

  Ref1?: string;
  RefTel1?: string;
  RefEmail1?: string;
  Ref2?: string;
  RefTel2?: string;
  RefEmail2?: string;

  note?: string;
  excel?: string;
  caserta?: string;
  roma?: string;
  domicilio?: string;
  fast?: string;
  sededistaccata?: string;

  inizioconvenzione?: string;
  fineconvenzione?: string;

  fattfinemese?: boolean;
  fattsingoloutente?: boolean;
  pacchetti?: boolean;
  piattgratuita?: boolean;
  piattpagamento?: boolean;
  fattura?: boolean;
  test60?: boolean;
  iscrizione?: boolean;
  provv?: boolean;
  referral?: boolean;
  sospendireport?: boolean;
  sospendiacquisti?: boolean;
  visibilita?: boolean;

  filtro?: number;
}

interface CorsoRow {
  codice: string;                 // code (learning_course.code)
  nome: string;                   // name (learning_course.name)
  prezzo: string;                 // stringa (vuota = 0/non impostato)
  years: Record<number, number>;  // {2025: 3, 2024: 0, ...}
}

interface APIResponse {
  convenzione: Convenzione;
  corsi: CorsoRow[];
  years: number[];
}

/** Helper: normalizza le date in formato accettato dagli <input type="date"> */
const normalizeDateInput = (d?: string) => {
  if (!d) return "";
  // accetta "dd/MM/yyyy", "yyyy-MM-dd", "yyyy-MM-dd HH:mm:ss"
  if (d.includes("/")) {
    const [dd, mm, yyyy] = d.split("/");
    if (yyyy && mm && dd) return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return d.split(" ")[0]; // estrae solo la parte yyyy-MM-dd
};

/** Helper: classi colore per categoria corso */
const courseColor = (code: string) => {
  const upper = code.toUpperCase();
  if (upper.includes("OAM")) return "text-purple-700"; // OAM
  if (upper.match(/35(?![A-Z])/i) || upper.includes("6035") || upper.includes("1535") || upper.includes("3035") || upper.includes("4535"))
    return "text-blue-700"; // IVASS (35/60/30/45)
  return "text-gray-900";
};

export default function ConvenzioneDetail() {
  const { codice } = useParams();
  const [search] = useSearchParams();
  const readonly = search.get("readonly") === "1";
  const navigate = useNavigate();

  // Stato form sinistra
  const [form, setForm] = useState<Convenzione>({});

  // Stato tabella destra
  const [corsi, setCorsi] = useState<CorsoRow[]>([]);
  const [years, setYears] = useState<number[]>([]);

  // UI
  const [loading, setLoading] = useState(true);
  const [editCode, setEditCode] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  // Caricamento dati full backend (convenzione + corsi + anni)
  useEffect(() => {
    if (!codice) return;
    setLoading(true);
    fetch(`/api/convenzioni/${codice}/full`)
      .then((res) => res.json())
      .then((data: APIResponse) => {
        setForm({
          ...data.convenzione,
          inizioconvenzione: normalizeDateInput(data.convenzione.inizioconvenzione),
          fineconvenzione: normalizeDateInput(data.convenzione.fineconvenzione),
        });
        setCorsi(data.corsi || []);
        setYears(data.years || []);
      })
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [codice]);

  /** Gestione change dei campi di sinistra */
  const handleFormChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, type, value } = e.target;
    const isCheckbox = type === "checkbox";
    const checked = (e.target as HTMLInputElement).checked;

    setForm((prev) => ({
      ...prev,
      [name]: isCheckbox ? checked : value,
    }));
  };

  /** Salva SOLO i dettagli convenzione (sinistra) */
  const saveForm = async () => {
    if (!codice) return;

    // serializza i boolean per il backend (se serve), qui li mandiamo così come sono
    const res = await fetch(`/api/convenzioni/${codice}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    if (!res.ok) {
      alert("❌ Errore salvataggio dati convenzione");
      return;
    }
    alert("✅ Dettagli convenzione salvati");
    navigate("/convenzioni");
  };

  /** Entra in edit di una singola riga prezzo (destra) */
  const startEdit = (row: CorsoRow) => {
    if (readonly) return;
    setEditCode(row.codice);
    setEditValue(row.prezzo ?? "");
  };

  /** Conferma salvataggio prezzo SINGOLA riga (destra) */
  const commitEdit = async (row: CorsoRow) => {
    if (!codice) return;
    const prezzoClean = editValue.trim();
    const body = {
      codiceCorso: row.codice,
      prezzo: prezzoClean === "" ? null : Number(prezzoClean.replace(",", ".")),
    };

    const res = await fetch(`/api/convenzioni/${codice}/prezzi`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      alert("❌ Errore salvataggio prezzo");
      return;
    }

    // aggiorna solo la riga modificata
    setCorsi((prev) =>
      prev.map((c) => (c.codice === row.codice ? { ...c, prezzo: prezzoClean } : c))
    );
    setEditCode(null);
  };

  if (loading) return <p className="p-4 text-gray-500">Caricamento…</p>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Gestione Convenzione</h1>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(360px,520px)_1fr] gap-6">
        {/* =========================
            COLONNA SINISTRA — FORM
           ========================= */}
        <div className="space-y-4">
          {/* Sezioni a fisarmonica (native <details>) */}
          <details open className="border rounded">
            <summary className="px-3 py-2 font-semibold bg-gray-50 cursor-pointer">
              📌 Convenzione / Commerciale
            </summary>
            <div className="p-3 grid grid-cols-1 gap-3">
              {[
                ["Codice", "Codice"],
                ["Name", "Nome convenzione"],
                ["tipo", "Tipologia"],
                ["piattaforma", "Piattaforma"],
                ["indirizzoweb", "Indirizzo web"],
                ["mailbcc", "Mail BCC"],
                ["excel", "Nome Excel"],
              ].map(([key, label]) => (
                <div key={key}>
                  <label className="text-xs text-gray-500">{label}</label>
                  <input
                    name={key}
                    value={(form as any)[key] ?? ""}
                    onChange={handleFormChange}
                    readOnly={readonly && key !== "Codice"}
                    className="border rounded p-2 w-full text-sm"
                  />
                </div>
              ))}

              {/* Filtro */}
              <div>
                <label className="text-xs text-gray-500">Filtro</label>
                <select
                  name="filtro"
                  value={(form.filtro ?? 0) as number}
                  onChange={handleFormChange}
                  disabled={readonly}
                  className="border rounded p-2 w-full text-sm bg-white"
                >
                  <option value={0}>Generico</option>
                  <option value={1}>RB Academy</option>
                  <option value={2}>SNA</option>
                  <option value={3}>Altro</option>
                </select>
              </div>

              {/* Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Inizio convenzione</label>
                  <input
                    type="date"
                    name="inizioconvenzione"
                    value={form.inizioconvenzione || ""}
                    onChange={handleFormChange}
                    readOnly={readonly}
                    className="border rounded p-2 w-full text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Fine convenzione</label>
                  <input
                    type="date"
                    name="fineconvenzione"
                    value={form.fineconvenzione || ""}
                    onChange={handleFormChange}
                    readOnly={readonly}
                    className="border rounded p-2 w-full text-sm"
                  />
                </div>
              </div>

              {/* Flag principali */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                {([
                  ["visibilita", "Visibile"],
                  ["sospendireport", "Sospendi report"],
                  ["sospendiacquisti", "Sospendi acquisti"],
                  ["fattura", "Fattura automatica"],
                  ["test60", "Test 60h in autonomia"],
                  ["piattgratuita", "Piattaforma gratuita"],
                  ["piattpagamento", "Piattaforma a pagamento"],
                  ["provv", "Provvigioni"],
                  ["referral", "Referral"],
                  ["pacchetti", "Pacchetti"],
                  ["fattfinemese", "Fattura fine mese + iscr. immediata"],
                  ["fattsingoloutente", "Fattura singolo utente"],
                  ["iscrizione", "Iscrizione"],
                ] as [keyof Convenzione, string][]).map(([key, label]) => (
                  <label key={key} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name={key}
                      checked={!!form[key]}
                      onChange={handleFormChange}
                      disabled={readonly}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </details>

          <details className="border rounded">
            <summary className="px-3 py-2 font-semibold bg-gray-50 cursor-pointer">
              🏢 Dati aziendali
            </summary>
            <div className="p-3 grid grid-cols-1 gap-3">
              {[
                ["ragsoc", "Ragione sociale"],
                ["piva", "P.IVA"],
                ["cf", "C.F."],
                ["pec", "PEC"],
                ["codicedestinatario", "Codice destinatario"],
              ].map(([key, label]) => (
                <div key={key}>
                  <label className="text-xs text-gray-500">{label}</label>
                  <input
                    name={key}
                    value={(form as any)[key] ?? ""}
                    onChange={handleFormChange}
                    readOnly={readonly}
                    className="border rounded p-2 w-full text-sm"
                  />
                </div>
              ))}
            </div>
          </details>

          <details className="border rounded">
            <summary className="px-3 py-2 font-semibold bg-gray-50 cursor-pointer">
              📍 Indirizzo sede
            </summary>
            <div className="p-3 grid grid-cols-1 gap-3">
              {[
                ["sede", "Indirizzo"],
                ["sedesocieta", "Sede società"],
                ["cap", "CAP"],
                ["regione", "Regione"],
                ["provincia", "Provincia"],
                ["comune", "Comune"],
                ["caserta", "Caserta"],
                ["roma", "Roma"],
                ["domicilio", "Domicilio"],
                ["fast", "Fast"],
                ["sededistaccata", "Sede distaccata"],
              ].map(([key, label]) => (
                <div key={key}>
                  <label className="text-xs text-gray-500">{label}</label>
                  <input
                    name={key}
                    value={(form as any)[key] ?? ""}
                    onChange={handleFormChange}
                    readOnly={readonly}
                    className="border rounded p-2 w-full text-sm"
                  />
                </div>
              ))}
            </div>
          </details>

          <details className="border rounded">
            <summary className="px-3 py-2 font-semibold bg-gray-50 cursor-pointer">
              📞 Contatti
            </summary>
            <div className="p-3 grid grid-cols-1 gap-3">
              {[
                ["tel", "Telefono"],
                ["email", "Email"],
                ["Ref1", "Referente 1"],
                ["RefTel1", "Telefono Ref. 1"],
                ["RefEmail1", "Email Ref. 1"],
                ["Ref2", "Referente 2"],
                ["RefTel2", "Telefono Ref. 2"],
                ["RefEmail2", "Email Ref. 2"],
              ].map(([key, label]) => (
                <div key={key}>
                  <label className="text-xs text-gray-500">{label}</label>
                  <input
                    name={key}
                    value={(form as any)[key] ?? ""}
                    onChange={handleFormChange}
                    readOnly={readonly}
                    className="border rounded p-2 w-full text-sm"
                  />
                </div>
              ))}
            </div>
          </details>

          <details className="border rounded">
            <summary className="px-3 py-2 font-semibold bg-gray-50 cursor-pointer">
              🧾 Note
            </summary>
            <div className="p-3">
              <textarea
                name="note"
                value={form.note ?? ""}
                onChange={handleFormChange}
                readOnly={readonly}
                className="border rounded p-2 w-full text-sm min-h-[120px]"
              />
            </div>
          </details>

          {!readonly && (
            <button
              onClick={saveForm}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
            >
              💾 Salva dettagli convenzione
            </button>
          )}
        </div>

        {/* =========================
            COLONNA DESTRA — CORSI
           ========================= */}
        <div className="overflow-auto border rounded-lg">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
            <h2 className="font-semibold">Prezzi & storico iscritti</h2>
            <span className="text-xs text-gray-500">
              (anni: {years.length ? `${years[years.length - 1]} → ${years[0]}` : "—"})
            </span>
          </div>

          <div className="w-full overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Corso</th>
                  <th className="px-3 py-2 text-left">Prezzo</th>
                  {years.map((y) => (
                    <th key={y} className="px-2 py-2 text-center">
                      {y}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {corsi.map((c) => (
                  <tr key={c.codice} className="border-t align-top">
                    <td className="px-3 py-2">
                      <div className={`${courseColor(c.codice)} font-medium`}>{c.codice}</div>
                      <div className="text-gray-700">{c.nome}</div>
                    </td>

                    <td className="px-3 py-2">
                      {editCode === c.codice ? (
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-24 border rounded px-2 py-1"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit(c);
                              if (e.key === "Escape") setEditCode(null);
                            }}
                          />
                          <button
                            onClick={() => commitEdit(c)}
                            className="px-2 py-1 text-white bg-green-600 rounded hover:bg-green-700"
                            title="Aggiorna prezzo"
                          >
                            ✔
                          </button>
                          <button
                            onClick={() => setEditCode(null)}
                            className="px-2 py-1 bg-gray-200 rounded hover:bg-gray-300"
                            title="Annulla"
                          >
                            ✘
                          </button>
                        </div>
                      ) : (
                        <button
                          disabled={readonly}
                          onClick={() => startEdit(c)}
                          className={`${c.prezzo ? "text-red-600" : "text-gray-800"} hover:underline`}
                          title={readonly ? "" : "Clicca per modificare"}
                        >
                          {c.prezzo && c.prezzo !== "" ? c.prezzo : "—"}
                        </button>
                      )}
                    </td>

                    {years.map((y) => (
                      <td key={`${c.codice}-${y}`} className="px-2 py-2 text-center">
                        {c.years[y] > 0 ? (
                          <b className="text-orange-600">{c.years[y]}</b>
                        ) : (
                          <span className="text-gray-400">0</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}

                {corsi.length === 0 && (
                  <tr>
                    <td colSpan={2 + years.length} className="px-3 py-6 text-center text-gray-500">
                      Nessun corso per questa convenzione.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        {/* /Destra */}
      </div>
    </div>
  );
}