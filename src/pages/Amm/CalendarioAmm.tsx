import { useEffect, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import itLocale from "@fullcalendar/core/locales/it";

import ModalePrenotatiAmm from "./ModalPrenotatiAmm";

export default function CalendarioAmm() {
  const [events, setEvents] = useState<any[]>([]);
  const [openPrenotati, setOpenPrenotati] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshAll = () => setRefreshKey((key) => key + 1);

  useEffect(() => {
    fetch("/api/finecorsoamm/calendario")
      .then((res) => res.json())
      .then((data) => setEvents(data))
      .catch((err) => console.error("Errore calendario:", err));
  }, [refreshKey]);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4 text-gray-800">
        📅 Calendario Amministratore di condominio
      </h1>
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center">
          <span className="inline-block w-4 h-4 mr-2 rounded" style={{ background: "#bbf7d0" }}></span>
          Da confermare
        </div>

        <div className="flex items-center">
          <span className="inline-block w-4 h-4 mr-2 rounded" style={{ background: "#059669" }}></span>
          Confermata
        </div>

        <div className="flex items-center">
          <span className="inline-block w-4 h-4 mr-2 rounded" style={{ background: "#f87171" }}></span>
          Buon fine NO
        </div>

        <div className="flex items-center">
          <span className="inline-block w-4 h-4 mr-2 rounded" style={{ background: "#f9a8d4" }}></span>
          Buon fine SI
        </div>

        <div className="flex items-center text-xs text-gray-600">
          <span className="inline-block w-4 h-4 mr-2 rounded" style={{ background: "#6b7280" }}></span>
          Sessione non confermata (visibile solo in Fine Corso Amm)
        </div>
        <FullCalendar
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale={itLocale}
          height="auto"
          events={events}
          eventClick={(info) => {
            setOpenPrenotati(Number(info.event.id));
          }}

          eventContent={(arg) => {
            const flag = arg.event.extendedProps.flagevent;

            const bgColors: Record<number, string> = {
              0: "#bbf7d0", // green-200
              1: "#059669", // green-600
              2: "#6b7280", // gray-500 (non confermata)
              3: "#f87171", // red-400
              4: "#f9a8d4", // pink-300
            };

            const isDark = [1, 2].includes(flag);
            const textColor = flag === 3 ? "white" : isDark ? "white" : "black";

            const bg = bgColors[flag] || "#e5e7eb";
            const startDate = arg.event.start;
            const timeStr = startDate
              ? startDate.toLocaleTimeString("it-IT", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "";
            const label = timeStr ? `${arg.event.title} · ${timeStr}` : arg.event.title;
            const note = (arg.event.extendedProps.note || "").toString().trim();
            const noteTooltip = note
              ? note
                  .replace(/&/g, "&amp;")
                  .replace(/"/g, "&quot;")
                  .replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;")
                  .replace(/\n/g, " ")
              : "";
            const noteBadge = note
              ? `<span style="
                  margin-left:6px;
                  background:#fb923c;
                  color:#1f2937;
                  padding:1px 6px;
                  border-radius:9999px;
                  font-size:10px;
                  font-weight:600;
                  display:inline-flex;
                  align-items:center;
                ">📝</span>`
              : "";

            return {
              html: `
      <div style="
        background:${bg};
        color:${textColor};
        padding:6px 8px;
        border-radius:5px;
        font-size:12px;
        font-weight:700;
        text-align:center;
        line-height:1.25;
        white-space:normal;
        border:1px solid rgba(0,0,0,0.15);
        display:flex;
        align-items:center;
        justify-content:center;
        gap:4px;
      " ${note ? `title="${noteTooltip}"` : ""}>
        <span>${label}</span>
        ${noteBadge}
      </div>
    `,
            };
          }}
        />
      </div>

      {openPrenotati && (
        <ModalePrenotatiAmm
          idSessione={parseInt(openPrenotati.toString())}
          onClose={() => setOpenPrenotati(null)}
          onReloadCalendar={refreshAll}
        />
      )}
    </div>
  );
}
