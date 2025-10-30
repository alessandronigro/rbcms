import React, { useEffect, useMemo, useState } from "react";

type Mode = "full" | "free";

type FreeRow = {
    type: "free";
    date_attempt: string;
    id_track: number;
    firstname: string;
    lastname: string;
    email: string;
    coursename: string;
    more_info: string;
    attiva: 0 | 1;
    hostKey: string;
    dbName: string;
};

type FullRow = {
    type: "full";
    date_attempt: string;
    id_track: number;
    firstname: string;
    lastname: string;
    email: string;
    coursename: string;
    detail: {
        id_quest: number;
        title_quest: string;
        answers: { id_answer: number | null; text: string | null; scelta: number | null; more_info: string; attiva: 0 | 1 }[];
    }[];
    hostKey: string;
    dbName: string;
};

type Row = FreeRow | FullRow;

export default function ReportQuestionariA() {
    const [from, setFrom] = useState<string>(() => new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().slice(0, 10));
    const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 10));
    const [idcourse, setIdcourse] = useState<string>("[-]");
    const [convenzione, setConvenzione] = useState<string>(""); // testo libero (nome conv) — opzionale
    const [freeOnly, setFreeOnly] = useState<boolean>(false);

    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [count, setCount] = useState<number>(0);

    // opzionale: dropdown convenzioni già esistente in /api/iscrizioni/convenzioni
    const [convenzioni, setConvenzioni] = useState<{ id: string; nome: string }[]>([]);
    const [corsi, setCorsi] = useState<{ id: string; label: string }[]>([]);

    useEffect(() => {
        fetch("/api/iscrizioni/convenzioni").then(r => r.json()).then((list) => {
            const mapped = (list || []).map((x: any) => ({ id: x.value ?? x.id ?? x.name, nome: x.nome ?? x.name ?? x.label }));
            setConvenzioni(mapped);
        }).catch(() => { });
    }, []);

    // carica corsi quando cambia convenzione
    useEffect(() => {
        if (!convenzione) return;
        // se dal backend hai la forma value="host,db" usa quella per la route
        // altrimenti chiedi solo /api/iscrizioni/corsi?convenzione=nome
        const url = `/api/iscrizioni/corsi?convenzione=${encodeURIComponent(convenzione)}`;
        fetch(url).then(r => r.json()).then((list) => {
            const mapped = (Array.isArray(list) ? list : []).map((c: any) => ({
                id: String(c.idcourse ?? c.id ?? c.code ?? ""),
                label: `${c.code ?? ""} ${c.titolo ?? c.name ?? ""}`.trim(),
            }));
            setCorsi(mapped);
        }).catch(() => setCorsi([]));
    }, [convenzione]);

    const load = async () => {
        setLoading(true);
        try {
            const qs = new URLSearchParams({
                from: new Date(`${from}T00:00:00`).toISOString(),
                to: new Date(`${to}T23:59:59`).toISOString(),
                idcourse,
                convenzione,
                free: String(freeOnly),
            });
            const res = await fetch(`/api/report/questionari?${qs.toString()}`);
            const j = await res.json();
            setRows(j.rows || []);
            setCount(j.total || 0);
        } catch (e) {
            console.error(e);
            setRows([]);
            setCount(0);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fmtDT = (s?: string) => {
        if (!s) return "";
        const d = new Date(s);
        const pad = (n: number) => (n < 10 ? "0" + n : n);
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        // se vuoi solo data: `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`
    };

    const exportCSV = () => {
        const lines: string[] = [];
        if (freeOnly) {
            lines.push(["Data", "Nome", "Cognome", "Email", "Corso", "Risposta libera", "Attiva"].join(";"));
            (rows as FreeRow[]).forEach(r => {
                lines.push([
                    fmtDT(r.date_attempt),
                    r.firstname, r.lastname, r.email,
                    r.coursename,
                    (r.more_info || "").trim(),
                    r.attiva ? "1" : "0"
                ].join(";"));
            });
        } else {
            lines.push(["Data", "Nome", "Cognome", "Email", "Corso", "Domanda", "Risposta", "Scelta", "MoreInfo", "Attiva"].join(";"));
            (rows as FullRow[]).forEach(r => {
                r.detail.forEach(q => {
                    if (q.answers.length === 0) {
                        lines.push([fmtDT(r.date_attempt), r.firstname, r.lastname, r.email, r.coursename, q.title_quest, "", "", "", ""].join(";"));
                    } else {
                        q.answers.forEach(a => {
                            lines.push([
                                fmtDT(r.date_attempt),
                                r.firstname, r.lastname, r.email,
                                r.coursename,
                                q.title_quest,
                                a.text ?? "",
                                a.scelta ?? "",
                                (a.more_info || "").trim(),
                                a.attiva ? "1" : "0",
                            ].join(";"));
                        });
                    }
                });
            });
        }
        const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "questionari.csv"; a.click();
        URL.revokeObjectURL(url);
    };

    const toggleAttiva = async (row: Row, current: 0 | 1) => {
        try {
            const body = {
                id_track: row.id_track,

                attiva: current ? 0 : 1,
                hostKey: row.hostKey,
                dbName: row.dbName,
            };
            console.log(body)
            const res = await fetch("/api/report/questionari/attiva", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error || "Errore update");
            await load();
            // Aggiorna stato in memoria
            setRows(prev =>
                prev.map(r =>
                    r.id_track === row.id_track
                        ? { ...r, attiva: current ? 0 : 1 }
                        : r
                )
            );
        } catch (e) {
            alert((e as Error).message);
        }
    };

    return (
        <div className="p-4 space-y-4">
            <h1 className="text-lg font-semibold">Questionario di gradimento</h1>

            <div className="flex flex-wrap gap-3 items-end">
                <div>
                    <label className="block text-sm font-medium">Dal</label>
                    <input type="date" className="border rounded px-2 py-1" value={from} onChange={e => setFrom(e.target.value)} />
                </div>
                <div>
                    <label className="block text-sm font-medium">Al</label>
                    <input type="date" className="border rounded px-2 py-1" value={to} onChange={e => setTo(e.target.value)} />
                </div>

                <div>
                    <label className="block text-sm font-medium">Convenzione</label>
                    <input
                        list="convlist"
                        className="border rounded px-2 py-1 min-w-[240px]"
                        value={convenzione}
                        onChange={(e) => setConvenzione(e.target.value)}
                        placeholder="(opzionale)"
                    />
                    <datalist id="convlist">
                        {convenzioni.map(c => <option key={c.id} value={c.nome} />)}
                    </datalist>
                </div>

                <div>
                    <label className="block text-sm font-medium">Corso</label>
                    <select className="border rounded px-2 py-1 min-w-[260px]" value={idcourse} onChange={e => setIdcourse(e.target.value)}>
                        <option value="[-]">Seleziona il corso</option>
                        {corsi.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                </div>

                <label className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={freeOnly} onChange={e => setFreeOnly(e.target.checked)} />
                    Solo risposte libere
                </label>

                <button onClick={load} className="px-3 py-1 bg-blue-600 text-white rounded">Cerca</button>
                <button onClick={exportCSV} className="px-3 py-1 bg-green-600 text-white rounded">Scarica CSV</button>

                <div className="ml-auto text-sm text-gray-600">
                    {loading ? "Caricamento…" : `Trovati: ${count}`}
                </div>
            </div>

            {/* Tabella stile VB */}
            <div className="overflow-x-auto border rounded">
                {freeOnly ? (
                    <table className="min-w-[1100px] w-full text-sm text-gray-800">
                        <thead className="bg-gray-100 text-gray-700 border-b">
                            <tr>
                                <th className="p-2 w-[130px] text-left">Data</th>
                                <th className="p-2 w-[250px] text-left">Corsista / Corso</th>
                                <th className="p-2 w-[450px] text-left">Risposta libera</th>
                                <th className="p-2 w-[120px] text-center">Attiva</th>
                                <th className="p-2 w-[120px] text-center">Azione</th>
                            </tr>
                        </thead>

                        <tbody>

                            {/* ✅ DESKTOP VIEW */}
                            {(rows as FreeRow[]).map((r) => (
                                <tr key={r.id_track} className="hidden sm:table-row border-t hover:bg-gray-50">

                                    {/* Data */}
                                    <td className="p-2 text-xs">
                                        {fmtDT(r.date_attempt)}
                                    </td>

                                    {/* Corsista + corso */}
                                    <td className="p-2 text-xs">
                                        <span className="font-semibold">{r.firstname} {r.lastname}</span><br />
                                        <span className="text-gray-500 text-[11px]">{r.coursename}</span>
                                    </td>

                                    {/* Risposta libera */}
                                    <td className="p-2 text-xs break-words">
                                        <span className="bg-purple-100 border-l-4 border-purple-500 px-2 py-1 text-purple-700 font-semibold block rounded">
                                            “{r.more_info}”
                                        </span>
                                    </td>

                                    {/* Stato attiva */}
                                    <td className="p-2 text-center">
                                        <span className={`px-2 py-[2px] text-[11px] rounded font-semibold ${r.attiva ? "bg-green-600 text-white" : "bg-gray-400 text-white"
                                            }`}>
                                            {r.attiva ? "ON" : "OFF"}
                                        </span>
                                    </td>

                                    {/* Bottone azione */}
                                    <td className="p-2 text-center">
                                        <button
                                            onClick={() => toggleAttiva(r, r.attiva)}
                                            className="px-2 py-1 text-[11px] bg-blue-600 hover:bg-blue-700 text-white rounded"
                                        >
                                            {r.attiva ? "Disattiva" : "Attiva"}
                                        </button>
                                    </td>

                                </tr>
                            ))}

                            {/* ✅ MOBILE CARD VIEW */}
                            {(rows as FreeRow[]).map((r) => (
                                <tr key={"m" + r.id_track} className="sm:hidden border-t">
                                    <td colSpan={5} className="p-2">
                                        <div className="bg-white border rounded shadow px-3 py-2 space-y-2">

                                            <div className="text-sm font-semibold text-gray-800">
                                                {fmtDT(r.date_attempt)}
                                            </div>

                                            <div className="text-xs">
                                                <span className="font-semibold">{r.firstname} {r.lastname}</span><br />
                                                <span className="text-gray-500 text-[11px]">{r.coursename}</span>
                                            </div>

                                            <div className="px-2 py-1 bg-purple-100 border-l-4 border-purple-500 text-purple-700 text-sm font-semibold rounded">
                                                “{r.more_info}”
                                            </div>

                                            <div className="flex justify-between items-center">
                                                <span className={`px-2 py-[2px] text-[11px] rounded font-bold ${r.attiva ? "bg-green-600 text-white" : "bg-gray-400 text-white"
                                                    }`}>
                                                    {r.attiva ? "ON" : "OFF"}
                                                </span>

                                                <button
                                                    onClick={() => toggleAttiva(r, r.attiva)}
                                                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded"
                                                >
                                                    {r.attiva ? "Disattiva" : "Attiva"}
                                                </button>
                                            </div>

                                        </div>
                                    </td>
                                </tr>
                            ))}

                            {/* Nessun risultato */}
                            {!loading && rows.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-4 text-center text-gray-500">
                                        Nessun risultato
                                    </td>
                                </tr>
                            )}

                        </tbody>
                    </table>
                ) : (
                    <table className="min-w-[900px] w-full text-sm">
                        <thead className="bg-gray-100 text-gray-600">
                            <tr>
                                <th className="p-2">Data</th>
                                <th className="p-2">Nome</th>
                                <th className="p-2">Cognome</th>
                                <th className="p-2">Email</th>
                                <th className="p-2">Corso</th>
                                <th className="p-2">Risposta libera</th>
                                <th className="p-2">Attiva</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(rows as FreeRow[]).map((r, i) => (
                                <tr key={`${r.id_track}-${i}`} className="border-t">
                                    <td className="p-2 whitespace-nowrap">{fmtDT(r.date_attempt)}</td>
                                    <td className="p-2">{r.firstname}</td>
                                    <td className="p-2">{r.lastname}</td>
                                    <td className="p-2">{r.email}</td>
                                    <td className="p-2">{r.coursename}</td>
                                    <td className="p-2">{r.more_info}</td>
                                    <td className="p-2">{r.attiva ? "1" : "0"}</td>
                                </tr>
                            ))}
                            {!loading && rows.length === 0 && (
                                <tr><td colSpan={7} className="p-4 text-center text-gray-500">Nessun risultato</td></tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}