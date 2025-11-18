import React, { useCallback, useEffect, useState } from "react";
import { useAlert } from "../../components/SmartAlertModal";
interface ParsedRow {
  cognome: string;
  nome: string;
  email: string;
  cf: string;
  telefono?: string;
}

interface Convenzione {
  name: string;

  piattaforma: string;
}

interface Corso {
  code: string;
  name: string;
}

interface SelectOption {
  value: string;
  label: string;
}

interface FatturazioneData {
  intestatario: string;
  partitaIva: string;
  indirizzo: string;
  cap: string;
  comune: string;
  provincia: string;
  regione: string;
  email: string;
  pec: string;
  codiceDestinatario: string;
}

const createEmptyBillingData = (): FatturazioneData => ({
  intestatario: "",
  partitaIva: "",
  indirizzo: "",
  cap: "",
  comune: "",
  provincia: "",
  regione: "",
  email: "",
  pec: "",
  codiceDestinatario: "",
});

export default function IscrizioniExcel() {
  // const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsedRow[]>([]);
  const [selectedConv, setSelectedConv] = useState("");
  const [convenzioni, setConvenzioni] = useState<Convenzione[]>([]);
  const [corsi, setCorsi] = useState<Corso[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState("");
  const [billingData, setBillingData] = useState<FatturazioneData>(
    () => createEmptyBillingData(),
  );
  const [regionOptions, setRegionOptions] = useState<SelectOption[]>([]);
  const [provinceOptions, setProvinceOptions] = useState<SelectOption[]>([]);
  const [comuneOptions, setComuneOptions] = useState<SelectOption[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState("");
  const [selectedProvinceId, setSelectedProvinceId] = useState("");
  const [selectedComuneId, setSelectedComuneId] = useState("");
  const { alert: showAlert } = useAlert();
  const needsBillingForm = selectedConv === "Formazione Intermediari";
  const handleBillingChange = (
    field: keyof FatturazioneData,
    value: string,
  ) => {
    setBillingData((prev) => ({ ...prev, [field]: value }));
  };
  const handleRegionSelect = (value: string) => {
    setSelectedRegionId(value);
    setSelectedProvinceId("");
    setSelectedComuneId("");
    const label =
      regionOptions.find((opt) => opt.value === value)?.label || "";
    setBillingData((prev) => ({
      ...prev,
      regione: label,
      provincia: "",
      comune: "",
    }));
    if (!value) {
      setProvinceOptions([]);
      setComuneOptions([]);
    }
  };
  const handleProvinciaSelect = (value: string) => {
    setSelectedProvinceId(value);
    setSelectedComuneId("");
    const label =
      provinceOptions.find((opt) => opt.value === value)?.label || "";
    setBillingData((prev) => ({
      ...prev,
      provincia: label,
      comune: "",
    }));
    if (!value) {
      setComuneOptions([]);
    }
  };
  const handleComuneSelect = (value: string) => {
    setSelectedComuneId(value);
    const label =
      comuneOptions.find((opt) => opt.value === value)?.label || "";
    setBillingData((prev) => ({
      ...prev,
      comune: label,
    }));
  };

  const loadRegionOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/convenzioni/lookups/regioni");
      const data = await res.json();
      setRegionOptions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Errore regioni:", err);
      setRegionOptions([]);
    }
  }, []);

  const loadProvinceOptions = useCallback(async (regione?: string) => {
    if (!regione) {
      setProvinceOptions([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/convenzioni/lookups/province?regione=${encodeURIComponent(regione)}`,
      );
      const data = await res.json();
      setProvinceOptions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Errore province:", err);
      setProvinceOptions([]);
    }
  }, []);

  const loadComuneOptions = useCallback(async (provincia?: string) => {
    if (!provincia) {
      setComuneOptions([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/convenzioni/lookups/comuni?provincia=${encodeURIComponent(provincia)}`,
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
    if (!needsBillingForm) {
      setProvinceOptions([]);
      return;
    }
    if (selectedRegionId) {
      loadProvinceOptions(selectedRegionId);
    } else {
      setProvinceOptions([]);
    }
  }, [selectedRegionId, loadProvinceOptions, needsBillingForm]);

  useEffect(() => {
    if (!needsBillingForm) {
      setComuneOptions([]);
      return;
    }
    if (selectedProvinceId) {
      loadComuneOptions(selectedProvinceId);
    } else {
      setComuneOptions([]);
    }
  }, [selectedProvinceId, loadComuneOptions, needsBillingForm]);

  // ✅ CSV → oggetto
  const parseCSV = (text: string) => {
    const rows = text.split(/\r?\n/).filter((r) => r.trim() !== "");
    const parsed: ParsedRow[] = [];
    rows.forEach((row) => {
      const [cognome, nome, email, cf, telefono] = row.split(";");
      if (!cognome || !nome || !email || !cf) return;
      parsed.push({
        cognome: cognome.trim(),
        nome: nome.trim(),
        email: email.trim(),
        cf: cf.trim(),
        telefono: telefono?.trim(),
      });
    });
    return parsed;
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    // setFile(f);
    setPreview([]);
    setConvenzioni([]);
    setCorsi([]);
    setSelectedConv("");
    setBillingData(createEmptyBillingData());
    setSelectedRegionId("");
    setSelectedProvinceId("");
    setSelectedComuneId("");
    setProvinceOptions([]);
    setComuneOptions([]);

    const text = await f.text();
    const parsed = parseCSV(text);

    if (!parsed.length) {
      await showAlert("⚠️ Nessun dato valido nel file");
      return;
    }

    setPreview(parsed);
    fetchConvenzioni();
  };

  const fetchConvenzioni = async () => {
    try {
      const r = await fetch("/api/iscrizioni/convenzioni");
      const json = await r.json();
      setConvenzioni(json || []);
    } catch (err) {
      console.error("Errore convenzioni:", err);
    }
  };

  const handleChangeConvenzione = async (
    e: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const value = e.target.value;
    setSelectedConv(value);
    setCorsi([]);
    if (value !== "Formazione Intermediari") {
      setBillingData(createEmptyBillingData());
      setSelectedRegionId("");
      setSelectedProvinceId("");
      setSelectedComuneId("");
      setProvinceOptions([]);
      setComuneOptions([]);
    }

    if (!value) return;

    try {
      const r = await fetch(
        `/api/iscrizioni/corsi?convenzione=${encodeURIComponent(value)}`,
      );
      const json = await r.json();
      console.log("Corsi by convenzione", json);

      if (!Array.isArray(json)) {
        console.warn("⚠️ corsi non array:", json);
        setCorsi([]);
        return;
      }

      setCorsi(json);
    } catch (err) {
      console.error("Errore caricamento corsi:", err);
      setCorsi([]);
    }
  };

  const handleIscrivi = async () => {
    if (!selectedConv || !selectedCourse) {
      await showAlert("Seleziona convenzione e corso");
      return;
    }
    if (needsBillingForm) {
      const required: Array<keyof FatturazioneData> = [
        "intestatario",
        "partitaIva",
        "indirizzo",
        "cap",
        "regione",
        "comune",
        "provincia",
        "email",
      ];
      for (const field of required) {
        if (!billingData[field].trim()) {
          await showAlert("Compila tutti i dati di fatturazione richiesti");
          return;
        }
      }
      if (
        !billingData.codiceDestinatario.trim() &&
        !billingData.pec.trim()
      ) {
        await showAlert(
          "Inserisci PEC oppure Codice Destinatario per la fatturazione elettronica",
        );
        return;
      }
    }

    setLoading(true);

    const payload = {
      convenzione: selectedConv,
      corso: selectedCourse,
      utenti: preview,
      fatturazione: needsBillingForm ? billingData : undefined,
    };

    const res = await fetch("/api/iscrizioni/excel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    setLoading(false);

    await showAlert(data.message || "Operazione eseguita", {
      title: "Esiti iscrizioni",
      results: Array.isArray(data.results) ? data.results : undefined,
    });
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-bold text-blue-700">
        Iscrizioni da Excel CSV
      </h2>

      <input
        type="file"
        accept=".csv"
        onChange={handleFileSelect}
        className="border p-2 w-full max-w-sm"
      />

      {preview.length > 0 && (
        <>
          <h3 className="font-semibold mt-3 text-green-700">
            ✅ Caricati {preview.length} utenti
          </h3>

          <select
            value={selectedConv}
            onChange={handleChangeConvenzione}
            className="border rounded p-2 w-full max-w-md mt-3"
          >
            <option value="">-- Seleziona Convenzione --</option>
            {convenzioni.map((c, i) => (
              <option key={i} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>

          {selectedConv && (
            <>
              <select
                value={selectedCourse}
                onChange={(e) => setSelectedCourse(e.target.value)}
                className="border rounded p-2 w-full max-w-md mt-3"
              >
                <option value="">-- Seleziona Corso --</option>
                {Array.isArray(corsi) &&
                  corsi.map((c, i) => (
                    <option key={i} value={c.code}>
                      {c.code} - {c.name}
                    </option>
                  ))}
              </select>

              {needsBillingForm && (
                <div className="mt-4 border border-blue-200 bg-blue-50 rounded p-4">
                  <h4 className="font-semibold text-blue-700">
                    Dati di fatturazione - Formazione Intermediari
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                    <label className="flex flex-col text-sm text-gray-700">
                      Intestatario fattura *
                      <input
                        type="text"
                        value={billingData.intestatario}
                        onChange={(e) =>
                          handleBillingChange("intestatario", e.target.value)
                        }
                        className="border rounded p-2 mt-1"
                      />
                    </label>
                    <label className="flex flex-col text-sm text-gray-700">
                      Partita IVA *
                      <input
                        type="text"
                        value={billingData.partitaIva}
                        onChange={(e) =>
                          handleBillingChange("partitaIva", e.target.value)
                        }
                        className="border rounded p-2 mt-1 uppercase"
                      />
                    </label>
                    <label className="flex flex-col text-sm text-gray-700">
                      Email fatturazione *
                      <input
                        type="email"
                        value={billingData.email}
                        onChange={(e) =>
                          handleBillingChange("email", e.target.value)
                        }
                        className="border rounded p-2 mt-1"
                      />
                    </label>
                    <label className="flex flex-col text-sm text-gray-700">
                      PEC fatturazione
                      <input
                        type="email"
                        value={billingData.pec}
                        onChange={(e) =>
                          handleBillingChange("pec", e.target.value)
                        }
                        className="border rounded p-2 mt-1"
                      />
                    </label>
                    <label className="flex flex-col text-sm text-gray-700">
                      Codice Destinatario
                      <input
                        type="text"
                        value={billingData.codiceDestinatario}
                        onChange={(e) =>
                          handleBillingChange(
                            "codiceDestinatario",
                            e.target.value.toUpperCase(),
                          )
                        }
                        className="border rounded p-2 mt-1 uppercase"
                      />
                    </label>
                    <label className="flex flex-col text-sm text-gray-700 md:col-span-2">
                      Indirizzo completo *
                      <input
                        type="text"
                        value={billingData.indirizzo}
                        onChange={(e) =>
                          handleBillingChange("indirizzo", e.target.value)
                        }
                        className="border rounded p-2 mt-1"
                      />
                    </label>
                    <label className="flex flex-col text-sm text-gray-700">
                      CAP *
                      <input
                        type="text"
                        value={billingData.cap}
                        onChange={(e) =>
                          handleBillingChange("cap", e.target.value)
                        }
                        className="border rounded p-2 mt-1"
                      />
                    </label>
                    <label className="flex flex-col text-sm text-gray-700">
                      Regione *
                      <select
                        value={selectedRegionId}
                        onChange={(e) => handleRegionSelect(e.target.value)}
                        className="border rounded p-2 mt-1"
                      >
                        <option value="">-- Seleziona Regione --</option>
                        {regionOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col text-sm text-gray-700">
                      Provincia *
                      <select
                        value={selectedProvinceId}
                        onChange={(e) => handleProvinciaSelect(e.target.value)}
                        className="border rounded p-2 mt-1"
                        disabled={
                          !selectedRegionId || provinceOptions.length === 0
                        }
                      >
                        <option value="">-- Seleziona Provincia --</option>
                        {provinceOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col text-sm text-gray-700">
                      Comune *
                      <select
                        value={selectedComuneId}
                        onChange={(e) => handleComuneSelect(e.target.value)}
                        className="border rounded p-2 mt-1"
                        disabled={
                          !selectedProvinceId || comuneOptions.length === 0
                        }
                      >
                        <option value="">-- Seleziona Comune --</option>
                        {comuneOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <p className="text-xs text-gray-600 mt-2">
                    * campi obbligatori. Inserire almeno uno tra PEC e Codice
                    Destinatario.
                  </p>
                </div>
              )}

              <button
                disabled={loading}
                onClick={handleIscrivi}
                className="mt-4 bg-blue-600 text-white px-4 py-2 rounded"
              >
                {loading ? "Iscrizione..." : "Iscrivi tutti"}
              </button>
            </>
          )}

          <hr className="my-4" />

          <h3 className="font-semibold text-gray-700">Anteprima</h3>
          <table className="min-w-full border text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th>Cognome</th>
                <th>Nome</th>
                <th>Email</th>
                <th>CF</th>
                <th>Telefono</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((u, idx) => (
                <tr key={idx} className="border text-center">
                  <td>{u.cognome}</td>
                  <td>{u.nome}</td>
                  <td>{u.email}</td>
                  <td>{u.cf}</td>
                  <td>{u.telefono}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
