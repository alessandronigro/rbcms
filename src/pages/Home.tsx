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

interface ChartRow {
  mese_num: number;
  month: string;
  iscritti: number;
  itinere: number;
  completati: number;
}

interface Stats {
  success: boolean;
  scadenze: number;
  chart: ChartRow[];
}

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [mese, setMese] = useState("");
  const [db, setDb] = useState("forma4"); // ✅ default database

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

  useEffect(() => {
    loadStats();
  }, [mese, db]);

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

      {/* 📈 Grafici */}
      <div className="grid md:grid-cols-3 gap-4">
        {grafico("iscritti", "#2563eb", "Iscritti")}
        {grafico("itinere", "#f59e0b", "In itinere")}
        {grafico("completati", "#16a34a", "Completati")}
      </div>
    </div>
  );
}