import { useEffect, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import itLocale from "@fullcalendar/core/locales/it";

import ModalePrenotatiAmm from "./ModalPrenotatiAmm";

export default function CalendarioAmm() {
    const [events, setEvents] = useState<any[]>([]);
    const [selected, setSelected] = useState<any | null>(null);
    const [openPrenotati, setOpenPrenotati] = useState<number | null>(null);
    const [refresh, setRefresh] = useState(false);

    const refreshAll = () => setRefresh((r) => !r);
    useEffect(() => {
        fetch("/api/finecorsoamm/calendario")
            .then((res) => res.json())
            .then((data) => setEvents(data))
            .catch((err) => console.error("Errore calendario:", err));
    }, []);

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-4 text-gray-800">📅 Calendario Amministratore di condominio</h1>
            <div className="bg-white rounded-lg shadow p-4">
                <FullCalendar
                    plugins={[dayGridPlugin, interactionPlugin]}
                    initialView="dayGridMonth"
                    locale={itLocale}
                    height="auto"
                    events={events}
                    eventClick={(info) => {
                        const props = info.event.extendedProps;
                        setOpenPrenotati(Number(info.event.id)); // apre modale prenotati
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