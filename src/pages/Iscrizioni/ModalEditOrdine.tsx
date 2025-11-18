import React, { useState } from "react";
import { useAlert } from "../../components/SmartAlertModal";
interface Props {
  ordine: any;
  onClose: () => void;
  onSaved: () => void;
}

export default function ModalEditOrdine({ ordine, onClose, onSaved }: Props) {
  const [form, setForm] = useState<any>({
    intestazione_fattura: ordine.intestazione_fattura || "",
    billing_email: ordine.billing_email || "",
    billing_pec: ordine.billing_pec || "",
    billing_cf: ordine.billing_cf || "",
    billing_iva: ordine.billing_iva || "",
    billing_indirizzo_1: ordine.billing_indirizzo_1 || "",
    billing_cap: ordine.billing_cap || "",
    billing_comune: ordine.billing_comune || "",
    billing_provincia: ordine.billing_provincia || "",
    metodo_di_pagamento: ordine.metodo_di_pagamento || "",
    order_status: ordine.order_status || "",
    note: ordine.note || "",
  });
  const { alert: showAlert } = useAlert();

  const onChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setForm((p: any) => ({ ...p, [name]: value }));
  };

  const save = async () => {
    const res = await fetch(
      `/api/iscrizioni/ordini/${encodeURIComponent(ordine.order_id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      },
    );
    const j = await res.json();
    if (j.success) onSaved();
    else await showAlert(j.error || "Errore salvataggio ordine");
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl">
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="font-semibold">Modifica Ordine #{ordine.order_id}</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3 text-sm">
          <label className="col-span-2">
            Intestazione
            <input
              className="w-full border rounded p-1"
              name="intestazione_fattura"
              value={form.intestazione_fattura}
              onChange={onChange}
            />
          </label>
          <label>
            Email fatturazione
            <input
              className="w-full border rounded p-1"
              name="billing_email"
              value={form.billing_email}
              onChange={onChange}
            />
          </label>
          <label>
            PEC
            <input
              className="w-full border rounded p-1"
              name="billing_pec"
              value={form.billing_pec}
              onChange={onChange}
            />
          </label>
          <label>
            CF
            <input
              className="w-full border rounded p-1"
              name="billing_cf"
              value={form.billing_cf}
              onChange={onChange}
            />
          </label>
          <label>
            P. IVA
            <input
              className="w-full border rounded p-1"
              name="billing_iva"
              value={form.billing_iva}
              onChange={onChange}
            />
          </label>
          <label className="col-span-2">
            Indirizzo
            <input
              className="w-full border rounded p-1"
              name="billing_indirizzo_1"
              value={form.billing_indirizzo_1}
              onChange={onChange}
            />
          </label>
          <label>
            CAP
            <input
              className="w-full border rounded p-1"
              name="billing_cap"
              value={form.billing_cap}
              onChange={onChange}
            />
          </label>
          <label>
            Comune (id)
            <input
              className="w-full border rounded p-1"
              name="billing_comune"
              value={form.billing_comune}
              onChange={onChange}
            />
          </label>
          <label>
            Provincia (id)
            <input
              className="w-full border rounded p-1"
              name="billing_provincia"
              value={form.billing_provincia}
              onChange={onChange}
            />
          </label>
          <label>
            Metodo pagamento
            <input
              className="w-full border rounded p-1"
              name="metodo_di_pagamento"
              value={form.metodo_di_pagamento}
              onChange={onChange}
            />
          </label>
          <label>
            Stato ordine
            <input
              className="w-full border rounded p-1"
              name="order_status"
              value={form.order_status}
              onChange={onChange}
            />
          </label>
          <label className="col-span-2">
            Note
            <input
              className="w-full border rounded p-1"
              name="note"
              value={form.note}
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
