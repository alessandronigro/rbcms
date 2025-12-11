import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Editor } from "@tinymce/tinymce-react";
import { useAlert } from "@/components/SmartAlertModal";
import { backendUrl } from "@/config/backend";

type ReminderStatus = "completato" | "iscritto" | "in-itinere";
type StatusFilter = "tutti" | ReminderStatus | "iscritto-in-itinere";
type PeriodFilter = "tutti" | "anno-corrente" | "mese-corrente" | "personalizzato";
type ConditionMatchMode = "any" | "all";

interface ConditionGroup {
  id: string;
  matchMode: ConditionMatchMode;
  courses: string;
  notEnrolledThisYear: boolean;
  excludeCourses: string;
}

interface ReminderUser {
  id: number;
  nome: string;
  cognome: string;
  email: string;
  courseId: string;
  courseName: string;
  convenzione: string;
  lastActivity: string;
  statusKey: ReminderStatus;
  statusLabel: string;
}

const now = new Date();
const MOCK_USERS: ReminderUser[] = [
  {
    id: 1,
    nome: "Anna",
    cognome: "Bianchi",
    email: "anna.bianchi@example.com",
    courseId: "101",
    courseName: "Corso Manageriale",
    convenzione: "RB Academy",
    lastActivity: new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 3,
    ).toISOString(),
    statusKey: "in-itinere",
    statusLabel: "In itinere",
  },
  {
    id: 2,
    nome: "Luca",
    cognome: "Ferrari",
    email: "luca.ferrari@example.com",
    courseId: "205",
    courseName: "Sicurezza Lavoro",
    convenzione: "Convenzione SNA",
    lastActivity: new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 10,
    ).toISOString(),
    statusKey: "iscritto",
    statusLabel: "Iscritto",
  },
  {
    id: 3,
    nome: "Giulia",
    cognome: "Conti",
    email: "giulia.conti@example.com",
    courseId: "401",
    courseName: "Project Management",
    convenzione: "RB Academy",
    lastActivity: new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      15,
    ).toISOString(),
    statusKey: "completato",
    statusLabel: "Completato",
  },
  {
    id: 4,
    nome: "Marco",
    cognome: "Romano",
    email: "marco.romano@example.com",
    courseId: "178",
    courseName: "Digital Marketing",
    convenzione: "Camp Relazioni",
    lastActivity: new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 20,
    ).toISOString(),
    statusKey: "iscritto",
    statusLabel: "Iscritto",
  },
  {
    id: 5,
    nome: "Eleonora",
    cognome: "Gentili",
    email: "eleonora.gentili@example.com",
    courseId: "330",
    courseName: "Contabilità Avanzata",
    convenzione: "Convenzione SNA",
    lastActivity: new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
    ).toISOString(),
    statusKey: "in-itinere",
    statusLabel: "In itinere",
  },
];

const parseConditionCourseCodes = (value: string) =>
  value
    .split(/[\s,;]+/)
    .map((code) => code.trim())
    .filter(Boolean);

const createConditionGroup = (): ConditionGroup => ({
  id: `${Date.now()}-${Math.random()}`,
  matchMode: "any",
  courses: "",
  notEnrolledThisYear: true,
  excludeCourses: "",
});

interface Filters {
  period: PeriodFilter;
  from: string;
  to: string;
  course: string;
  convenzione: string;
  format: string;
  status: StatusFilter;
  conditions: ConditionGroup[];
}

function hasActiveFilters(filters: Filters) {
  if (filters.period && filters.period !== "tutti") {
    return true;
  }
  if (filters.course) return true;
  if (filters.convenzione) return true;
  if (filters.status && filters.status !== "tutti") return true;
  if (filters.from || filters.to) return true;
  if (filters.format) return true;
  if (filters.conditions.some((condition) => parseConditionCourseCodes(condition.courses).length)) {
    return true;
  }
  return false;
}

const REMINDER_META_KEY = "reminder";

export default function Reminder() {
  const { alert } = useAlert();
  const [filters, setFilters] = useState<Filters>({
    period: "tutti",
    from: "",
    to: "",
    course: "",
    convenzione: "",
    format: "",
    status: "tutti",
    conditions: [],
  });
  const [users, setUsers] = useState<ReminderUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [courses, setCourses] = useState<{ idCourse: number; code: string; name: string }[]>([]);
  const [convenzioni, setConvenzioni] = useState<{ Codice: string; Name: string }[]>([]);
  const [formats, setFormats] = useState<Record<string, string[]>>({});
  const [formatKey, setFormatKey] = useState("");
  const [subject, setSubject] = useState("Reminder RB");
  const [body, setBody] = useState("");
  const [templateLoading, setTemplateLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [sendingState, setSendingState] = useState<null | "transactional" | "campaign" | "test">(null);
  const [filtersApplied, setFiltersApplied] = useState(false);
  const [filterHint, setFilterHint] = useState("Seleziona almeno un filtro e premi «Applica filtri» per caricare i corsisti.");
  const editorRef = useRef<any>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const addCondition = () => {
    setFilters((prev) => ({
      ...prev,
      conditions: [...prev.conditions, createConditionGroup()],
    }));
  };

  const removeCondition = (id: string) => {
    setFilters((prev) => ({
      ...prev,
      conditions: prev.conditions.filter((condition) => condition.id !== id),
    }));
  };

  const updateCondition = (id: string, updates: Partial<ConditionGroup>) => {
    setFilters((prev) => ({
      ...prev,
      conditions: prev.conditions.map((condition) =>
        condition.id === id ? { ...condition, ...updates } : condition,
      ),
    }));
  };

  const updateSubject = (value: string) => {
    setSubject(value);
  };

  const formattedPeriods = useMemo(() => {
    const nowDate = new Date();
    return {
      startOfYear: new Date(nowDate.getFullYear(), 0, 1),
      startOfMonth: new Date(nowDate.getFullYear(), nowDate.getMonth(), 1),
    };
  }, []);

  const filteredUsers = useMemo(() => {
    if (!filtersApplied) return [];
    return users.filter((user) => {
      if (filters.course && filters.course !== user.courseId) return false;
      if (filters.convenzione && filters.convenzione !== user.convenzione) return false;

      if (filters.period === "anno-corrente") {
        if (user.lastActivity) {
          const date = new Date(user.lastActivity);
          if (isNaN(date.getTime()) || date < formattedPeriods.startOfYear) return false;
        }
      }
      if (filters.period === "mese-corrente") {
        if (user.lastActivity) {
          const date = new Date(user.lastActivity);
          if (isNaN(date.getTime()) || date < formattedPeriods.startOfMonth) return false;
        }
      }
      if (filters.period === "personalizzato" && user.lastActivity) {
        const date = new Date(user.lastActivity);
        if (!isNaN(date.getTime())) {
          const fromDate = filters.from ? new Date(filters.from) : null;
          const toDate = filters.to ? new Date(filters.to) : null;
          if (fromDate) fromDate.setHours(0, 0, 0, 0);
          if (toDate) toDate.setHours(23, 59, 59, 999);
          if ((fromDate && date < fromDate) || (toDate && date > toDate)) {
            return false;
          }
        }
      }
      const normalizedStatus = user.statusKey || "iscritto";
      switch (filters.status) {
        case "completato":
          if (normalizedStatus !== "completato") return false;
          break;
        case "in-itinere":
          if (normalizedStatus !== "in-itinere") return false;
          break;
        case "iscritto":
          if (normalizedStatus !== "iscritto") return false;
          break;
        case "iscritto-in-itinere":
          if (!["iscritto", "in-itinere"].includes(normalizedStatus)) return false;
          break;
        default:
          break;
      }
      return true;
    });
  }, [users, filters, formattedPeriods, filtersApplied]);

  const visibleIds = useMemo(() => filteredUsers.map((user) => user.id), [filteredUsers]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  const handleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const toggleUserSelection = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id],
    );
  };

  const fetchUsers = useCallback(
    async (targetFilters: Filters, markApplied = true) => {
      setLoadingUsers(true);
      try {
        const params = new URLSearchParams();
        params.set("period", targetFilters.period);
        if (targetFilters.course) params.set("course", targetFilters.course);
        if (targetFilters.convenzione) params.set("convenzione", targetFilters.convenzione);
        if (targetFilters.format) params.set("format", targetFilters.format);
        if (targetFilters.from) params.set("from", targetFilters.from);
        if (targetFilters.to) params.set("to", targetFilters.to);
        if (targetFilters.status && targetFilters.status !== "tutti") params.set("status", targetFilters.status);
        const conditionPayloads = targetFilters.conditions
          .map((condition) => ({
            matchMode: condition.matchMode,
            notEnrolledThisYear: condition.notEnrolledThisYear,
            courseCodes: parseConditionCourseCodes(condition.courses),
            excludeCourseCodes: parseConditionCourseCodes(condition.excludeCourses),
          }))
          .filter((condition) => condition.courseCodes.length > 0);

        if (conditionPayloads.length) {
          params.set("conditions", JSON.stringify(conditionPayloads));
        }

        const baseCandidates = backendUrl ? [backendUrl, ""] : [""];
        const urls = baseCandidates.map((base) => `${base || ""}/api/reminder/users?${params.toString()}`);

        let response: Response | null = null;
        let lastError: Error | null = null;

        for (const url of urls) {
          try {
            const candidate = await fetch(url, { credentials: "include" });
            if (candidate.ok) {
              response = candidate;
              break;
            }
            lastError = new Error(`Reminder API ${url} risponde ${candidate.status}`);
            console.warn("Reminder users fetch fallita:", candidate.status, candidate.statusText, url);
          } catch (error) {
            lastError = error as Error;
            console.warn("Reminder users fetch errore:", url, error);
          }
        }

        if (!response || !response.ok) {
          throw lastError ?? new Error("Nessuna risposta valida dal backend reminder");
        }

        const payload = await response.json();
        if (Array.isArray(payload?.users)) {
          setUsers(payload.users);
          setSelectedIds([]);
          if (markApplied) {
            setFiltersApplied(true);
            setFilterHint("");
          }
          return;
        }
      } catch (error) {
        console.error("Errore caricamento utenti reminder:", error);
      } finally {
        setLoadingUsers(false);
      }

      setFilterHint("");
      if (markApplied) setFiltersApplied(true);
      setUsers(MOCK_USERS);
      setSelectedIds([]);
    },
    [backendUrl],
  );

  const loadMetadata = useCallback(async () => {
    if (!backendUrl) return;
    try {
      const [convRes, corsiRes, formatRes] = await Promise.all([
        fetch(`${backendUrl}/api/convenzioni?visibile=1`),
        fetch(`${backendUrl}/api/convenzioni/lookups/learning-corsi`),
        fetch(`${backendUrl}/api/mailformat/list`),
      ]);
      if (convRes.ok) {
        setConvenzioni(await convRes.json());
      }
      if (corsiRes.ok) {
        const corsi = await corsiRes.json();
        setCourses(corsi);
      }
      if (formatRes.ok) {
        const data = await formatRes.json();
        if (data.success) {
          setFormats(data.data);
        }
      }
    } catch (error) {
      console.error("Errore caricamento metadata reminder:", error);
    }
  }, [backendUrl]);

  const handleApplyFilters = useCallback(() => {
    if (!hasActiveFilters(filters)) {
      setFilterHint("Seleziona almeno un filtro e premi «Applica filtri» per caricare i corsisti.");
      setFiltersApplied(false);
      setUsers([]);
      setSelectedIds([]);
      return;
    }
    fetchUsers(filters);
  }, [fetchUsers, filters]);

  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  useEffect(() => {
    if (formatKey) return;
    const reminderFormat =
      Object.values(formats)
        .flat()
        .find((key) => key.toLowerCase() === REMINDER_META_KEY) ?? "";

    if (!reminderFormat) return;
    setFilters((prev) => ({ ...prev, format: reminderFormat }));
    setFormatKey(reminderFormat);
  }, [formats, formatKey]);

  useEffect(() => {
    if (!formatKey || !backendUrl) return;
    setTemplateLoading(true);
    fetch(`${backendUrl}/api/mailformat/${formatKey}`)
      .then((res) => res.text())
      .then((value) => {
        setBody(value);
        // Removed automatic subject overwrite to preserve subject loaded from backend
      })
      .catch((err) => {
        console.error("Errore caricamento corpo email:", err);
        setBody((prev) => prev || "");
      })
      .finally(() => setTemplateLoading(false));
  }, [formatKey, backendUrl]);

  useEffect(() => {
    if (!formatKey || !backendUrl) return;
    fetch(`${backendUrl}/api/mailformat/${formatKey}/subject`)
      .then((res) => res.json())
      .then((payload) => {
        if (payload?.subject !== undefined && payload?.subject !== null) {
          setSubject(payload.subject);
        }
      })
      .catch((err) => {
        console.error("Errore caricamento oggetto reminder:", err);
      });
  }, [formatKey, backendUrl]);

  useEffect(() => {
    if (!formatKey || templateLoading) return;
    const focusTimer = setTimeout(() => {
      editorRef.current?.focus?.();
    }, 200);
    return () => clearTimeout(focusTimer);
  }, [formatKey, templateLoading]);

  const handleSendTransactional = async () => {
    if (selectedIds.length === 0) {
      await alert("Seleziona almeno un utente prima di inviare l'email.", {
        type: "warning",
      });
      return;
    }
    setSendingState("transactional");
    try {
      const recipients = users.filter((user) => selectedIds.includes(user.id));
      const response = await fetch(`${backendUrl || ""}/api/reminder/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients,
          subject,
          body,
          filters,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      await alert(
        payload?.message || "Email transazionale inviata (o simulata in ambiente di sviluppo).",
        { type: response.ok ? "success" : "error" },
      );
    } catch (error) {
      console.error("Errore invio email transazionale:", error);
      await alert("Errore durante l'invio transazionale.", { type: "error" });
    } finally {
      setSendingState(null);
    }
  };

  const handleSendCampaign = async () => {
    if (selectedIds.length === 0) {
      await alert("Seleziona almeno un utente prima di inviare la campagna Brevo.", {
        type: "warning",
      });
      return;
    }
    setSendingState("campaign");
    try {
      const recipients = users.filter((user) => selectedIds.includes(user.id));
      const response = await fetch(`${backendUrl || ""}/api/reminder/brevo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients,
          subject,
          body,
          format: formatKey,
          filters,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      await alert(payload?.message || "Campagna Brevo inviata (o simulata).", {
        type: response.ok ? "success" : "error",
      });
    } catch (error) {
      console.error("Errore invio campagna Brevo:", error);
      await alert("Errore durante l'invio campagna Brevo.", { type: "error" });
    } finally {
      setSendingState(null);
    }
  };

  const handleFilterChange = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSendTestEmail = async () => {
    const testRecipient = {
      id: 0,
      nome: "Support",
      cognome: "RB Consulenza",
      email: "supporto@rbconsulenza.com",
      courseId: "",
      courseName: "Mail di test",
      convenzione: "Support RB",
      lastActivity: new Date().toISOString(),
    };
    setSendingState("test");
    try {
      const response = await fetch(`${backendUrl || ""}/api/reminder/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: [testRecipient],
          subject,
          body,
          filters,
          test: true,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      await alert(payload?.message || "Email di test inviata a supporto@rbconsulenza.com.", {
        type: response.ok ? "success" : "error",
      });
    } catch (error) {
      console.error("Errore invio mail di test:", error);
      await alert("Errore durante l'invio della mail di test.", { type: "error" });
    } finally {
      setSendingState(null);
    }
  };

  const handleSaveTemplate = async () => {
    if (!formatKey) {
      await alert("Seleziona prima un formato email.");
      return;
    }
    if (!backendUrl) {
      await alert("Backend non configurato per salvare il formato.", { type: "warning" });
      return;
    }
    setSavingTemplate(true);
    try {
      const saveKey = formatKey.trim().toLowerCase() || REMINDER_META_KEY;
      console.log("Reminder salvataggio formato", {
        saveKey,
        subject,
        bodySnippet: body?.slice(0, 120),
        backendUrl,
      });
      const response = await fetch(`${backendUrl}/api/mailformat/${saveKey}`, {
        method: "POST",
        headers: { "Content-Type": "text/html" },
        body,
      });
      const subjectRes = await fetch(`${backendUrl}/api/mailformat/${saveKey}/subject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject }),
      });
      if (!subjectRes.ok) {
        console.warn("Errore salvataggio oggetto reminder:", await subjectRes.text());
      }
      console.log("Reminder salvataggio response", response.status, await response.clone().text().catch(() => "<no body>"));
      const payload = await response.json().catch(() => ({ success: response.ok }));
      if (response.ok) {
        await alert(payload?.message || "Formato salvato correttamente.", { type: "success" });
      } else {
        await alert(payload?.error || "Errore salvando il formato.", { type: "error" });
      }
    } catch (error) {
      console.error("Errore salvataggio template reminder:", error);
      await alert("Errore durante il salvataggio del formato email.", { type: "error" });
    } finally {
      setSavingTemplate(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-gray-800">Reminder</h1>
        <p className="text-sm text-gray-600 max-w-3xl">
          Filtra i destinatari, modifica oggetto e corpo, quindi invia una mail
          transazionale oppure una campagna massiva tramite Brevo.
        </p>
      </div>

      <section className="bg-white border rounded-lg shadow p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs uppercase font-semibold text-gray-500">
              Periodo
            </label>
            <select
              value={filters.period}
              onChange={(event) => {
                const value = event.target.value as PeriodFilter;
                setFilters((prev) => ({
                  ...prev,
                  period: value,
                  from: value === "personalizzato" ? prev.from : "",
                  to: value === "personalizzato" ? prev.to : "",
                }));
              }}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="tutti">Tutti i periodi</option>
              <option value="anno-corrente">Anno corrente</option>
              <option value="mese-corrente">Mese corrente</option>
              <option value="personalizzato">Periodo personalizzato</option>
            </select>
          </div>
          <div>
            <label className="text-xs uppercase font-semibold text-gray-500">
              Corso
            </label>
            <select
              value={filters.course}
              onChange={(event) => handleFilterChange("course", event.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">Tutti i corsi</option>
              {courses.map((course) => (
                <option key={course.idCourse} value={String(course.idCourse)}>
                  {course.code} — {course.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase font-semibold text-gray-500">
              Convenzionato
            </label>
            <select
              value={filters.convenzione}
              onChange={(event) => handleFilterChange("convenzione", event.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">Tutte le convenzioni</option>
              {convenzioni.map((item) => (
                <option key={item.Codice} value={item.Name}>
                  {item.Name} ({item.Codice})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase font-semibold text-gray-500">
              Stato corso
            </label>
            <select
              value={filters.status}
              onChange={(event) => handleFilterChange("status", event.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="tutti">Tutti gli stati</option>
              <option value="completato">Completati</option>
              <option value="iscritto">Solo iscritti</option>
              <option value="in-itinere">Solo in itinere</option>
              <option value="iscritto-in-itinere">Iscritti + in itinere</option>
            </select>
          </div>
        </div>

        {filters.period === "personalizzato" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase font-semibold text-gray-500">
                Dal
              </label>
              <input
                type="date"
                value={filters.from}
                onChange={(event) => handleFilterChange("from", event.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs uppercase font-semibold text-gray-500">
                Al
              </label>
              <input
                type="date"
                value={filters.to}
                onChange={(event) => handleFilterChange("to", event.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
        )}

        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <button
            type="button"
            onClick={handleApplyFilters}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded hover:bg-blue-700"
          >
            Applica filtri
          </button>
        </div>
      </section>

      <section className="bg-white border rounded-lg shadow p-4 space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-800">Condizioni avanzate</p>
            <p className="text-xs text-gray-500 max-w-3xl">
              Combina codici corso completati l’anno scorso e, se serve, escludi i corsisti iscritti quest’anno.
            </p>
          </div>
          <button
            type="button"
            onClick={addCondition}
            className="text-xs font-semibold text-blue-600 underline-offset-2 hover:text-blue-800"
          >
            + Aggiungi condizione
          </button>
        </div>

        {filters.conditions.length === 0 && (
          <p className="text-xs text-gray-500">
            Aggiungi una condizione per indicare gruppi di codici da combinare (es. cod3034 + cod6034 o cod1534).
          </p>
        )}

        {filters.conditions.length > 0 && (
          <div className="space-y-3">
            {filters.conditions.map((condition, index) => (
              <div key={condition.id} className="border rounded-lg p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs uppercase font-semibold tracking-wide text-gray-500">
                    Condizione {index + 1}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeCondition(condition.id)}
                    className="text-xs font-semibold text-red-600 hover:text-red-800"
                  >
                    Rimuovi
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-xs uppercase font-semibold text-gray-500">Modalità</label>
                  <select
                    value={condition.matchMode}
                    onChange={(event) =>
                      updateCondition(condition.id, { matchMode: event.target.value as ConditionMatchMode })
                    }
                    className="border rounded px-3 py-2 text-sm"
                  >
                    <option value="any">Almeno uno dei codici</option>
                    <option value="all">Tutti i codici indicati</option>
                  </select>
                  <label className="text-xs flex items-center gap-2 text-gray-600">
                    <input
                      type="checkbox"
                      checked={condition.notEnrolledThisYear}
                      onChange={(event) =>
                        updateCondition(condition.id, { notEnrolledThisYear: event.target.checked })
                      }
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Non iscritti quest'anno
                  </label>
                </div>

                <div className="space-y-1">
                  <label className="text-xs uppercase font-semibold text-gray-500">Codici corso</label>
                  <textarea
                    value={condition.courses}
                    onChange={(event) =>
                      updateCondition(condition.id, { courses: event.target.value })
                    }
                    placeholder="cod3034, cod6034 oppure cod1534"
                    rows={2}
                    className="w-full border rounded px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-gray-400">
                    Separare i codici con virgole, spazi o newline. Il sistema filtra solo i corsisti che hanno completato quei codici l’anno scorso.
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs uppercase font-semibold text-gray-500">Escludi codici quest'anno</label>
                  <textarea
                    value={condition.excludeCourses}
                    onChange={(event) =>
                      updateCondition(condition.id, { excludeCourses: event.target.value })
                    }
                    placeholder="cod3035, cod1525"
                    rows={2}
                    className="w-full border rounded px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-gray-400">
                    I corsisti verranno esclusi se risultano iscritti a uno di questi corsi sull’anno corrente.
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white border rounded-lg shadow">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <p className="text-sm text-gray-600">
              Seleziona i corsisti da includere nel reminder
            </p>
            <p className="text-xs text-gray-500">Utenti selezionati: {selectedIds.length}</p>
          </div>
          <div className="text-xs text-gray-500">
            {loadingUsers
              ? "Caricamento utenti..."
              : filtersApplied
                ? `${filteredUsers.length} risultati`
                : "Applica un filtro per caricare i corsisti"}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left">
            <thead className="bg-gray-50 uppercase text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={handleSelectAll}
                  />
                </th>
                <th className="px-3 py-2">Nome</th>
                <th className="px-3 py-2">Cognome</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Corso</th>
                <th className="px-3 py-2">Convenzione</th>
                <th className="px-3 py-2">Stato</th>
              </tr>
            </thead>
            <tbody>
              {loadingUsers && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                    Caricamento in corso...
                  </td>
                </tr>
              )}
              {!loadingUsers && !filtersApplied && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                    {filterHint}
                  </td>
                </tr>
              )}
              {!loadingUsers && filtersApplied && filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                    Nessun utente corrisponde ai filtri selezionati.
                  </td>
                </tr>
              )}
              {!loadingUsers &&
                filtersApplied &&
                filteredUsers.map((user) => (
                  <tr key={user.id} className="border-b">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(user.id)}
                        onChange={() => toggleUserSelection(user.id)}
                      />
                    </td>
                    <td className="px-3 py-2">{user.nome}</td>
                    <td className="px-3 py-2">{user.cognome}</td>
                    <td className="px-3 py-2">{user.email}</td>
                    <td className="px-3 py-2">
                      {user.courseName} • <span className="text-xs text-gray-500">{user.courseId}</span>
                    </td>
                    <td className="px-3 py-2">{user.convenzione}</td>
                    <td className="px-3 py-2 text-xs uppercase tracking-wide text-gray-600">
                      {user.statusLabel || user.statusKey}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white border rounded-lg shadow p-4 space-y-5">
        <div className="space-y-2">
          <label className="text-xs uppercase font-semibold text-gray-500">Oggetto</label>
          <input
            type="text"
            value={subject}
            onChange={(event) => updateSubject(event.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
            placeholder="Oggetto della mail"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs uppercase font-semibold text-gray-500">
            Formato email
          </label>
          <select
            value={filters.format}
            onChange={(event) => {
              handleFilterChange("format", event.target.value);
              setFormatKey(event.target.value);
            }}
            className="w-full border rounded px-3 py-2 text-sm"
          >
            <option value="">Seleziona un formato</option>
            {Object.entries(formats).map(([category, items]) => (
              <optgroup key={category} label={category}>
                {items.map((name) => (
                  <option key={`${category}:${name}`} value={name}>
                    {name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase font-semibold text-gray-500">Corpo dell'email</p>
            {templateLoading && (
              <span className="text-xs flex items-center gap-1 text-gray-600">
                <Loader2 className="w-3 h-3 animate-spin" /> caricamento template
              </span>
            )}
          </div>
          <Editor
            apiKey="vs06mlnbyyaej9ieyroykxlegntnwpcv6d4aw0vylqty0atm"
            value={body}
            onInit={(_, editor) => {
              editorRef.current = editor;
            }}
            init={{
              height: 320,
              menubar: false,
              plugins: [
                "link",
                "lists",
                "code",
                "preview",
                "table",
                "fullscreen",
                "advlist",
                "autolink",
                "lists",
                "charmap",
                "searchreplace",
                "visualblocks",
                "insertdatetime",
                "media",
                "help",
                "wordcount",
              ],
              toolbar:
                "undo redo | formatselect | bold italic underline | forecolor backcolor | " +
                "alignleft aligncenter alignright alignjustify | bullist numlist | table | code | preview",
            }}
            onEditorChange={(value) => setBody(value)}
          />
          <div className="flex flex-col gap-2 pt-3 border-t border-dashed border-gray-200 mt-2">
            <span className="text-xs uppercase tracking-wide text-gray-500">
              Formato email selezionato: {formatKey || "Nessuno"}
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSaveTemplate}
                disabled={
                  !formatKey || templateLoading || savingTemplate || !backendUrl
                }
                className="px-4 py-2 text-sm rounded bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-700"
              >
                {savingTemplate ? "Salvataggio..." : "Salva formato"}
              </button>
              {!backendUrl && (
                <span className="text-xs text-gray-400">
                  Backend non configurato → il salvataggio non è disponibile.
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-1 text-xs text-gray-500">
            <span>Le campagne Brevo sfruttano la chiave gestita dal backend.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSendTransactional}
              disabled={sendingState === "transactional"}
              className="px-4 py-2 rounded bg-green-600 text-white text-sm disabled:opacity-40 hover:bg-green-700"
            >
              {sendingState === "transactional" ? "Invio transazionale..." : "Invia email transazionale"}
            </button>
            <button
              type="button"
              onClick={handleSendCampaign}
              disabled={sendingState === "campaign"}
              className="px-4 py-2 rounded bg-indigo-600 text-white text-sm disabled:opacity-40 hover:bg-indigo-700"
            >
              {sendingState === "campaign" ? "Invio campagna..." : "Invia campagna Brevo"}
            </button>
            <button
              type="button"
              onClick={handleSendTestEmail}
              disabled={sendingState === "test"}
              className="px-4 py-2 rounded bg-yellow-600 text-white text-sm disabled:opacity-40 hover:bg-yellow-700"
            >
              {sendingState === "test" ? "Invio mail di test..." : "Invia mail di test"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
