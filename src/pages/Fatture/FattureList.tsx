import React, { useEffect, useMemo, useState } from "react";

type Which = "ricevute" | "ricevutenew";

interface Row {
    id: number;
    tipodocumento: string;
    sistemainterscambio: string;
    dataemissionefattura: string;
    numerofattura: string;
    intestatario: string;
    imponibile: number;
    IVA: number;
    importofattura: number;
    readfatt: 0 | 1;
    xml?: string;
    html_file?: string;
    nomeattachment?: string;
    folder: string;
    fatturaxml?: string;
    fatturapdf?: string;

}

export default function FattureList({ which }: { which: Which }) {
    const [month, setMonth] = useState<string>(new Date().toISOString().slice(5, 7));
    const [year, setYear] = useState<string>(new Date().getFullYear().toString());
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(false);
    const [meta, setMeta] = useState<{ total?: number } | null>(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/fatture/${which}?month=${month}&year=${year}`);
            const j = await res.json();
            setRows(j.rows || []);
            setMeta({ total: j.total ?? j.rows?.length });
        } catch (e) {
            console.error(e);
            setRows([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [which]);

    const fmtDate = (v?: string) => {
        if (!v) return "";
        const d = new Date(v);
        const pad = (n: number) => (n < 10 ? "0" + n : n);
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    };

    const totale = useMemo(() => {
        return rows.reduce((s, r) => s + (Number(r.importofattura) || 0), 0);
    }, [rows]);

    const markRead = async (id: number) => {
        await fetch(`/api/fatture/${which}/${id}/read`, { method: "PATCH" });
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, readfatt: 1 } : r)));
    };

    const exportZip = async () => {
        const body = { month, year };
        const res = await fetch(`/api/fatture/${which}/zip`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const j = await res.json();
        if (j.zip_url) window.open(j.zip_url, "_blank");
        else alert(j.error || "Errore generazione ZIP");
    };

    return (
        <div className="p-4 space-y-4">
            {/* FILTRI */}
            <div className="flex flex-wrap items-end gap-3">
                <div>
                    <label className="block text-xs font-medium">Mese</label>
                    <select className="border rounded px-2 py-1" value={month} onChange={(e) => setMonth(e.target.value)}>
                        {Array.from({ length: 12 }).map((_, i) => {
                            const m = String(i + 1).padStart(2, "0");
                            return <option key={m} value={m}>{m}</option>;
                        })}
                    </select>
                </div>

                <div>
                    <label className="block text-xs font-medium">Anno</label>
                    <select className="border rounded px-2 py-1" value={year} onChange={(e) => setYear(e.target.value)}>
                        {Array.from({ length: 7 }).map((_, i) => {
                            const y = (new Date().getFullYear() - i).toString();
                            return <option key={y} value={y}>{y}</option>;
                        })}
                    </select>
                </div>

                <button onClick={fetchData} className="px-3 py-1 bg-blue-600 text-white rounded h-9">
                    Cerca
                </button>

                <button onClick={exportZip} className="px-3 py-1 bg-green-600 text-white rounded h-9">
                    Esporta ZIP mese
                </button>

                <div className="ml-auto text-sm font-medium text-gray-600">
                    {loading
                        ? "Caricamento..."
                        : `${meta?.total ?? rows.length} righe — Tot: ${totale.toLocaleString("it-IT", {
                            style: "currency",
                            currency: "EUR",
                        })
                        }`}
                </div>
            </div>

            {/* TABELLA */}
            <div className="overflow-x-auto border rounded">
                <table className="min-w-[1100px] w-full text-sm">
                    <thead className="bg-gray-100 text-gray-600">
                        <tr>
                            <th className="p-2 w-14"></th>
                            <th className="p-2">Data SDI</th>
                            <th className="p-2">Data Emissione</th>
                            <th className="p-2">Tipo Doc</th>
                            <th className="p-2">N°</th>
                            <th className="p-2">Cliente</th>
                            <th className="p-2 text-right">Imponibile</th>
                            <th className="p-2 text-right">IVA</th>
                            <th className="p-2 text-right">Totale</th>
                            <th className="p-2">Allegati</th>
                            <th className="p-2">XML</th>
                            <th className="p-2">HTML</th>
                        </tr>
                    </thead>

                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.id} className={`border-t ${r.readfatt ? "text-gray-700" : "font-semibold"}`}>
                                <td className="p-2">
                                    {r.readfatt ? (
                                        <span className="text-green-600">●</span>
                                    ) : (
                                        <button
                                            onClick={() => markRead(r.id)}
                                            className="px-2 py-0.5 text-xs bg-yellow-400 text-white rounded"
                                        >
                                            Segna letta
                                        </button>
                                    )}
                                </td>

                                <td className="p-2">{fmtDate(r.sistemainterscambio)}</td>
                                <td className="p-2">{fmtDate(r.dataemissionefattura)}</td>
                                <td className="p-2">{r.tipodocumento}</td>
                                <td className="p-2">{r.numerofattura}</td>
                                <td className="p-2">{r.intestatario}</td>

                                <td className="p-2 text-right">{r.imponibile?.toLocaleString("it-IT")}</td>
                                <td className="p-2 text-right">{r.IVA?.toLocaleString("it-IT")}</td>
                                <td className="p-2 text-right">{r.importofattura?.toLocaleString("it-IT")}</td>

                                {/* 🔹 Allegati */}
                                <td className="p-2">
                                    {r.nomeattachment ? (
                                        <div dangerouslySetInnerHTML={{ __html: r.nomeattachment }} />
                                    ) : "-"}
                                </td>

                                {/* 🔹 XML */}
                                <td className="p-2">
                                    {r.fatturaxml ? (
                                        <div dangerouslySetInnerHTML={{ __html: r.fatturaxml }} />
                                    ) : "-"}
                                </td>

                                {/* 🔹 HTML */}
                                <td className="p-2">
                                    {r.fatturapdf ? (
                                        <div dangerouslySetInnerHTML={{ __html: r.fatturapdf }} />
                                    ) : "-"}
                                </td>
                            </tr>
                        ))}

                        {!loading && rows.length === 0 && (
                            <tr>
                                <td className="p-4 text-center text-gray-500" colSpan={12}>
                                    Nessun risultato per {month}/{year}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}