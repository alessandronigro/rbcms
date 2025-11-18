import { useEffect, useMemo, useState } from "react";

interface SlotItem {
  id: string;
  start: string;
  end: string;
  label: string;
}

interface AvailabilityResponse {
  success: boolean;
  calendar: string;
  slots: SlotItem[];
  slotMinutes: number;
  weeksAhead: number;
}

interface ContextResponse {
  success: boolean;
  calendar: string;
  user: { firstname: string; lastname: string };
  course: { name: string };
}

const formatterDate = new Intl.DateTimeFormat("it-IT", {
  weekday: "long",
  day: "2-digit",
  month: "long",
});

const formatterTime = new Intl.DateTimeFormat("it-IT", {
  hour: "2-digit",
  minute: "2-digit",
});

type HostType = "fi" | "rb" | null;

const detectHostType = (): HostType => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const calendarParam = (params.get("calendar") || params.get("brand") || "")
    .toLowerCase()
    .trim();
  if (calendarParam === "amm" || calendarParam === "rb") return "rb";
  if (calendarParam === "60h" || calendarParam === "fi") return "fi";

  const host = window.location.hostname.toLowerCase();
  if (host.includes("rb-academy")) return "rb";
  if (host.includes("formazioneintermediari.com")) return "fi";

  const ref = (document.referrer || "").toLowerCase();
  if (ref.includes("rb-academy")) return "rb";
  if (ref.includes("formazioneintermediari.com")) return "fi";

  return null;
};

const readQueryDefaults = () => {
  if (typeof window === "undefined") {
    return { iduser: "", idcourse: "" };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    iduser: params.get("iduser") || "",
    idcourse: params.get("idcourse") || "",
  };
};

export default function PublicSlots() {
  const hostType = useMemo(() => detectHostType(), []);
  const allowedHost = Boolean(hostType);
  const calendar = hostType === "rb" ? "amm" : "60h";
  const defaults = useMemo(() => readQueryDefaults(), []);
  const [slots, setSlots] = useState<SlotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bookingSlot, setBookingSlot] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  const userId = Number(defaults.iduser);
  const courseId = Number(defaults.idcourse);
  const hasIds = Boolean(defaults.iduser && defaults.idcourse);
  const validIds =
    hasIds && Number.isFinite(userId) && Number.isFinite(courseId);

  useEffect(() => {
    if (!allowedHost) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/public-slots/availability?calendar=${calendar}`,
          { signal: controller.signal },
        );
        const json: AvailabilityResponse = await res.json();
        if (json?.slots) {
          setSlots(json.slots);
        } else {
          setSlots([]);
        }
      } catch (err) {
        console.error("availability ERR", err);
        if (!controller.signal.aborted) {
          setError(
            "Non è stato possibile caricare gli slot disponibili. Riprova più tardi.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [calendar, refreshKey, allowedHost]);

  useEffect(() => {
    if (!allowedHost || !validIds) {
      setContext(null);
      return;
    }
    let cancelled = false;
    setContextLoading(true);
    setContextError(null);
    const params = new URLSearchParams({
      calendar,
      iduser: defaults.iduser,
      idcourse: defaults.idcourse,
    });
    fetch(`/api/public-slots/context?${params.toString()}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || "Impossibile recuperare i dati");
        }
        if (!cancelled) setContext(json as ContextResponse);
      })
      .catch((err) => {
        console.error("context ERR", err);
        if (!cancelled) setContextError("Impossibile recuperare i dati del corsista.");
      })
      .finally(() => {
        if (!cancelled) setContextLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [allowedHost, validIds, defaults.iduser, defaults.idcourse, calendar]);

  const groupedSlots = useMemo(() => {
    const groups = new Map<string, SlotItem[]>();
    slots.forEach((slot) => {
      const dateKey = slot.start.slice(0, 10);
      const list = groups.get(dateKey) || [];
      list.push(slot);
      groups.set(dateKey, list);
    });

    return Array.from(groups.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
  }, [slots]);

  const handleBook = async (slot: SlotItem) => {
    setError(null);
    setMessage(null);
    if (!validIds) {
      setError(
        "Parametri di prenotazione mancanti o non validi: specificare iduser e idcourse nella query string.",
      );
      return;
    }

    setBookingSlot(slot.id);
    try {
      const payload = {
        calendar,
        slotStart: slot.start,
        iduser: userId,
        idcourse: courseId,
        note,
      };
      const res = await fetch("/api/public-slots/book", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(calendar === "amm" ? { "rb-academy": "1" } : {}),
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Prenotazione fallita");
      }
      setMessage("Slot prenotato correttamente 🎉");
      setNote("");
      setRefreshKey((x) => x + 1);
    } catch (err: any) {
      console.error("book slot ERR", err);
      setError(err?.message || "Impossibile prenotare lo slot selezionato.");
    } finally {
      setBookingSlot(null);
    }
  };

  if (!allowedHost) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center px-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-3xl font-semibold">Accesso non autorizzato</h1>
          <p className="text-slate-200">
            Questa pagina è raggiungibile solo dai domini
            formazioneintermediari.com o rb-academy.it.
          </p>
        </div>
      </div>
    );
  }

  const gradientClasses =
    hostType === "rb"
      ? "from-rose-950 via-rose-900 to-rose-950"
      : "from-blue-950 via-blue-900 to-blue-950";
  const accentText = hostType === "rb" ? "text-rose-200" : "text-blue-200";
  const brandLabel =
    hostType === "rb"
      ? "RB Academy · Calendario AMM"
      : "Formazione Intermediari · Calendario 60h";
  const userName = context
    ? `${context.user.firstname} ${context.user.lastname}`.trim()
    : "";
  const greeting = !validIds
    ? "Completa il link con iduser e idcourse per continuare."
    : contextError
      ? contextError
      : context
        ? `Ciao ${userName}, scegli una data per prenotarti al test di verifica a distanza del corso ${context.course.name}.`
        : contextLoading
          ? "Recupero i dati del corsista..."
          : "Seleziona una fascia libera e conferma la prenotazione.";

  return (
    <div
      className={`min-h-screen bg-gradient-to-b ${gradientClasses} text-white flex flex-col`}
    >
      <header className="py-10 px-6 text-center space-y-3">
        <p className={`uppercase tracking-[0.3em] text-sm ${accentText}`}>
          {brandLabel}
        </p>
        <h1 className="text-4xl font-bold">
          {context && validIds ? `Ciao ${userName}` : "Prenota uno slot disponibile"}
        </h1>
        <p className="text-slate-100 max-w-3xl mx-auto">{greeting}</p>
      </header>

      <main className="flex-1 bg-white rounded-t-3xl p-6 md:p-10 shadow-2xl">
        <div className="max-w-5xl mx-auto space-y-6">
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
            <div className="flex flex-col text-sm text-slate-500">
              <span className="uppercase tracking-wide text-xs">
                ID Utente LMS
              </span>
              <span className="text-lg font-semibold text-slate-800 mt-1">
                {defaults.iduser || "Parametro mancante"}
              </span>
            </div>
            <div className="flex flex-col text-sm text-slate-500">
              <span className="uppercase tracking-wide text-xs">
                ID Corso
              </span>
              <span className="text-lg font-semibold text-slate-800 mt-1">
                {defaults.idcourse || "Parametro mancante"}
              </span>
            </div>
            <label className="flex flex-col text-sm text-slate-600 md:col-span-1 col-span-full">
              Note interne (facoltative)
              <input
                className="mt-1 border rounded px-3 py-2"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Es. preferenza Zoom"
              />
            </label>
          </section>

          {!validIds && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 px-4 py-2 rounded">
              Il link deve contenere i parametri <code>iduser</code> e{" "}
              <code>idcourse</code>.
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded">
              {error}
            </div>
          )}
          {message && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-2 rounded">
              {message}
            </div>
          )}

          {loading ? (
            <div className="text-center text-slate-500 py-20">
              Caricamento disponibilità…
            </div>
          ) : slots.length === 0 ? (
            <div className="text-center text-slate-500 py-20">
              Nessuno slot disponibile nelle prossime settimane.
            </div>
          ) : (
            groupedSlots.map(([date, items]) => (
              <div
                key={date}
                className="border border-slate-200 rounded-xl p-4 space-y-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold text-slate-800 capitalize">
                    {formatterDate.format(new Date(date))}
                  </h3>
                  <span className="text-sm text-slate-500">
                    {items.length} slot disponibili
                  </span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {items.map((slot) => (
                    <button
                      key={slot.id}
                      onClick={() => handleBook(slot)}
                      disabled={bookingSlot === slot.id || !validIds}
                      className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:border-blue-300 hover:text-blue-600 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {formatterTime.format(new Date(slot.start))}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}

          <div className="flex justify-between items-center text-sm text-slate-500">
            <button
              onClick={() => setRefreshKey((x) => x + 1)}
              className="text-blue-600 hover:underline"
            >
              Aggiorna disponibilità
            </button>
            <span>
              {calendar === "amm"
                ? "Prenotazioni instradate su RB Academy"
                : "Prenotazioni instradate su Formazione Intermediari"}
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
