import { ChangeEvent, useEffect, useMemo, useState } from "react";

const AVAILABLE_DBS = [
  "forma4",
  "formazionein",
  "newformazionein",
  "efadnovastudia",
  "formatest",
  "fadassiac",
  "formazionecondorb",
  "rbservizi",
  "rb60h",
  "rbamministratore",
  "rbacademy",
  "newformazione",
  "wpacquisti",
  "simplybiz",
  "novastudia",
];

type UploadedUser = {
  lastname: string;
  firstname: string;
  email: string;
  codicefiscale: string;
};

type Course = {
  idcourse: number;
  code: string;
  name: string;
};

type MasterInfo = {
  iduser: number | null;
  userid?: string | null;
  firstname?: string | null;
  lastname?: string | null;
  course_code?: string | null;
  course_name?: string | null;
  date_inscr?: string | null;
  date_complete?: string | null;
};

type CheckRow = {
  id: number | null;
  registered: boolean;
  started: boolean;
  status: number | null;
  date_inscr: string | null;
  date_complete: string | null;
  course_code?: string | null;
  course_name?: string | null;
  email?: string;
  firstname?: string;
  lastname?: string;
  note?: string;
  master?: MasterInfo | null;
  nearCandidates?: Array<{ offset: number; master: MasterInfo | null }>;
  userid?: string | null;
  hasMaster: boolean;
};

type SimulationResult = {
  targetUserId: number;
  success: boolean;
  log: string[];
};

const normalizeField = (value: string) => value.replace(/\uFEFF/g, "").trim();
const normalizeEmail = (value: string) => normalizeField(value).replace(/\s+/g, "");
const formatOffsetLabel = (offset: number) => {
  if (offset > 0) return `+${offset}g`;
  if (offset < 0) return `${offset}g`;
  return "0g";
};

export default function Simulazione() {
  const [database, setDatabase] = useState("forma4");
  const [courseId, setCourseId] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [coursesError, setCoursesError] = useState<string | null>(null);

  const [uploadedUsers, setUploadedUsers] = useState<UploadedUser[]>([]);
  const [checkResults, setCheckResults] = useState<CheckRow[]>([]);
  const [simulationResults, setSimulationResults] = useState<SimulationResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [availableDonors, setAvailableDonors] = useState<number | null>(null);

  const [donorInscrDate, setDonorInscrDate] = useState("");
  const [donorCompleteDate, setDonorCompleteDate] = useState("");
  const [filterSnapshot, setFilterSnapshot] = useState<{
    donorInscrDate: string;
    donorCompleteDate: string;
  } | null>(null);

  const simulationCandidates = useMemo(
    () =>
      checkResults
        .filter((row) => row.registered && row.status === 0 && row.hasMaster && row.id)
        .map((row) => row.id as number),
    [checkResults]
  );

  const masterReadyCount = useMemo(
    () => checkResults.filter((row) => row.hasMaster).length,
    [checkResults]
  );

  const ignoreFilters =
    checkResults.length > 0 && checkResults.every((row) => row.registered);

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      const lines = reader.result
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length);

      const parsed: UploadedUser[] = [];
      lines.forEach((line, index) => {
        if (index === 0 && line.toLowerCase().includes("cognome")) {
          return;
        }

        const parts = line.split(";");
        if (parts.length < 4) {
          return;
        }

        parsed.push({
          lastname: normalizeField(parts[0]),
          firstname: normalizeField(parts[1]),
          email: normalizeEmail(parts[2].toLowerCase()),
          codicefiscale: normalizeField(parts[3]).toUpperCase(),
        });
      });

      setUploadedUsers(parsed);
      setCheckResults([]);
      setMessage(null);
      setError(null);
      setFilterSnapshot(null);
      setAvailableDonors(null);
    };
    reader.readAsText(file);
  };

  const handleClearUsers = () => {
    setUploadedUsers([]);
    setCheckResults([]);
    setMessage(null);
    setError(null);
    setFilterSnapshot(null);
    setAvailableDonors(null);
  };

  const handleCheck = async () => {
    setError(null);
    setMessage(null);
    setAvailableDonors(null);
    if (!courseId) {
      setError("Seleziona un corso prima di controllare.");
      return;
    }
    if (!uploadedUsers.length) {
      setError("Carica un file (cognome;nome;email;codicefiscale) prima di controllare.");
      return;
    }

    setChecking(true);
    try {
      const response = await fetch("/api/simulazione/check", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          database,
          courseId: Number(courseId),
          users: uploadedUsers,
          donorInscrFrom: ignoreFilters ? null : donorInscrDate,
          donorInscrTo: ignoreFilters ? null : donorInscrDate,
          donorCompleteFrom: ignoreFilters ? null : donorCompleteDate,
          donorCompleteTo: ignoreFilters ? null : donorCompleteDate,
        }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error ?? "Errore durante il controllo.");

      setCheckResults(result.data);
      const registered = result.data.filter((row: CheckRow) => row.registered).length;
      const allRegistered = result.data.every((row: CheckRow) => row.registered);
      const available = typeof result.availableDonors === "number" ? result.availableDonors : null;
      setFilterSnapshot(
        allRegistered
          ? null
          : {
              donorInscrDate,
              donorCompleteDate,
            }
      );
      setMessage(`Controllo completato: ${registered} iscritti trovati su ${result.data.length}.`);
      setAvailableDonors(available);
    } catch (err) {
      console.error("Errore check simulazione", err);
      setCheckResults([]);
      setError(err instanceof Error ? err.message : "Errore generico");
    } finally {
      setChecking(false);
    }
  };

  const handleSimulate = async () => {
    setError(null);
    setMessage(null);
    if (!courseId) {
      setError("Seleziona un corso prima di simulare.");
      return;
    }
    if (!simulationCandidates.length) {
      setError("Nessun utente pronto (status=0 + iscrizione).");
      return;
    }

    setSimulating(true);
    try {
      const response = await fetch("/api/simulazione/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          database,
          courseId: Number(courseId),
          userIds: simulationCandidates,
          donorInscrFrom: ignoreFilters
            ? null
            : filterSnapshot?.donorInscrDate ?? donorInscrDate,
          donorInscrTo: ignoreFilters
            ? null
            : filterSnapshot?.donorInscrDate ?? donorInscrDate,
          donorCompleteFrom: ignoreFilters
            ? null
            : filterSnapshot?.donorCompleteDate ?? donorCompleteDate,
          donorCompleteTo: ignoreFilters
            ? null
            : filterSnapshot?.donorCompleteDate ?? donorCompleteDate,
        }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error ?? "Errore durante la simulazione.");

      setSimulationResults(result.data);
      setMessage("Simulazione completata.");
    } catch (err) {
      console.error("Errore esecuzione simulazione", err);
      setSimulationResults([]);
      setError(err instanceof Error ? err.message : "Errore generico");
    } finally {
      setSimulating(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const loadCourses = async () => {
      setLoadingCourses(true);
      setCoursesError(null);
      try {
        const response = await fetch(`/api/simulazione/courses?db=${encodeURIComponent(database)}`, {
          credentials: "include",
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!payload.success) throw new Error(payload.error ?? "Errore recupero corsi");
        const list = Array.isArray(payload.data) ? (payload.data as Course[]) : [];
        setCourses(list);
        setCourseId((previous) => {
          if (previous && list.some((course: Course) => String(course.idcourse) === previous)) {
            return previous;
          }
          return list.length ? String(list[0].idcourse) : "";
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("Errore fetch corsi simulazione", err);
          setCoursesError((err as Error).message || "Impossibile caricare i corsi");
          setCourses([]);
          setCourseId("");
        }
      } finally {
        setLoadingCourses(false);
      }
    };

    loadCourses();
    return () => controller.abort();
  }, [database]);

  return (
    <div className="space-y-6">
      <section className="bg-white shadow rounded p-6 space-y-4">
        <div className="flex flex-wrap gap-4">
          <label className="flex-1 min-w-[200px] text-sm text-gray-700">
            Database
            <select
              className="mt-1 w-full border rounded px-3 py-2"
              value={database}
              onChange={(event) => setDatabase(event.target.value)}
            >
              {AVAILABLE_DBS.map((db) => (
                <option key={db} value={db}>
                  {db}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 min-w-[200px] text-sm text-gray-700">
            Corso
            <select
              className="mt-1 w-full border rounded px-3 py-2"
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
              disabled={!courses.length || loadingCourses}
            >
              {courses.map((course) => (
                <option key={`course-${course.idcourse}`} value={course.idcourse}>
                  {course.code} — {course.name}
                </option>
              ))}
            </select>
            {loadingCourses && <p className="text-xs text-gray-500 mt-1">Caricamento corsi…</p>}
            {!loadingCourses && coursesError && (
              <p className="text-xs text-red-600 mt-1">{coursesError}</p>
            )}
            {ignoreFilters && (
              <p className="text-xs text-gray-500 mt-1">
                Gli utenti sono già iscritti, il corso e le date non vengono considerati.
              </p>
            )}
          </label>
        </div>

        {!ignoreFilters && (
          <div className="grid md:grid-cols-2 gap-4 text-sm text-gray-700">
            <label className="flex flex-col">
              Data iscrizione
              <input
                type="date"
                className="border rounded px-3 py-2 mt-1"
                value={donorInscrDate}
                onChange={(event) => setDonorInscrDate(event.target.value)}
              />
            </label>
            <label className="flex flex-col">
              Data completamento
              <input
                type="date"
                className="border rounded px-3 py-2 mt-1"
                value={donorCompleteDate}
                onChange={(event) => setDonorCompleteDate(event.target.value)}
              />
            </label>
          </div>
        )}

        <div className="space-y-1 text-sm text-gray-600">
          <label className="block">
            Lista utenti da simulare (csv con intestazione: cognome;nome;email;codicefiscale)
            <input type="file"
              accept=".csv,.txt"
              onChange={handleFileUpload}
              className="block mt-1 text-xs"
            />
          </label>
          <p className="text-xs text-gray-500">Il file viene analizzato lato client e sostituisce la lista precedente.</p>
        </div>

        {uploadedUsers.length > 0 && (
          <div className="bg-slate-50 border rounded p-4 text-sm text-gray-700 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{uploadedUsers.length} utenti caricati</span>
              <button
                type="button"
                onClick={handleClearUsers}
                className="text-xs text-blue-600 hover:underline"
              >
                Rimuovi lista
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 uppercase">
                    <th className="px-2 py-1">Cognome</th>
                    <th className="px-2 py-1">Nome</th>
                    <th className="px-2 py-1">Email</th>
                    <th className="px-2 py-1">Codice fiscale</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadedUsers.slice(0, 6).map((user, index) => (
                    <tr key={`${user.email}-${index}`} className="border-t">
                      <td className="px-2 py-1">{user.lastname}</td>
                      <td className="px-2 py-1">{user.firstname}</td>
                      <td className="px-2 py-1 font-mono">{user.email}</td>
                      <td className="px-2 py-1">{user.codicefiscale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {uploadedUsers.length > 6 && (
              <p className="text-xs text-gray-500">Visualizzati solo i primi 6 record.</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleCheck}
            disabled={checking || !uploadedUsers.length || !courseId}
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-200"
          >
            {checking ? "Controllo..." : "Controlla iscrizioni"}
          </button>
          <button
            type="button"
            onClick={handleSimulate}
            disabled={simulating || !simulationCandidates.length || !courseId}
            className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:bg-green-200"
          >
            {simulating ? "Simulazione in corso..." : "Avvia simulazione"}
          </button>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
        {message && (
          <p className="text-xs text-gray-600">
            {message} {simulationCandidates.length ? `Utenti pronti: ${simulationCandidates.length}.` : ""}
          </p>
        )}
      </section>

      <section className="bg-white shadow rounded p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Risultati controllo</h2>
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span>{checkResults.length} righe</span>
            <span>{simulationCandidates.length} pronte</span>
            <span>Master pronti: {masterReadyCount}</span>
            {availableDonors !== null && <span>Master disponibili: {availableDonors}</span>}
          </div>
        </div>

        {checkResults.length === 0 ? (
          <p className="text-sm text-gray-500">Nessun controllo eseguito.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 uppercase">
                  <th className="px-2 py-1">Email</th>
                  <th className="px-2 py-1">Cognome</th>
                  <th className="px-2 py-1">Nome</th>
                  <th className="px-2 py-1">Utente</th>
                  <th className="px-2 py-1">Corso</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Iscrizione</th>
                  <th className="px-2 py-1">Completamento</th>
                  <th className="px-2 py-1">Master utente</th>
                  <th className="px-2 py-1">Master corso</th>
                  <th className="px-2 py-1">Master iscrizione</th>
                  <th className="px-2 py-1">Master completamento</th>
                  <th className="px-2 py-1">Candidati vicini</th>
                  <th className="px-2 py-1">Note</th>
                </tr>
              </thead>
              <tbody>
                {checkResults.map((row, index) => {
                  const masterName = [row.master?.firstname, row.master?.lastname]
                    .filter(Boolean)
                    .join(" ");
                  const masterCourseLabel = row.master?.course_code ?? "—";
                  return (
                    <tr
                      key={`check-${index}`}
                      className={`border-t ${row.hasMaster ? "bg-emerald-50" : ""}`}
                    >
                      <td className="px-2 py-1 font-mono text-[11px]">{row.email ?? "—"}</td>
                      <td className="px-2 py-1 text-gray-700">{row.lastname ?? "—"}</td>
                      <td className="px-2 py-1 text-gray-700">{row.firstname ?? "—"}</td>
                      <td className="px-2 py-1 text-gray-700 space-y-1">
                        <div>{row.userid ?? row.id ?? "—"}</div>
                        {row.id && (
                          <div className="text-[10px] text-gray-500">ID {row.id}</div>
                        )}
                        {row.hasMaster && (
                          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                            Master pronto
                          </span>
                        )}
                        {!row.hasMaster && row.registered && row.status === 0 && (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            Master mancante
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 font-mono text-[11px]">
                        <div>{row.course_code ?? "—"}</div>
                        <div className="text-[10px] text-gray-500">{row.course_name ?? ""}</div>
                      </td>
                      <td className="px-2 py-1 text-sm font-semibold">
                        {row.status !== null ? row.status : "—"}
                      </td>
                      <td className="px-2 py-1">{row.date_inscr ?? "—"}</td>
                      <td className="px-2 py-1">{row.date_complete ?? "—"}</td>
                      <td className="px-2 py-1 space-y-0.5">
                        {row.master ? (
                          <>
                            <div className="font-semibold text-[12px]">
                              {row.master.userid ?? "—"}
                            </div>
                            <div className="text-[10px] text-gray-500">{masterName}</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-1 space-y-0.5">
                        <div>{masterCourseLabel}</div>
                        <div className="text-[10px] text-gray-500">
                          {row.master?.course_name ?? ""}
                        </div>
                      </td>
                      <td className="px-2 py-1">{row.master?.date_inscr ?? "—"}</td>
                      <td className="px-2 py-1">{row.master?.date_complete ?? "—"}</td>
                      <td className="px-2 py-1 text-[11px] space-y-1">
                        {row.nearCandidates && row.nearCandidates.length ? (
                          row.nearCandidates.map((candidate) => {
                            const label = formatOffsetLabel(candidate.offset);
                            return (
                              <div key={`near-${row.id}-${candidate.offset}`}>
                                <span className="font-semibold text-[11px] text-emerald-700">
                                  {label}
                                </span>
                                <span className="text-[11px]">
                                  {candidate.master?.userid ?? "—"}{" "}
                                  <span className="text-[10px] text-gray-500">
                                    ({candidate.master?.date_inscr ?? "—"})
                                  </span>
                                </span>
                              </div>
                            );
                          })
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex flex-col gap-1 text-[11px] text-gray-700">
                          <span>{row.note ?? "—"}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-white shadow rounded p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Log simulazione</h2>
          <span className="text-xs text-gray-500">
            {simulationResults.length} risultati
          </span>
        </div>

        {simulationResults.length === 0 ? (
          <p className="text-sm text-gray-500">Nessuna simulazione eseguita.</p>
        ) : (
          <div className="space-y-3">
            {simulationResults.map((item) => (
              <div
                key={item.targetUserId}
                className="border rounded p-3 bg-slate-50 text-sm flex flex-col gap-1"
              >
                <div className="flex justify-between items-center">
                  <span className="font-semibold">Utente {item.targetUserId}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      item.success ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                    }`}
                  >
                    {item.success ? "Successo" : "Errore"}
                  </span>
                </div>
                <ul className="list-disc pl-4 space-y-1 text-[13px] text-gray-600">
                  {item.log.map((line, index) => (
                    <li key={`${item.targetUserId}-${index}`}>{line}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
