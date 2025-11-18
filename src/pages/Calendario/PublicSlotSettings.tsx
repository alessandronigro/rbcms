import { useEffect, useMemo, useState } from "react";
import { useAlert } from "@/components/SmartAlertModal";

type DayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

type DayRange = {
  start: string;
  end: string;
};

type SlotConfig = {
  slotMinutes: number;
  weeksAhead: number;
  days: Record<DayKey, DayRange[]>;
  closedDays: string[];
  updatedAt?: string | null;
};

const CALENDARS = [
  { key: "60h", label: "Calendario 60h" },
  { key: "amm", label: "Calendario AMM" },
] as const;

const DAY_ORDER: DayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const DAY_LABEL: Record<DayKey, string> = {
  monday: "Lunedì",
  tuesday: "Martedì",
  wednesday: "Mercoledì",
  thursday: "Giovedì",
  friday: "Venerdì",
  saturday: "Sabato",
  sunday: "Domenica",
};

const defaultRanges = (): Record<DayKey, DayRange[]> => ({
  monday: [
    { start: "09:00", end: "13:00" },
    { start: "14:00", end: "18:00" },
  ],
  tuesday: [
    { start: "09:00", end: "13:00" },
    { start: "14:00", end: "18:00" },
  ],
  wednesday: [
    { start: "09:00", end: "13:00" },
    { start: "14:00", end: "18:00" },
  ],
  thursday: [
    { start: "09:00", end: "13:00" },
    { start: "14:00", end: "18:00" },
  ],
  friday: [
    { start: "09:00", end: "13:00" },
    { start: "14:00", end: "18:00" },
  ],
  saturday: [],
  sunday: [],
});

const blankConfig = (): SlotConfig => ({
  slotMinutes: 60,
  weeksAhead: 2,
  days: defaultRanges(),
  closedDays: [],
  updatedAt: null,
});

export default function PublicSlotSettings() {
  const { alert } = useAlert();
  const [configs, setConfigs] = useState<Record<string, SlotConfig>>({
    "60h": blankConfig(),
    amm: blankConfig(),
  });
  const [active, setActive] = useState<string>("60h");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newClosedDate, setNewClosedDate] = useState("");

  const activeConfig = useMemo(() => {
    return configs[active] || blankConfig();
  }, [configs, active]);

  useEffect(() => {
    loadConfigs();
  }, []);

  const normalizeIncomingConfig = (value?: Partial<SlotConfig>): SlotConfig => {
    if (!value) return blankConfig();
    const merged = blankConfig();
    merged.slotMinutes = Number(value.slotMinutes) || merged.slotMinutes;
    merged.weeksAhead = Number(value.weeksAhead) || merged.weeksAhead;
    merged.closedDays = Array.isArray(value.closedDays)
      ? value.closedDays.filter(Boolean)
      : [];
    merged.updatedAt = value.updatedAt ?? null;

    const incomingDays: Partial<Record<DayKey, DayRange[]>> = value.days || {};
    for (const day of DAY_ORDER) {
      const source = incomingDays[day];
      const ranges = Array.isArray(source) ? source : [];
      merged.days[day] = ranges.map((range) => ({
        start: sanitizeTime(range?.start) || "",
        end: sanitizeTime(range?.end) || "",
      }));
    }
    return merged;
  };

  const loadConfigs = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/public-slots/settings", {
        credentials: "include",
      });
      const json = await res.json();
      if (json?.configs) {
        const next: Record<string, SlotConfig> = { ...configs };
        for (const key of Object.keys(json.configs)) {
          next[key] = normalizeIncomingConfig(json.configs[key]);
        }
        setConfigs(next);
      }
    } catch (err) {
      console.error("Impossibile caricare configurazioni slot", err);
      await alert("Errore nel caricamento delle impostazioni");
    } finally {
      setLoading(false);
    }
  };

  const updateConfig = (updater: (prev: SlotConfig) => SlotConfig) => {
    setConfigs((prev) => ({
      ...prev,
      [active]: updater(prev[active] || blankConfig()),
    }));
  };

  const handleRangeChange = (
    day: DayKey,
    index: number,
    field: keyof DayRange,
    value: string,
  ) => {
    updateConfig((prev) => {
      const next = { ...prev };
      const ranges = [...(next.days[day] || [])];
      ranges[index] = { ...ranges[index], [field]: value };
      next.days = { ...next.days, [day]: ranges };
      return next;
    });
  };

  const addRange = (day: DayKey) => {
    updateConfig((prev) => {
      const next = { ...prev };
      const ranges = [...(next.days[day] || [])];
      ranges.push({ start: "09:00", end: "10:00" });
      next.days = { ...next.days, [day]: ranges };
      return next;
    });
  };

  const removeRange = (day: DayKey, index: number) => {
    updateConfig((prev) => {
      const next = { ...prev };
      const ranges = [...(next.days[day] || [])];
      ranges.splice(index, 1);
      next.days = { ...next.days, [day]: ranges };
      return next;
    });
  };

  const addClosedDay = () => {
    if (!newClosedDate) return;
    updateConfig((prev) => {
      if (prev.closedDays.includes(newClosedDate)) return prev;
      return { ...prev, closedDays: [...prev.closedDays, newClosedDate] };
    });
    setNewClosedDate("");
  };

  const removeClosedDay = (date: string) => {
    updateConfig((prev) => ({
      ...prev,
      closedDays: prev.closedDays.filter((d) => d !== date),
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        calendar: active,
        config: configs[active],
      };
      const res = await fetch("/api/public-slots/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Salvataggio fallito");
      await alert("Impostazioni salvate correttamente");
      await loadConfigs();
    } catch (err) {
      console.error("salvataggio slot ERR", err);
      await alert("Non è stato possibile salvare le impostazioni");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 mb-1">
          Slot pubblici calendario
        </h1>
        <p className="text-gray-600 text-sm">
          Configura fasce orarie e chiusure da rendere prenotabili sui domini
          pubblici formazioneintermediari.com e rb-academy.it
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {CALENDARS.map((c) => (
          <button
            key={c.key}
            onClick={() => setActive(c.key)}
            className={`px-4 py-2 rounded-md border text-sm font-medium transition ${
              active === c.key
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white p-6 rounded shadow text-center text-gray-500">
          Caricamento impostazioni…
        </div>
      ) : (
        <div className="bg-white p-6 rounded-lg shadow space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="flex flex-col text-sm">
              Settimane visibili
              <input
                type="number"
                min={1}
                max={12}
                value={activeConfig.weeksAhead}
                onChange={(e) =>
                  updateConfig((prev) => ({
                    ...prev,
                    weeksAhead: Math.max(1, Number(e.target.value) || 1),
                  }))
                }
                className="border rounded px-3 py-2 mt-1"
              />
            </label>
            <label className="flex flex-col text-sm">
              Durata slot (minuti)
              <input
                type="number"
                min={15}
                max={240}
                value={activeConfig.slotMinutes}
                onChange={(e) =>
                  updateConfig((prev) => ({
                    ...prev,
                    slotMinutes: Math.max(15, Number(e.target.value) || 15),
                  }))
                }
                className="border rounded px-3 py-2 mt-1"
              />
            </label>
            <div className="text-sm text-gray-500 flex flex-col justify-end">
              {activeConfig.updatedAt ? (
                <span>
                  Ultimo aggiornamento:{" "}
                  {new Date(activeConfig.updatedAt).toLocaleString("it-IT")}
                </span>
              ) : (
                <span>Nessuna modifica salvata</span>
              )}
            </div>
          </div>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-800">
                Fasce orarie settimanali
              </h2>
              <p className="text-sm text-gray-500 max-w-md text-right">
                Gli slot vengono generati in intervalli di{" "}
                {activeConfig.slotMinutes} minuti all&apos;interno delle fasce
                definite per ciascun giorno.
              </p>
            </div>
            <div className="space-y-4">
              {DAY_ORDER.map((day) => {
                const ranges = activeConfig.days[day] || [];
                return (
                  <div
                    key={day}
                    className="border rounded-md p-4 space-y-3 bg-gray-50"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-gray-800">
                        {DAY_LABEL[day]}
                      </h3>
                      <button
                        onClick={() => addRange(day)}
                        className="text-xs px-3 py-1 rounded border border-blue-200 text-blue-600 hover:bg-blue-50"
                      >
                        + Aggiungi fascia
                      </button>
                    </div>

                    {ranges.length === 0 ? (
                      <p className="text-sm text-gray-500">
                        Nessuna fascia impostata per questo giorno.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {ranges.map((range, idx) => (
                          <div
                            key={`${day}-${idx}`}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <label className="text-sm text-gray-600">
                              Inizio
                              <input
                                type="time"
                                value={range.start}
                                onChange={(e) =>
                                  handleRangeChange(
                                    day,
                                    idx,
                                    "start",
                                    e.target.value,
                                  )
                                }
                                className="border rounded px-2 py-1 ml-2"
                              />
                            </label>
                            <label className="text-sm text-gray-600">
                              Fine
                              <input
                                type="time"
                                value={range.end}
                                onChange={(e) =>
                                  handleRangeChange(
                                    day,
                                    idx,
                                    "end",
                                    e.target.value,
                                  )
                                }
                                className="border rounded px-2 py-1 ml-2"
                              />
                            </label>
                            <button
                              onClick={() => removeRange(day, idx)}
                              className="text-xs text-red-500 hover:underline"
                            >
                              Rimuovi
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">
                Giorni di chiusura straordinaria
              </h2>
            </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="date"
              value={newClosedDate}
              onChange={(e) => setNewClosedDate(e.target.value)}
              className="border rounded px-3 py-2"
            />
            <button
              onClick={addClosedDay}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-500"
            >
              Aggiungi giorno
            </button>
          </div>

          {activeConfig.closedDays.length === 0 ? (
            <p className="text-sm text-gray-500">
              Nessun giorno di chiusura programmato.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {activeConfig.closedDays.map((date) => (
                <span
                  key={date}
                  className="inline-flex items-center bg-gray-200 text-sm text-gray-700 px-3 py-1 rounded-full"
                >
                  {new Date(date).toLocaleDateString("it-IT")}
                  <button
                    className="ml-2 text-gray-600 hover:text-red-600"
                    onClick={() => removeClosedDay(date)}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </section>

          <div className="flex justify-end gap-3">
            <button
              onClick={loadConfigs}
              className="px-4 py-2 border rounded text-sm text-gray-700 hover:bg-gray-50"
            >
              Annulla
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 disabled:opacity-60"
            >
              {saving ? "Salvataggio…" : "Salva impostazioni"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function sanitizeTime(value?: string) {
  if (!value) return "";
  const match = /^([0-1]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? `${match[1]}:${match[2]}` : "";
}
