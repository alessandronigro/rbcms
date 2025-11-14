import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useConv } from "@/context/ConvContext";
import TableLoader from "@/components/TableLoader";

type Row = {
  id: number;
  iduser: number;
  idcourse: number;
  last_name: string;
  first_name: string;
  email: string;
  cf?: string;
  percent: number;
  date_inscr?: string | null;
  date_complete?: string | null;
  stato?: string;
  source_db: string;
};

type Course = { id: string; label: string };

function fmtDate(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => (n < 10 ? "0" + n : n);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function StatusBadge({ stato, percent }: { stato?: string; percent: number }) {
  let txt = stato || "";
  const cls =
    percent >= 100
      ? "bg-green-100 text-green-700"
      : percent === 0
        ? "bg-red-100 text-red-700"
        : "bg-yellow-100 text-yellow-700";

  if (!txt) {
    if (percent >= 100) txt = "Completato";
    else if (percent === 0) txt = "Iscritto";
    else txt = "In corso";
  }

  return (
    <span className={`px-2 py-[2px] rounded text-xs font-semibold ${cls}`}>
      {txt}
    </span>
  );
}

export default function ReportConvenzione() {
  const today = new Date().toISOString().slice(0, 10);

  const [periodType, setPeriodType] = useState("all");
  const [from, setFrom] = useState("2000-01-01");
  const [to, setTo] = useState(today);


  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("[-]");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [slowMessage, setSlowMessage] = useState(false);
  const [q, setQ] = useState("");

  const [filterStato, setFilterStato] = useState("tutti");
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);

  const loadingRef = useRef(false);
  const { conv: me } = useConv();
  const nav = useNavigate();


  useEffect(() => {
    if (periodType === "all") {
      setFrom("2000-01-01");
      setTo(today);
    }
    if (periodType === "today") {
      setFrom(today);
      setTo(today);
    }
    if (periodType === "7days") {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      setFrom(d.toISOString().slice(0, 10));
      setTo(today);
    }
    if (periodType === "30days") {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      setFrom(d.toISOString().slice(0, 10));
      setTo(today);
    }
  }, [periodType]);


  // Controllo autenticazione
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.authenticated) nav("/login");
      })
      .catch(() => nav("/login"));
  }, [nav]);

  const loadCourses = async () => {
    if (!me) return;
    try {
      const qs = new URLSearchParams({
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: new Date(`${to}T23:59:59`).toISOString(),
        db: me?.piattaforma,
      });

      const res = await fetch(`/api/report/convenzione/corsi?${qs.toString()}`, {
        credentials: "include",
      });
      const j = await res.json();

      const mapped: Course[] = (j.rows || []).map((c: any) => ({
        id: c.idcourse,
        label: c.label,
      }));

      setCourses(mapped);
    } catch {
      setCourses([]);
    }
  };

  const loadData = async () => {
    if (courseId === "[-]" || !me) {
      setRows([]);
      return;
    }

    setLoading(true);
    loadingRef.current = true;
    setSlowMessage(false);

    const slowTimer = setTimeout(() => {
      if (loadingRef.current) setSlowMessage(true);
    }, 10000);

    try {
      const qs = new URLSearchParams({
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: new Date(`${to}T23:59:59`).toISOString(),
        idcourse: courseId,
        db: me?.piattaforma,
      });

      const res = await fetch(`/api/report/convenzione?${qs.toString()}`, {
        credentials: "include",
      });
      const j = await res.json();
      setRows(j.rows || []);
    } catch {
      setRows([]);
    } finally {
      clearTimeout(slowTimer);
      loadingRef.current = false;
      setLoading(false);
      setSlowMessage(false);
    }
  };

  useEffect(() => {
    if (!me) return;
    loadCourses();
  }, [from, to, me]);

  const requestSort = (key: string) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const statoOrderMap: Record<string, number> = {
    Completato: 1,
    "In corso": 2,
    Iscritto: 3,
  };

  const getStatoNormalized = (r: Row) => {
    if (r.percent >= 100) return "Completato";
    if (r.percent === 0) return "Iscritto";
    return "In corso";
  };

  const sortedRows = useMemo(() => {
    let sortable = [...rows];

    if (filterStato !== "tutti") {
      sortable = sortable.filter((r) => getStatoNormalized(r).toLowerCase() === filterStato);
    }

    if (q.trim()) {
      const t = q.toLowerCase();
      sortable = sortable.filter((r) =>
        [
          r.last_name,
          r.first_name,
          r.email,
          r.cf,
          r.stato,
          r.percent?.toString(),
          fmtDate(r.date_inscr),
          fmtDate(r.date_complete),
        ]
          .join(" ")
          .toLowerCase()
          .includes(t)
      );
    }

    if (sortConfig !== null) {
      sortable.sort((a, b) => {
        const key = sortConfig.key;
        let valA: any = a[key as keyof Row];
        let valB: any = b[key as keyof Row];

        if (key === "stato") {
          valA = statoOrderMap[getStatoNormalized(a)];
          valB = statoOrderMap[getStatoNormalized(b)];
        }

        if (key === "date_inscr" || key === "date_complete") {
          valA = valA ? new Date(valA).getTime() : 0;
          valB = valB ? new Date(valB).getTime() : 0;
        }

        if (typeof valA === "string") valA = valA.toLowerCase();
        if (typeof valB === "string") valB = valB.toLowerCase();

        if (valA < valB) return sortConfig.direction === "asc" ? -1 : 1;
        if (valA > valB) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return sortable;
  }, [rows, q, filterStato, sortConfig]);

  const sortArrow = (key: string) => {
    if (!sortConfig || sortConfig.key !== key) return "↕️";
    return sortConfig.direction === "asc" ? "↑" : "↓";
  };

  const exportCSV = () => {
    const header = [
      "Cognome",
      "Nome",
      "Email",
      "CF",
      "Stato",
      "%",
      "Data iscrizione",
      "Data completamento",
    ];
    const lines = [header.join(";")];
    sortedRows.forEach((r) =>
      lines.push(
        [
          r.last_name,
          r.first_name,
          r.email,
          r.cf ?? "",
          getStatoNormalized(r),
          r.percent,
          fmtDate(r.date_inscr),
          fmtDate(r.date_complete),
        ].join(";")
      )
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGetTime = async (r: Row) => {
    try {
      setLoadingId(r.id);
      const qs = new URLSearchParams({
        db: r.source_db || "forma4",
        iduser: String(r.iduser),
        idcourse: String(r.idcourse),
        nome: r.first_name,
        cognome: r.last_name,
      });
      const res = await fetch(`/api/corsi/gettime?${qs.toString()}`, {
        credentials: "include",
      });

      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank");
    } finally {
      setTimeout(() => setLoadingId(null), 300);
    }
  };

  const handleGetLastTest = async (r: Row) => {
    try {
      setLoadingId(r.id);
      const qs = new URLSearchParams({
        db: r.source_db || "forma4",
        iduser: String(r.iduser),
        idcourse: String(r.idcourse),
        firstname: r.first_name,
        lastname: r.last_name,
      });
      const res = await fetch(`/api/corsi/getlasttest?${qs.toString()}`, {
        credentials: "include",
      });

      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank");
    } finally {
      setTimeout(() => setLoadingId(null), 300);
    }
  };

  const handleGeneraAttestato = async (r: Row) => {
    try {
      setLoadingId(r.id);
      const res = await fetch("/api/attestati/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          iduser: r.iduser,
          idcorso: r.idcourse,
          webdb: r.source_db,
        }),
      });

      const j = await res.json();
      if (j.success && j.file) window.open(j.file, "_blank");
      else alert(j.error || "Errore generazione attestato");
    } finally {
      setTimeout(() => setLoadingId(null), 300);
    }
  };

  if (!me)
    return <div className="p-6 text-center text-gray-500">Caricamento convenzione…</div>;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg sm:text-xl font-semibold">Report Convenzione</h1>

      {/* FILTRI */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 bg-white p-4 rounded shadow-sm">

        {/* 🕒 PERIODO */}
        <div className="col-span-1 space-y-2">
          <label className="block font-semibold text-gray-700">Periodo</label>

          <div className="flex flex-wrap gap-2">
            {[
              { id: "all", label: "Tutto" },
              { id: "today", label: "Oggi" },
              { id: "7days", label: "Ultimi 7 giorni" },
              { id: "30days", label: "Ultimi 30 giorni" },
              { id: "custom", label: "Personalizzato" },
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => setPeriodType(btn.id)}
                className={`px-3 py-1 rounded border text-sm transition ${periodType === btn.id ? "bg-blue-600 text-white" : "bg-white hover:bg-gray-100"
                  }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {periodType === "custom" && (
            <div className="flex gap-2 pt-2">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="border px-2 py-1 rounded w-full"
              />
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border px-2 py-1 rounded w-full"
              />
            </div>
          )}
        </div>

        {/* 📘 CORSO */}
        <div className="col-span-1">
          <label className="block font-semibold text-gray-700 mb-1">Corso</label>
          <select
            className="border rounded px-3 py-2 w-full bg-white"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
          >
            <option value="[-]">Seleziona…</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* 🟡 STATO */}
        <div className="col-span-1">
          <label className="block font-semibold text-gray-700 mb-1">Stato</label>
          <select
            className="border rounded px-3 py-2 w-full bg-white"
            value={filterStato}
            onChange={(e) => setFilterStato(e.target.value)}
          >
            <option value="tutti">Tutti</option>
            <option value="completato">Completato</option>
            <option value="in corso">In corso</option>
            <option value="iscritto">Iscritto</option>
          </select>
        </div>

        {/* 🔍 CERCA */}
        <div className="col-span-1">
          <label className="block font-semibold text-gray-700 mb-1">Cerca</label>
          <input
            type="text"
            className="border rounded px-3 py-2 w-full"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nome, email, CF..."
          />
        </div>

      </div>
      {/* BUTTONS */}
      <div className="flex gap-2">
        <button onClick={loadData} disabled={courseId === "[-]"} className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50">
          Elabora
        </button>

        <button onClick={exportCSV} disabled={!sortedRows.length} className="px-3 py-1 bg-green-600 text-white rounded disabled:opacity-50">
          CSV
        </button>

        {slowMessage && loading && (
          <div className="text-orange-600 mt-2 text-sm">
            ⏳ L’elaborazione sta richiedendo più tempo del previsto…<br />
            Stiamo analizzando i dati storici (2018–2024). Questo può richiedere anche alcuni minuti.
          </div>
        )}
      </div>

      {/* SPINNER */}
      {loading && (
        <div className="flex justify-center py-10">
          <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full"></div>
        </div>
      )}

      {/* TABELLA */}
      <div className="overflow-x-auto border rounded">
        {!loading && sortedRows.length > 0 && (
          <div className="text-sm font-medium py-2">Totale utenti trovati: {sortedRows.length}</div>
        )}

        <table className="w-full text-sm min-w-[950px]">
          <thead className="bg-gray-100 text-gray-700 sticky top-0">
            <tr>
              {[
                { key: "last_name", label: "Cognome" },
                { key: "first_name", label: "Nome" },
                { key: "email", label: "Email" },
                { key: "cf", label: "CF" },
                { key: "stato", label: "Stato" },
                { key: "percent", label: "%" },
                { key: "date_inscr", label: "Inscr." },
                { key: "date_complete", label: "Compl." },
              ].map((col) => (
                <th key={col.key} onClick={() => requestSort(col.key)} className="p-2 text-left cursor-pointer select-none">
                  {col.label} {sortArrow(col.key)}
                </th>
              ))}

              <th className="p-2 text-center w-[180px]">Azioni</th>
            </tr>
          </thead>

          <tbody>
            {loading && <TableLoader colSpan={9} size={30} />}

            {!loading && sortedRows.length === 0 && (
              <tr>
                <td colSpan={9} className="p-4 text-center text-gray-500">
                  Nessun risultato
                </td>
              </tr>
            )}

            {!loading &&
              sortedRows.map((r) => (
                <tr key={`${r.source_db}-${r.iduser}-${r.idcourse}`} className="border-t hover:bg-gray-50">
                  <td className="p-2">{r.last_name}</td>
                  <td className="p-2">{r.first_name}</td>
                  <td className="p-2">{r.email}</td>
                  <td className="p-2">{r.cf}</td>
                  <td className="p-2">
                    <StatusBadge stato={r.stato} percent={r.percent} />
                  </td>
                  <td className="p-2 text-right">{r.percent}</td>
                  <td className="p-2">{fmtDate(r.date_inscr)}</td>
                  <td className="p-2">{fmtDate(r.date_complete)}</td>

                  <td className="p-2 flex gap-2 justify-center">
                    <button
                      onClick={() => handleGetTime(r)}
                      disabled={loadingId === r.id}
                      title="Report corso"
                      className={`px-2 py-1 rounded text-xs text-white ${loadingId === r.id ? "bg-gray-400" : "bg-blue-500 hover:bg-blue-600"
                        }`}
                    >
                      🕒
                    </button>
                    {r.percent >= 100 && (
                      <>
                        <button
                          onClick={() => handleGetLastTest(r)}
                          disabled={loadingId === r.id}
                          title="Test finale"
                          className={`px-2 py-1 rounded text-xs text-white ${loadingId === r.id ? "bg-gray-400" : "bg-orange-500 hover:bg-orange-600"
                            }`}
                        >
                          🧾
                        </button>

                        <button
                          onClick={() => handleGeneraAttestato(r)}
                          disabled={loadingId === r.id}
                          title="Genera attestato"
                          className={`px-2 py-1 rounded text-xs text-white ${loadingId === r.id ? "bg-gray-400" : "bg-green-600 hover:bg-green-700"
                            }`}
                        >
                          🪪
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}