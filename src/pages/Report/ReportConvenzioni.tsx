import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";

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
  const today = new Date();
  const fromDefault = new Date(today);
  fromDefault.setDate(today.getDate() - 30);

  const [from, setFrom] = useState<string>(
    fromDefault.toISOString().slice(0, 10),
  );
  const [to, setTo] = useState<string>(today.toISOString().slice(0, 10));
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("[-]");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  const [setMe] = useState<any>(null);
  const nav = useNavigate();

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => setMe(j.conv ?? null))
      .catch(() => nav("/login"));
  }, [nav]);

  const fmtDT = fmtDate;



  const loadCourses = async () => {
    try {
      const qs = new URLSearchParams({
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: new Date(`${to}T23:59:59`).toISOString(),
      });
      const res = await fetch(
        `/api/report/convenzione/corsi?${qs.toString()}`,
        {
          credentials: "include",
        },
      );
      const j = await res.json();
      const mapped: Course[] = (j.rows || []).map((c: any) => ({
        id: String(c.idcourse),
        label: `${c.code} ${c.name}`.trim(),
      }));
      setCourses(mapped);
    } catch {
      setCourses([]);
    }
  };

  const loadData = async () => {
    if (courseId === "[-]") {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: new Date(`${to}T23:59:59`).toISOString(),
        idcourse: courseId,
      });
      const res = await fetch(`/api/report/convenzione?${qs.toString()}`, {
        credentials: "include",
      });
      const j = await res.json();
      setRows(j.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCourses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const term = q.toLowerCase();
    return rows.filter((r) =>
      [
        r.last_name,
        r.first_name,
        r.email,
        r.cf,
        r.stato,
        r.percent?.toString(),
        fmtDT(r.date_inscr),
        fmtDT(r.date_complete),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [rows, q, fmtDT]);

  const exportCSV = () => {
    const header = [
      "Cognome",
      "Nome",
      "Email",
      "CF",
      "Stato",
      "%",
      "Data iscr.",
      "Data compl.",
    ];
    const lines = [header.join(";")];
    filtered.forEach((r) =>
      lines.push(
        [
          r.last_name,
          r.first_name,
          r.email,
          r.cf ?? "",
          r.stato,
          r.percent,
          fmtDT(r.date_inscr),
          fmtDT(r.date_complete),
        ].join(";"),
      ),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* ✅ HEADER MINIMALE AREA REPORT */}

      {/* ✅ CONTENUTO */}
      <div className="p-4 space-y-4">
        <h1 className="text-lg sm:text-xl font-semibold">Report Convenzione</h1>

        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div>
            <label className="block text-sm font-medium">Dal</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border rounded px-2 py-1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Al</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border rounded px-2 py-1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Corso</label>
            <select
              className="border rounded px-2 py-1 min-w-[240px]"
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

          <div className="sm:ml-auto">
            <label className="block text-sm font-medium">Cerca</label>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="border rounded px-2 py-1"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={loadData}
            disabled={courseId === "[-]"}
            className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
          >
            Elabora
          </button>
          <button
            onClick={exportCSV}
            disabled={!filtered.length}
            className="px-3 py-1 bg-green-600 text-white rounded disabled:opacity-50"
          >
            CSV
          </button>
        </div>

        {/* TABLE */}
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-gray-100 text-gray-700 sticky top-0">
              <tr>
                <th className="p-2 text-left">Cognome</th>
                <th className="p-2 text-left">Nome</th>
                <th className="p-2 text-left">Email</th>
                <th className="p-2 text-left">CF</th>
                <th className="p-2 text-left">Stato</th>
                <th className="p-2 text-right">%</th>
                <th className="p-2">Inscr.</th>
                <th className="p-2">Compl.</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="p-4 text-center text-gray-500">
                    Caricamento…
                  </td>
                </tr>
              )}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-4 text-center text-gray-500">
                    Nessun risultato
                  </td>
                </tr>
              )}

              {!loading &&
                filtered.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-gray-50">
                    <td className="p-2">{r.last_name}</td>
                    <td className="p-2">{r.first_name}</td>
                    <td className="p-2">{r.email}</td>
                    <td className="p-2">{r.cf}</td>
                    <td className="p-2">
                      <StatusBadge stato={r.stato} percent={r.percent} />
                    </td>
                    <td className="p-2 text-right">{r.percent}</td>
                    <td className="p-2">{fmtDT(r.date_inscr)}</td>
                    <td className="p-2">{fmtDT(r.date_complete)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
