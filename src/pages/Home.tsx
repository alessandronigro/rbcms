import { useEffect, useState } from "react";
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

interface Stats {
  iscritti: number;
  completati: number;
  corsi: { nome: string; completati: number; totali: number }[];
  ultime: { nome: string; corso: string; data: string }[];
  chart: { month: string; iscritti: number }[];
  scadenze: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState("M3"); // Default: ultimi 3 mesi

  const loadStats = () => {
    setLoading(true);
    fetch(`/api/admin/stats?periodo=${periodo}`, { credentials: "include" })
      .then((r) => r.json())
      .then((j) => setStats(j))
      .finally(() => setLoading(false));
  };

  useEffect(loadStats, [periodo]);

  const exportCSV = () => {
    if (!stats) return;
    const rows = stats.chart.map((r) => `${r.month};${r.iscritti}`).join("\n");
    const blob = new Blob([`Mese;Iscritti\n${rows}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "andamento_iscrizioni.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading || !stats) return <div className="p-6">Caricamento…</div>;

  return (
    <div className="p-4 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Dashboard Admin</h1>

        <select
          className="border px-2 py-1 rounded"
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value)}
        >
          <option value="M1">Ultimo mese</option>
          <option value="M3">Ultimi 3 mesi</option>
          <option value="M6">Ultimi 6 mesi</option>
          <option value="Y1">Ultimo anno</option>
        </select>
      </div>

      {/* 🔔 Notifiche scadenze */}
      <div className="p-4 bg-red-100 text-red-700 rounded shadow">
        📌 Ci sono <b>{stats.scadenze}</b> corsisti in scadenza!
        <Link className="underline ml-2" to="/utenti">
          Vai alla lista →
        </Link>
      </div>

      {/* 📈 Grafico iscrizioni */}
      <div className="bg-white shadow rounded p-4">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-semibold">Andamento iscrizioni</h2>
          <button
            onClick={exportCSV}
            className="px-2 py-1 text-xs bg-blue-600 text-white rounded"
          >
            Export CSV
          </button>
        </div>

        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={stats.chart}>
            <defs>
              <linearGradient id="colorIscr" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip />
            <CartesianGrid strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="iscritti"
              stroke="#2563eb"
              fill="url(#colorIscr)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* 🔹 Bottoni accesso rapido */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Link className="btn-primary" to="/report/statistiche">
          Report Corsi
        </Link>
        <Link className="btn-primary" to="/report/questionari">
          Questionari
        </Link>
        <Link className="btn-primary" to="/utenti">
          Ricerca Utenti
        </Link>
        <Link className="btn-primary" to="/fatture/ricevutenew">
          Fatture Ricevute
        </Link>
      </div>
    </div>
  );
}
