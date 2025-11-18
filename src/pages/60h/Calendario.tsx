import { useEffect, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import itLocale from "@fullcalendar/core/locales/it";

import ModalePrenotati from "./ModalePrenotati";

const NOTIFY_STORAGE_KEY = "calendar60h:last-notified";

export default function Calendario60h() {
  const [events, setEvents] = useState<any[]>([]);
  const [openPrenotati, setOpenPrenotati] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshAll = () => setRefreshKey((r) => r + 1);
  useEffect(() => {
    fetch("/api/finecorso60h/calendario")
      .then((res) => res.json())
      .then((data) => setEvents(data))
      .catch((err) => console.error("Errore calendario:", err));
  }, [refreshKey]);

  useEffect(() => {
    if (!events.length) return;
    if (typeof window === "undefined" || typeof Notification === "undefined") return;

    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    const getCourseLabel = (event: any) => {
      const props = event?.extendedProps || {};
      return (
        props.courseName ||
        props.courseCode ||
        event?.courseName ||
        event?.courseCode ||
        (props.idcourse || event?.idcourse ? `Corso #${props.idcourse || event?.idcourse}` : "")
      );
    };

    const formatEventSummary = (event: any) => {
      const title = (event?.title || "").trim() || "Sessione";
      const courseLabel = getCourseLabel(event);
      return courseLabel ? `${title} · ${courseLabel}` : title;
    };

    const getDate = (event: any) => {
      const raw = event.start || event.startStr || event.date || event.dataesame;
      if (!raw) return null;
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const todaysEvents = events.filter((event) => {
      const eventDate = getDate(event);
      if (!eventDate) return false;
      return eventDate.toDateString() === today.toDateString();
    });

    if (!todaysEvents.length) return;

    const alreadyNotified = window.localStorage?.getItem(NOTIFY_STORAGE_KEY) === todayKey;
    if (alreadyNotified) return;

    const sendNotification = () => {
      const firstEvent = todaysEvents[0];
      const eventDate = getDate(firstEvent);
      const timeStr = eventDate
        ? eventDate.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
        : "";

      const summary = formatEventSummary(firstEvent);
      const timeSuffix = timeStr ? ` alle ${timeStr}` : "";
      const body =
        todaysEvents.length === 1
          ? `${summary}${timeSuffix}`
          : `${todaysEvents.length} sessioni in programma. Prossima: ${summary}${timeSuffix}`;

      new Notification("Eventi in programma oggi", {
        body,
      });
      window.localStorage?.setItem(NOTIFY_STORAGE_KEY, todayKey);
    };

    const requestAndSend = () => {
      if (Notification.permission === "granted") {
        sendNotification();
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((permission) => {
          if (permission === "granted") sendNotification();
        });
      }
    };

    try {
      requestAndSend();
    } catch (err) {
      console.warn("Impossibile mostrare la notifica calendario:", err);
    }
  }, [events]);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4 text-gray-800">
        📅 Calendario 60h
      </h1>
      <div className="bg-white rounded-lg shadow p-4">
        <div className="mb-4 text-sm text-gray-700 space-y-1">

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
            Sessione non confermata (solo tabella Fine Corso)
          </div>
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
        <ModalePrenotati
          idSessione={parseInt(openPrenotati.toString())}
          onClose={() => setOpenPrenotati(null)}
          onReloadCalendar={refreshAll}
        />
      )}
    </div>
  );
}
