import { useState, useEffect } from "react";
import { Calendar, Eye, Loader2 } from "lucide-react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import itLocale from "@fullcalendar/core/locales/it";

interface FineCorsoRow {
  id: string;
  id_user: number;
  id_course: number;
  firstname: string;
  lastname: string;
  convenzione: string;
  code: string;
  on_date: string;
  date_inscr: string;
  data_invio: string;
  flagevent: number;
  evaso: number;
  note: string;
  aggiunto?: number | null;
}

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (form: any) => void;
  row?: FineCorsoRow | null;
}

function ModalDatiSessione({ isOpen, onClose, onSave, row }: ModalProps) {
  const [form, setForm] = useState({
    dataprova: "",
    dataesame: "",
    ckmail: false,
    note: "",
  });

  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen) {
      setForm({ dataprova: "", dataesame: "", ckmail: false, note: "" });

      fetch("/api/finecorsoamm/calendario")
        .then((res) => res.json())
        .then((data) => setCalendarEvents(data));
    }
  }, [isOpen]);

  if (!isOpen || !row) return null;

  const disabled = !form.dataprova || !form.dataesame;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[95%] max-w-5xl p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-600 hover:text-red-600"
        >
          ✖
        </button>

        <h4 className="text-xl font-semibold mb-2">
          📅 Proposta Sessione Test Finale
        </h4>

        <p className="text-gray-700 text-sm mb-4">
          <b>
            {row.lastname} {row.firstname}
          </b>{" "}
          • {row.code} — {row.convenzione}
        </p>

        {/* 📌 Calendario Preview */}
        <div className="bg-gray-50 p-3 rounded-lg border mb-4">
          <FullCalendar
            plugins={[dayGridPlugin]}
            initialView="dayGridMonth"
            height="auto"
            locale={itLocale}
            events={calendarEvents}
          />
        </div>

        {/* Form */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-gray-700">Prima data proposta</label>
            <input
              type="datetime-local"
              value={form.dataprova}
              onChange={(e) => setForm({ ...form, dataprova: e.target.value })}
              className="w-full border rounded p-2"
            />
          </div>

          <div>
            <label className="text-sm text-gray-700">
              Seconda data proposta
            </label>
            <input
              type="datetime-local"
              value={form.dataesame}
              onChange={(e) => setForm({ ...form, dataesame: e.target.value })}
              className="w-full border rounded p-2"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 mt-3 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.ckmail}
            onChange={(e) => setForm({ ...form, ckmail: e.target.checked })}
          />
          Invia automaticamente email proposta date
        </label>

        <input
          type="text"
          placeholder="Note"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
          className="w-full border rounded p-2 mt-2"
        />

        <div className="flex justify-end gap-3 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
          >
            Chiudi
          </button>
          <button
            disabled={disabled}
            onClick={() => onSave(form)}
            className={`px-4 py-2 text-white rounded ${disabled
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700"
              }`}
          >
            ✅ Salva
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FineCorsoAmm() {
  const [data, setData] = useState<FineCorsoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<FineCorsoRow | null>(null);
  // Removed unused sortField state
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  const loadData = async () => {
    setLoading(true);
    const res = await fetch("/api/finecorsoamm");
    const json = await res.json();
    setData(json);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const sortTable = (field: keyof FineCorsoRow) => {
    const normalize = (v: any) =>
      v === null || v === undefined ? "" : v.toString().toLowerCase();

    const newOrder = [...data].sort((a, b) => {
      const valA = normalize(a[field]);
      const valB = normalize(b[field]);

      if (valA === valB) return 0;
      return valA > valB ? (sortAsc ? 1 : -1) : sortAsc ? -1 : 1;
    });
    setData(newOrder);
    setSortAsc(!sortAsc);
  };

  const handleSaveModal = async (form: any) => {
    if (!selectedRow) return;

    await fetch("/api/finecorsoamm/email/proposta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        iduser: selectedRow.id_user,
        idcourse: selectedRow.id_course,
        dataprova: form.dataprova,
        dataesame: form.dataesame,
        note: form.note,

        ...form,
      }),
    });

    setModalOpen(false);
    loadData();
  };

  const colorRow = (row: FineCorsoRow) => {
    if (row.flagevent === 1) return "bg-green-200";
    if (row.flagevent === 2) return "bg-red-200";
    if (row.evaso === 1) return "bg-pink-200";
    return "bg-white";
  };

  return (
    <div className="p-6">
      {/* ✅ Legenda */}
      <div className="mb-4 text-xs text-gray-600 space-y-1">
        <div>
          <span className="inline-block w-3 h-3 bg-green-200 mr-2 rounded"></span>
          Da confermare
        </div>
        <div>
          <span className="inline-block w-3 h-3 bg-green-600 mr-2 rounded"></span>
          Confermata
        </div>
        <div>
          <span className="inline-block w-3 h-3 bg-red-400 mr-2 rounded"></span>
          Buon fine NO
        </div>
        <div>
          <span className="inline-block w-3 h-3 bg-pink-300 mr-2 rounded"></span>
          Buon fine SI
        </div>
        <div>
          <span className="inline-block w-3 h-3 bg-orange-500 mr-2 rounded"></span>
          🔔 Sessioni già create
        </div>
      </div>

      <h1 className="text-xl font-bold mb-4">
        🧾Amministratore di condominio — Gestione Sessioni
      </h1>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-gray-500" />
        </div>
      ) : (
        <table className="min-w-full bg-white rounded shadow text-xs">
          <thead className="bg-gray-100 text-gray-700 uppercase text-[11px]">
            <tr>
              <th
                className="p-2 cursor-pointer w-[200px]"
                onClick={() => sortTable("lastname")}
              >
                COGNOME
              </th>
              <th
                className="p-2 cursor-pointer w-[120px]"
                onClick={() => sortTable("firstname")}
              >
                NOME
              </th>
              <th className="p-2 w-[110px]">CORSO</th>
              <th
                className="p-2 cursor-pointer w-[170px]"
                onClick={() => sortTable("on_date")}
              >
                DATA DOC FINE CORSO
              </th>
              <th className="p-2 w-[170px]">CONVENZIONE</th>
              <th
                className="p-2 cursor-pointer w-[140px]"
                onClick={() => sortTable("date_inscr")}
              >
                DATA ISCRIZIONE
              </th>
              <th className="p-2 w-[240px]">NOTE</th>
              <th className="p-2 text-center w-[80px]">AZIONI</th>
            </tr>
          </thead>

          <tbody>
            {data.map((row) => (
              <tr key={row.id} className={`${colorRow(row)} border-b`}>
                <td className="p-2">{row.lastname}</td>
                <td className="p-2">{row.firstname}</td>
                <td className="p-2 text-red-600">{row.code}</td>
                <td className="p-2">
                  {new Date(row.on_date).toLocaleDateString("it-IT")}
                </td>
                <td className="p-2">{row.convenzione}</td>
                <td className="p-2">
                  {new Date(row.date_inscr).toLocaleDateString("it-IT")}
                </td>
                <td className="p-2">
                  <input
                    type="text"
                    className="w-full border rounded px-2 py-1"
                    value={row.note || ""}
                    onChange={(e) => {
                      const copy = [...data];
                      copy.find((r) => r.id === row.id)!.note = e.target.value;
                      setData(copy);
                    }}
                    onBlur={async () => {
                      await fetch(`/api/finecorsoamm/note`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          id_user: row.id_user,
                          id_course: row.id_course,
                          note: row.note,
                        }),
                      });
                    }}
                  />
                </td>

                <td className="p-2 text-center space-x-3">
                  <Calendar
                    size={25}
                    className="text-orange-500 hover:text-orange-700 cursor-pointer"
                    onClick={() => {
                      setSelectedRow(row);
                      setModalOpen(true);
                    }}
                  />
                  {row.aggiunto !== null && (
                    <Eye size={22} className="text-green-700" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ModalDatiSessione
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSaveModal}
        row={selectedRow}
      />
    </div>
  );
}
