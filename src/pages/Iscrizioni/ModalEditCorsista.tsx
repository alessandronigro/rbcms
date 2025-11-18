import React, { useState } from "react";
import { useAlert } from "../../components/SmartAlertModal";
interface Corsista {
  id: number;
  corsista_first_name: string;
  corsista_last_name: string;
  corsista_email: string;
  corsista_pec: string;
  corsista_cf: string;
  codice_corso: string;
  corso_title: string;
}

interface Props {
  corsista: Corsista;
  onClose: () => void;
  onSaved: () => void;
}

export default function ModalEditCorsista({
  corsista,
  onClose,
  onSaved,
}: Props) {
  const [form, setForm] = useState<Corsista>({ ...corsista });
  const { alert: showAlert } = useAlert();

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
  };

  const save = async () => {
    const res = await fetch(
      `/api/iscrizioni/corsisti/${encodeURIComponent(form.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      },
    );
    const j = await res.json();
    if (j.success) onSaved();
    else await showAlert(j.error || "Errore salvataggio corsista");
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-xl">
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="font-semibold">Modifica Corsista #{corsista.id}</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        <div className="p-4 grid grid-cols-2 gap-3 text-sm">
          <label>
            Nome
            <input
              className="w-full border rounded p-1"
              name="corsista_first_name"
              value={form.corsista_first_name || ""}
              onChange={onChange}
            />
          </label>
          <label>
            Cognome
            <input
              className="w-full border rounded p-1"
              name="corsista_last_name"
              value={form.corsista_last_name || ""}
              onChange={onChange}
            />
          </label>
          <label>
            Email
            <input
              className="w-full border rounded p-1"
              name="corsista_email"
              value={form.corsista_email || ""}
              onChange={onChange}
            />
          </label>
          <label>
            PEC
            <input
              className="w-full border rounded p-1"
              name="corsista_pec"
              value={form.corsista_pec || ""}
              onChange={onChange}
            />
          </label>
          <label>
            Codice Fiscale
            <input
              className="w-full border rounded p-1"
              name="corsista_cf"
              value={form.corsista_cf || ""}
              onChange={onChange}
            />
          </label>
          <label className="col-span-2">
            Corso (codice)
            <input
              className="w-full border rounded p-1"
              name="codice_corso"
              value={form.codice_corso || ""}
              onChange={onChange}
            />
          </label>
          <label className="col-span-2">
            Corso (titolo)
            <input
              className="w-full border rounded p-1"
              name="corso_title"
              value={form.corso_title || ""}
              onChange={onChange}
            />
          </label>
        </div>

        <div className="p-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1 rounded bg-gray-200">
            Annulla
          </button>
          <button
            onClick={save}
            className="px-3 py-1 rounded bg-blue-600 text-white"
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}
