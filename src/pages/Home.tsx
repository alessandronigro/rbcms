import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface ChartRow {
  mese_num: number;
  month: string;
  iscritti: number;
  itinere: number;
  completati: number;
}

interface DeadlineStat {
  key: string;
  label: string;
  count: number;
}

interface DailyLoginRow {
  day: string;
  label: string;
  count: number;
}

interface Stats {
  success: boolean;
  scadenze: number;
  chart: ChartRow[];
  deadlines?: DeadlineStat[];
  dailyLogins?: DailyLoginRow[];
  dailyLoginsMonth?: {
    month: number;
    year: number;
  };
  activeLast10?: number;
}

interface ConnectionPoolStat {
  key: string;
  host?: string;
  database?: string;
  total: number;
  free: number;
  active: number;
  queue: number;
  processListTotal: number;
  processListActive: number;
  processListSleeping: number;
  longestRunningSeconds: number;
}

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [mese, setMese] = useState("");
  const [db, setDb] = useState("forma4"); // ✅ default database
  const [connectionStats, setConnectionStats] = useState<ConnectionPoolStat[]>([]);
  const [connLoading, setConnLoading] = useState(true);

  const mesiLabel = [
    "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
    "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"
  ];

  const loadStats = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/stats?mese=${mese || ""}&db=${db}`,
        { credentials: "include" }
      );
      const json = await res.json();
      if (json.success) setStats(json);
      else console.error("⚠️ Errore API:", json.error);
    } catch (err) {
      console.error("❌ Errore loadStats:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadConnectionStats = async () => {
    setConnLoading(true);
    try {
      const res = await fetch("/api/monitor/mysql/connections", { credentials: "include" });
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setConnectionStats(data.data);
      } else {
        console.warn("⚠️ Errore fetch connessioni MySQL:", data.error || "<nessun dato>");
      }
    } catch (err) {
      console.error("❌ Errore loadConnectionStats:", err);
    } finally {
      setConnLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, [mese, db]);

  useEffect(() => {
    loadConnectionStats();
    const interval = setInterval(loadConnectionStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const connectionSummary = useMemo(() => {
    if (!connectionStats.length) return null;
    const totalActive = connectionStats.reduce((sum, pool) => sum + pool.active, 0);
    const totalFree = connectionStats.reduce((sum, pool) => sum + pool.free, 0);
    const totalQueue = connectionStats.reduce((sum, pool) => sum + pool.queue, 0);
    const totalProcessList = connectionStats.reduce(
      (sum, pool) => sum + (pool.processListTotal || 0),
      0,
    );
    const totalActiveProcessList = connectionStats.reduce(
      (sum, pool) => sum + (pool.processListActive || 0),
      0,
    );
    return {
      totalActive,
      totalFree,
      totalQueue,
      totalProcessList,
      totalActiveProcessList,
    };
  }, [connectionStats]);

  {/* SPINNER */ }
  {
    loading && (
      <div className="flex justify-center py-10">
        <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full"></div>
      </div>
    )
  }
  if (!stats) return <div className="p-6 text-red-500">❌ Nessun dato disponibile</div>;

  // ✅ FIX: copia l’array prima di ordinare
  const chartData = Array.isArray(stats.chart)
    ? [...stats.chart].sort((a, b) => a.mese_num - b.mese_num)
    : [];
  const deadlineCourses = Array.isArray(stats.deadlines) ? stats.deadlines : [];
  const dailyLogins = Array.isArray(stats.dailyLogins) ? stats.dailyLogins : [];
  const dailyLoginsMonth = stats.dailyLoginsMonth;
  const activeLast10 = typeof stats.activeLast10 === "number" ? stats.activeLast10 : 0;
  const dailyLoginsMonthLabel =
    dailyLoginsMonth && dailyLoginsMonth.month >= 1 && dailyLoginsMonth.month <= 12
      ? `${mesiLabel[dailyLoginsMonth.month - 1]} ${dailyLoginsMonth.year}`
      : "";
  const dailyLoginsInterval =
    dailyLogins.length > 15 ? Math.ceil(dailyLogins.length / 12) : 0;

  const grafico = (dataKey: keyof ChartRow, color: string, titolo: string) => (
    <div className="bg-white shadow rounded p-4">
      <h2 className="font-semibold mb-2">{titolo}</h2>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.8} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="month" />
          <YAxis />
          <Tooltip />
          <CartesianGrid strokeDasharray="3 3" />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            fill={`url(#grad-${dataKey})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header e filtri */}
      <div className="flex flex-wrap justify-between gap-3 items-center">
        <h1 className="text-2xl font-semibold">Dashboard Amministratore</h1>

        <div className="flex gap-2">
          <select
            className="border px-2 py-1 rounded"
            value={db}
            onChange={(e) => setDb(e.target.value)}
          >
            <option value="forma4">Piattaforma 2025 (Forma4)</option>
            <option value="newformazionein">Piattaforma 2018–24</option>
            <option value="formazionecondorb">Piattaforma 2011–2018</option>
            <option value="simplybiz">Simplybiz</option>
            <option value="efadnovastudia">Nova Studia</option>
          </select>

          <select
            className="border px-2 py-1 rounded"
            value={mese}
            onChange={(e) => setMese(e.target.value)}
          >
            <option value="">Tutti i mesi</option>
            {mesiLabel.map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 🔔 Scadenze */}
      <div className="p-4 bg-red-100 text-red-700 rounded shadow">
        📌 Ci sono <b>{stats.scadenze}</b> corsisti in scadenza entro fine anno!
        <Link className="underline ml-2" to="/utenti">Vai alla lista →</Link>
      </div>
      <div className="p-4 bg-sky-100 text-sky-800 rounded shadow flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-2xl">👥</span>
          <div>
            <p className="text-sm uppercase tracking-wide text-sky-700">Attivi ora</p>
            <p className="text-lg md:text-2xl font-semibold text-sky-900">
              {activeLast10} utenti negli ultimi 10 minuti
            </p>
          </div>
        </div>
        <p className="text-sm text-sky-700">
          Conteggio basato su <code>core_user.lastenter</code> e attività recenti in <code>learning_tracksession</code>.
        </p>
      </div>
      {connectionSummary && (
        <div className="bg-white shadow rounded p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Connessioni MySQL</p>
              <p className="text-xl font-semibold text-slate-800">
                {connectionSummary.totalActive} attive · {connectionSummary.totalFree} libere
              </p>
              <p className="text-sm text-slate-500 mt-1">
                Processlist: {connectionSummary.totalActiveProcessList}/{connectionSummary.totalProcessList}
              </p>
            </div>
            {connLoading ? (
              <span className="text-sm text-slate-500">Aggiornamento…</span>
            ) : (
              <span className="text-sm text-slate-500">
                {connectionSummary.totalQueue} in coda
              </span>
            )}
          </div>
          <div className="border-t border-slate-200 pt-2 space-y-2">
            {connLoading ? (
              <div className="text-sm text-slate-500">Caricamento dati connessioni...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {connectionStats.map((pool) => (
                  <div
                    key={pool.key}
                    className="border border-slate-200 rounded p-3 bg-slate-50"
                  >
                    <div className="text-sm text-slate-600 truncate">
                      {pool.host} · {pool.database}
                    </div>
                    <div className="flex flex-wrap text-xs text-slate-600 mt-1 gap-2">
                      <span>Totali: {pool.total}</span>
                      <span>Attive: {pool.active}</span>
                      <span>Queue: {pool.queue}</span>
                      <span>Processi: {pool.processListActive}/{pool.processListTotal}</span>
                      <span>Sleep: {pool.processListSleeping}</span>
                      <span>Max sec: {pool.longestRunningSeconds}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 🎯 Corsi OAM / IVASS con deadline 31/12 */}
      {deadlineCourses.length > 0 && (
        <div className="bg-white shadow rounded p-4 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold">Monitor corsi OAM / IVASS</h2>
              <p className="text-sm text-gray-500">
                Storico corsisti che non hanno completato entro il 31/12.
              </p>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {deadlineCourses.map((course) => (
              <div
                key={course.key}
                className="border border-slate-200 rounded-lg p-3 bg-slate-50"
              >
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  {course.label}
                </p>
                <p className="text-3xl font-bold text-slate-900">{course.count}</p>
                <p className="text-xs text-slate-500 mt-1">
                  non completati entro la scadenza
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {dailyLogins.length > 0 && (
        <div className="bg-white shadow rounded p-4 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold">Accessi giornalieri</h2>
              <p className="text-sm text-gray-500">
                Utenti distinti che hanno effettuato l’accesso in ogni giorno del mese
                selezionato (default: mese corrente).
              </p>
            </div>
            {dailyLoginsMonthLabel && (
              <span className="text-sm text-gray-500">
                Mese mostrato: <b>{dailyLoginsMonthLabel}</b>
              </span>
            )}
          </div>
          <div className="w-full">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={dailyLogins}>
                <defs>
                  <linearGradient id="grad-daily-logins" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" interval={dailyLoginsInterval} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <CartesianGrid strokeDasharray="3 3" />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#0ea5e9"
                  fill="url(#grad-daily-logins)"
                  name="Utenti"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="max-h-64 overflow-y-auto border border-slate-200 rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="px-3 py-2 font-semibold text-slate-600">Giorno</th>
                  <th className="px-3 py-2 font-semibold text-slate-600 text-right">
                    Utenti collegati
                  </th>
                </tr>
              </thead>
              <tbody>
                {dailyLogins.map((row) => (
                  <tr key={row.day} className="border-t border-slate-200">
                    <td className="px-3 py-1.5">{row.label}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">
                      {row.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 📈 Grafici */}
      <div className="grid md:grid-cols-3 gap-4">
        {grafico("iscritti", "#2563eb", "Iscritti")}
        {grafico("itinere", "#f59e0b", "In itinere")}
        {grafico("completati", "#16a34a", "Completati")}
      </div>
    </div>
  );
}
