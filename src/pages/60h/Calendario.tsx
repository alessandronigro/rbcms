import { useEffect, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import itLocale from "@fullcalendar/core/locales/it";

import ModalePrenotati from "./ModalePrenotati";

export default function Calendario60h() {
  const [events, setEvents] = useState<any[]>([]);
  const [] = useState<any | null>(null);
  const [openPrenotati, setOpenPrenotati] = useState<number | null>(null);
  const [, setRefresh] = useState(false);

  const refreshAll = () => setRefresh((r) => !r);
  useEffect(() => {
    fetch("/api/finecorso60h/calendario")
      .then((res) => res.json())
      .then((data) => setEvents(data))
      .catch((err) => console.error("Errore calendario:", err));
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4 text-gray-800">
        📅 Calendario 60h
      </h1>
      <div className="bg-white rounded-lg shadow p-4">
        <FullCalendar
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale={itLocale}
          height="auto"
          events={events}
          eventClick={(info) => {

            setOpenPrenotati(Number(info.event.id)); // apre modale prenotati
          }}
        />
      </div>

      {openPrenotati && (
        <ModalePrenotati
          idSessione={parseInt(openPrenotati.toString())}
          onClose={() => setOpenPrenotati(null)}
          onReloadCalendar={refreshAll}
        />
      )}
    </div>
  );
}
