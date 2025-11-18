import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useAlert } from "../components/SmartAlertModal";

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
  regione_label?: string;
  provincia_label?: string;
  comune_label?: string;

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
  codice: string; // code (learning_course.code)
  nome: string; // name (learning_course.name)
  prezzo: string; // stringa (vuota = 0/non impostato)
  years: Record<number, number>; // {2025: 3, 2024: 0, ...}
}

interface APIResponse {
  convenzione: Convenzione;
  corsi: CorsoRow[];
  years: number[];
}

interface SelectOption {
  value: string;
  label: string;
}

interface ProvinceOption extends SelectOption {
  sigla?: string;
  codprovincia?: string | number;
}

interface CourseOption {
  idCourse: number;
  code: string;
  name: string;
}

/** Helper: normalizza le date in formato accettato dagli <input type="date"> */
const normalizeDateInput = (d?: string) => {
  if (!d) return "";
  // accetta "dd/MM/yyyy", "yyyy-MM-dd", "yyyy-MM-dd HH:mm:ss"
  if (d.includes("/")) {
    const [dd, mm, yyyy] = d.split("/");
    if (yyyy && mm && dd)
      return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return d.split(" ")[0]; // estrae solo la parte yyyy-MM-dd
};

/** Helper: classi colore per categoria corso */
const courseColor = (code: string) => {
  const upper = code.toUpperCase();
  if (upper.includes("OAM")) return "text-purple-700"; // OAM
  if (
    upper.match(/35(?![A-Z])/i) ||
    upper.includes("6035") ||
    upper.includes("1535") ||
    upper.includes("3035") ||
    upper.includes("4535")
  )
    return "text-blue-700"; // IVASS (35/60/30/45)
  return "text-gray-900";
};

const normalizeText = (value?: string | number | null) =>
  String(value ?? "").trim().toLowerCase();

export default function ConvenzioneDetail() {
  const { codice } = useParams();
  const [search] = useSearchParams();
  const readonly = search.get("readonly") === "1";
  const navigate = useNavigate();
  const { alert: showAlert } = useAlert();

  // Stato form sinistra
  const [form, setForm] = useState<Convenzione>({});

  // Stato tabella destra
  const [corsi, setCorsi] = useState<CorsoRow[]>([]);
  const [years, setYears] = useState<number[]>([]);

  // UI
  const [loading, setLoading] = useState(true);
  const [editCode, setEditCode] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [regionOptions, setRegionOptions] = useState<SelectOption[]>([]);
  const [provinceOptions, setProvinceOptions] = useState<ProvinceOption[]>([]);
  const [comuneOptions, setComuneOptions] = useState<SelectOption[]>([]);
  const [showAddCourseModal, setShowAddCourseModal] = useState(false);
  const [courseOptions, setCourseOptions] = useState<CourseOption[]>([]);
  const [courseOptionsLoading, setCourseOptionsLoading] = useState(false);
  const [selectedCourseCode, setSelectedCourseCode] = useState("");
  const [coursePrice, setCoursePrice] = useState("");
  const [savingCourse, setSavingCourse] = useState(false);

  // Caricamento dati full backend (convenzione + corsi + anni)
  useEffect(() => {
    if (!codice) return;
    setLoading(true);
    fetch(`/api/convenzioni/${codice}/full`)
      .then((res) => res.json())
      .then((data: APIResponse) => {
        setForm({
          ...data.convenzione,
          inizioconvenzione: normalizeDateInput(
            data.convenzione.inizioconvenzione,
          ),
          fineconvenzione: normalizeDateInput(data.convenzione.fineconvenzione),
        });
        setCorsi(data.corsi || []);
        setYears(data.years || []);
      })
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [codice]);

  const loadRegionOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/convenzioni/lookups/regioni");
      const data = await res.json();
      setRegionOptions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Errore regioni:", err);
    }
  }, []);

  const loadProvinceOptions = useCallback(async (regionValue?: string | number) => {
    if (!regionValue) {
      setProvinceOptions([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/convenzioni/lookups/province?regione=${encodeURIComponent(String(regionValue))}`,
      );
      const data = await res.json();
      setProvinceOptions(Array.isArray(data) ? (data as ProvinceOption[]) : []);
    } catch (err) {
      console.error("Errore province:", err);
      setProvinceOptions([]);
    }
  }, []);

  const loadComuneOptions = useCallback(async (provinceValue?: string | number) => {
    if (!provinceValue) {
      setComuneOptions([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/convenzioni/lookups/comuni?provincia=${encodeURIComponent(String(provinceValue))}`,
      );
      const data = await res.json();
      setComuneOptions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Errore comuni:", err);
      setComuneOptions([]);
    }
  }, []);

  useEffect(() => {
    loadRegionOptions();
  }, [loadRegionOptions]);

  useEffect(() => {
    if (!form.regione || regionOptions.length === 0) return;
    const currentValue = String(form.regione);
    const hasExact = regionOptions.some((opt) => opt.value === currentValue);
    if (hasExact) return;

    const target = normalizeText(form.regione_label || form.regione);
    if (!target) return;

    const match = regionOptions.find(
      (opt) => normalizeText(opt.label) === target,
    );

    if (match) {
      setForm((prev) => ({ ...prev, regione: match.value }));
    }
  }, [form.regione, form.regione_label, regionOptions]);

  useEffect(() => {
    if (form.regione) {
      loadProvinceOptions(form.regione);
    } else {
      setProvinceOptions([]);
    }
    // reset comune options when region changes
    setComuneOptions([]);
  }, [form.regione, loadProvinceOptions]);

  useEffect(() => {
    if (!form.provincia || provinceOptions.length === 0) return;
    const currentValue = String(form.provincia);
    const hasExact = provinceOptions.some((opt) => opt.value === currentValue);
    if (hasExact) return;

    const target = normalizeText(form.provincia_label || form.provincia);
    const matchByLabel = target
      ? provinceOptions.find((opt) => normalizeText(opt.label) === target)
      : undefined;
    const matchByCode = provinceOptions.find(
      (opt) =>
        opt.codprovincia && String(opt.codprovincia) === currentValue,
    );

    const match = matchByLabel || matchByCode;
    if (match) {
      setForm((prev) => ({ ...prev, provincia: match.value }));
    }
  }, [form.provincia, form.provincia_label, provinceOptions]);

  useEffect(() => {
    if (form.provincia) {
      loadComuneOptions(form.provincia);
    } else {
      setComuneOptions([]);
    }
  }, [form.provincia, loadComuneOptions]);

  useEffect(() => {
    if (!form.comune || comuneOptions.length === 0) return;
    const currentValue = String(form.comune);
    const hasExact = comuneOptions.some((opt) => opt.value === currentValue);
    if (hasExact) return;

    const target = normalizeText(form.comune_label || form.comune);
    if (!target) return;

    const match = comuneOptions.find(
      (opt) => normalizeText(opt.label) === target,
    );
    if (match) {
      setForm((prev) => ({ ...prev, comune: match.value }));
    }
  }, [form.comune, form.comune_label, comuneOptions]);

  useEffect(() => {
    if (!showAddCourseModal) {
      setSelectedCourseCode("");
      setCoursePrice("");
      setSavingCourse(false);
      return;
    }
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowAddCourseModal(false);
      }
    };
    window.addEventListener("keydown", handler);
    if (courseOptions.length === 0 && !courseOptionsLoading) {
      setCourseOptionsLoading(true);
      fetch("/api/convenzioni/lookups/learning-corsi")
        .then((res) => res.json())
        .then((data) => {
          setCourseOptions(Array.isArray(data) ? data : []);
        })
        .catch((err) => {
          console.error("Errore caricamento corsi learning:", err);
          setCourseOptions([]);
        })
        .finally(() => setCourseOptionsLoading(false));
    }
    return () => window.removeEventListener("keydown", handler);
  }, [showAddCourseModal, courseOptions.length, courseOptionsLoading]);

  /** Gestione change dei campi di sinistra */
  const handleFormChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) => {
    const { name, type, value } = e.target;
    const isCheckbox = type === "checkbox";
    const checked = (e.target as HTMLInputElement).checked;

    setForm((prev) => ({
      ...prev,
      [name]: isCheckbox ? checked : value,
    }));
  };

  const handleRegionSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    const label =
      regionOptions.find((opt) => opt.value === value)?.label || "";
    setForm((prev) => ({
      ...prev,
      regione: value,
      regione_label: label,
      provincia: "",
      provincia_label: "",
      comune: "",
      comune_label: "",
    }));
  };

  const handleProvinciaSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    const label =
      provinceOptions.find((opt) => opt.value === value)?.label || "";
    setForm((prev) => ({
      ...prev,
      provincia: value,
      provincia_label: label,
      comune: "",
      comune_label: "",
    }));
  };

  const handleComuneSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    const label =
      comuneOptions.find((opt) => opt.value === value)?.label || "";
    setForm((prev) => ({
      ...prev,
      comune: value,
      comune_label: label,
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
      await showAlert("❌ Errore salvataggio dati convenzione");
      return;
    }
    await showAlert("✅ Dettagli convenzione salvati");
    navigate("/convenzioni");
  };

  const renderLocationField = (key: string) => {
    const rawValue = (form as any)[key] ?? "";
    const value =
      rawValue === null || typeof rawValue === "undefined"
        ? ""
        : String(rawValue);

    if (readonly) {
      const labelValue =
        (form as any)[`${key}_label`] ?? rawValue ?? "";
      return (
        <input
          name={key}
          value={labelValue || ""}
          readOnly
          className="border rounded p-2 w-full text-sm bg-gray-100"
        />
      );
    }

    if (key === "regione") {
      return (
        <select
          name="regione"
          value={value}
          onChange={handleRegionSelect}
          className="border rounded p-2 w-full text-sm"
        >
          <option value="">-- Seleziona Regione --</option>
          {regionOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }

    if (key === "provincia") {
      return (
        <select
          name="provincia"
          value={value}
          onChange={handleProvinciaSelect}
          className="border rounded p-2 w-full text-sm"
          disabled={!form.regione || provinceOptions.length === 0}
        >
          <option value="">-- Seleziona Provincia --</option>
          {provinceOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }

    if (key === "comune") {
      return (
        <select
          name="comune"
          value={value}
          onChange={handleComuneSelect}
          className="border rounded p-2 w-full text-sm"
          disabled={!form.provincia || comuneOptions.length === 0}
        >
          <option value="">-- Seleziona Comune --</option>
          {comuneOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        name={key}
        value={value}
        onChange={handleFormChange}
        readOnly={readonly}
        className="border rounded p-2 w-full text-sm"
      />
    );
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
      await showAlert("❌ Errore salvataggio prezzo");
      return;
    }

    // aggiorna solo la riga modificata
    setCorsi((prev) =>
      prev.map((c) =>
        c.codice === row.codice ? { ...c, prezzo: prezzoClean } : c,
      ),
    );
    setEditCode(null);
  };

  const handleAddCourse = async () => {
    if (!codice) return;
    const selectedCourse = courseOptions.find(
      (c) => c.code === selectedCourseCode,
    );
    if (!selectedCourse) {
      await showAlert("Seleziona un corso dall'elenco");
      return;
    }
    const priceClean = coursePrice.trim();
    if (!priceClean) {
      await showAlert("Inserisci un prezzo per il corso selezionato");
      return;
    }
    const priceNumber = Number(priceClean.replace(",", "."));
    if (Number.isNaN(priceNumber) || priceNumber < 0) {
      await showAlert("Prezzo non valido");
      return;
    }

    setSavingCourse(true);
    try {
      const res = await fetch(`/api/convenzioni/${codice}/prezzi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codiceCorso: selectedCourse.code,
          prezzo: priceNumber,
        }),
      });
      if (!res.ok) throw new Error("HTTP error");

      setCorsi((prev) => {
        const existing = prev.find(
          (c) => c.codice === selectedCourse.code,
        );
        if (existing) {
          return prev.map((c) =>
            c.codice === selectedCourse.code
              ? { ...c, prezzo: priceClean, nome: selectedCourse.name }
              : c,
          );
        }
        const yearsMap: Record<number, number> = {};
        years.forEach((y) => {
          yearsMap[y] = 0;
        });
        const next: CorsoRow = {
          codice: selectedCourse.code,
          nome: selectedCourse.name,
          prezzo: priceClean,
          years: yearsMap,
        };
        return [...prev, next].sort((a, b) =>
          a.codice.localeCompare(b.codice),
        );
      });

      setShowAddCourseModal(false);
      setSelectedCourseCode("");
    } catch (err) {
      console.error("Errore aggiunta corso:", err);
      await showAlert("❌ Errore durante l'aggiunta del corso");
    } finally {
      setSavingCourse(false);
    }
  };

  const selectedCourseOption =
    courseOptions.find((c) => c.code === selectedCourseCode) || null;

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
                  <label className="text-xs text-gray-500">
                    Inizio convenzione
                  </label>
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
                  <label className="text-xs text-gray-500">
                    Fine convenzione
                  </label>
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
                {(
                  [
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
                  ] as [keyof Convenzione, string][]
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="inline-flex items-center gap-2 text-sm"
                  >
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
                  {["regione", "provincia", "comune"].includes(key) ? (
                    renderLocationField(key)
                  ) : (
                    <input
                      name={key}
                      value={(form as any)[key] ?? ""}
                      onChange={handleFormChange}
                      readOnly={readonly}
                      className="border rounded p-2 w-full text-sm"
                    />
                  )}
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
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b bg-gray-50">
            <div>
              <h2 className="font-semibold">Prezzi & storico iscritti</h2>
              <span className="text-xs text-gray-500">
                (anni:{" "}
                {years.length ? `${years[years.length - 1]} → ${years[0]}` : "—"})
              </span>
            </div>
            {!readonly && (
              <button
                onClick={() => setShowAddCourseModal(true)}
                className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700"
              >
                + Aggiungi corso
              </button>
            )}
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
                      <div className={`${courseColor(c.codice)} font-medium`}>
                        {c.codice}
                      </div>
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
                      <td
                        key={`${c.codice}-${y}`}
                        className="px-2 py-2 text-center"
                      >
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
                    <td
                      colSpan={2 + years.length}
                      className="px-3 py-6 text-center text-gray-500"
                    >
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
      {showAddCourseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="font-semibold text-lg">
                Aggiungi corso a {form.Name || "convenzione"}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddCourseModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="p-4 space-y-4 text-sm">
              <div>
                <label className="text-xs text-gray-500">
                  Seleziona corso (codice - nome)
                </label>
                {courseOptionsLoading ? (
                  <p className="mt-2 text-gray-500">Caricamento corsi…</p>
                ) : (
                  <select
                    value={selectedCourseCode}
                    onChange={(e) => setSelectedCourseCode(e.target.value)}
                    className="border rounded p-2 w-full mt-1"
                    autoFocus
                  >
                    <option value="">-- Seleziona corso --</option>
                    {courseOptions.map((course) => (
                      <option key={course.code} value={course.code}>
                        {course.code} - {course.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <span className="text-xs text-gray-500 block">
                    Corso selezionato
                  </span>
                  {selectedCourseOption ? (
                    <div className="mt-1 p-3 border rounded bg-gray-50">
                      <div className="font-semibold">
                        {selectedCourseOption.code}
                      </div>
                      <div className="text-gray-700">
                        {selectedCourseOption.name}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 p-3 border rounded text-gray-500">
                      Nessun corso selezionato
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs text-gray-500">Prezzo (€)</label>
                  <input
                    type="text"
                    value={coursePrice}
                    onChange={(e) => setCoursePrice(e.target.value)}
                    placeholder="Es. 49.90"
                    className="mt-1 border rounded p-2 w-full"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded border"
                  onClick={() => setShowAddCourseModal(false)}
                  disabled={savingCourse}
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={handleAddCourse}
                  disabled={
                    savingCourse ||
                    !selectedCourseCode ||
                    coursePrice.trim() === "" ||
                    courseOptionsLoading
                  }
                  className={`px-4 py-2 rounded text-white ${
                    savingCourse ||
                    !selectedCourseCode ||
                    coursePrice.trim() === "" ||
                    courseOptionsLoading
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {savingCourse ? "Salvataggio…" : "Aggiungi corso"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
