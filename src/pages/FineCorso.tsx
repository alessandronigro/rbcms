import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCcw, CheckCircle, XCircle, StickyNote } from "lucide-react";
import dayjs from "dayjs";
import { useAlert } from "../components/SmartAlertModal";
import { backendUrl as BACKEND } from "@/config/backend";
import Calendario60h from "./60h/Calendario";
import CalendarioAmm from "./Amm/CalendarioAmm";

export default function FineCorso() {
    // 🔹 Ora basta solo il database
    const [db, setDb] = useState("forma4");
    const [cat, setCat] = useState("Tutti");
    const [filter, setFilter] = useState("0"); // Non inviati di default
    const [rows, setRows] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const [showCalendarsModal, setShowCalendarsModal] = useState(false);
    const { alert: showAlert } = useAlert();

    // 🔹 Carica corsisti
    const loadData = async () => {
        setLoading(true);
        try {
            const res = await fetch(
                `${BACKEND}/api/finecorso/list?db=${db}&cat=${cat}&filter=${filter}`
            );
            const data = await res.json();
            if (data.success) setRows(data.rows);
            else console.warn("⚠️ Nessun dato ricevuto");
        } catch (err) {
            console.error("❌ Errore caricamento dati:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [db, cat, filter]);

    // 🔹 Aggiorna stato evasione o note
    const handleAggiorna = async (id_user: number, id_course: number, evaso: number, note?: string) => {
        try {
            const res = await fetch(`${BACKEND}/api/finecorso/evaso`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ db, iduser: id_user, idcourse: id_course, evaso, note }),
            });
            const data = await res.json();
            if (data.success) {
                await showAlert(data.message || "Aggiornato correttamente ✅");
                await loadData();
            } else {
                await showAlert("Errore: " + data.error);
            }
        } catch (err) {
            await showAlert("Errore di rete durante l’aggiornamento");
            console.error(err);
        }
    };

    // 🔹 Multi aggiorna
    const handleMultiAggiorna = async () => {
        if (selected.length === 0) {
            await showAlert("Seleziona almeno un corsista");
            return;
        }
        for (const id of selected) {
            const row = rows.find((r) => `${r.id_user}-${r.id_course}` === id);
            if (row) await handleAggiorna(row.id_user, row.id_course, 1);
        }
        await showAlert("Operazione completata ✅");
        setSelected([]);
    };

    // 🔹 Gestione selezione multipla
    const toggleSelect = (id: string) => {
        setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
    };

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-4">🎓 Elenco Fine Corso</h1>

            {/* 🔹 Filtri principali */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-6">
                <select
                    value={db}
                    onChange={(e) => setDb(e.target.value)}
                    className="border rounded p-2"
                >
                    <option value="forma4">RB Formazione (2025)</option>
                    <option value="efadnovastudia">Nova Studia</option>
                    <option value="fadassiac">Assiac</option>
                    <option value="formazionecondorb">RB Academy</option>
                </select>

                <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="border rounded p-2"
                >
                    <option value="Tutti">Tutti</option>
                    <option value="1">Inviati</option>
                    <option value="0">Non Inviati</option>
                </select>

                <select
                    value={cat}
                    onChange={(e) => setCat(e.target.value)}
                    className="border rounded p-2"
                >
                    <option value="Tutti">Tutti</option>
                    <option value="ivass">IVASS</option>
                    <option value="oam">OAM</option>
                    <option value="oamservizi">OAM Servizi</option>
                    <option value="ivass60">IVASS 60h</option>
                </select>

                <Button
                    onClick={loadData}
                    disabled={loading}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                    {loading ? <Loader2 className="animate-spin mr-2" /> : <RefreshCcw className="mr-2" />}
                    Cerca
                </Button>
            </div>
            <div className="flex justify-end mb-4">
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowCalendarsModal(true)}
                >
                    📅 Visualizza calendari per prenotare
                </Button>
            </div>

            {/* 🔹 Tabella risultati */}
            <div className="overflow-x-auto border rounded-md">
                <table className="min-w-full text-sm border-collapse">
                    <thead className="bg-gray-100">
                        <tr>
                            <th className="p-2 border text-center"></th>
                            <th className="p-2 border text-left">Cognome</th>
                            <th className="p-2 border text-left">Nome</th>
                            <th className="p-2 border text-left">Corso</th>
                            <th className="p-2 border text-left">Codice</th>
                            <th className="p-2 border text-left">Convenzione</th>
                            <th className="p-2 border text-left">Data Iscrizione</th>
                            <th className="p-2 border text-left">Data Autocert.</th>
                            <th className="p-2 border text-left">Stato</th>
                            <th className="p-2 border text-center">Azioni</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length > 0 ? (
                            rows.map((r) => {
                                const selectedId = `${r.id_user}-${r.id_course}`;
                                return (
                                    <tr key={selectedId} className="hover:bg-gray-50">
                                        <td className="border p-2 text-center">
                                            <input
                                                type="checkbox"
                                                checked={selected.includes(selectedId)}
                                                onChange={() => toggleSelect(selectedId)}
                                            />
                                        </td>
                                        <td className="border p-2">{r.lastname}</td>
                                        <td className="border p-2">{r.firstname}</td>
                                        <td className="border p-2">{r.corso}</td>
                                        <td className="border p-2">{r.code}</td>
                                        <td className="border p-2">{r.convenzione}</td>
                                        <td className="border p-2">
                                            {r.date_inscr ? dayjs(r.date_inscr).format("DD/MM/YYYY") : "-"}
                                        </td>
                                        <td className="border p-2">
                                            {r.on_date ? dayjs(r.on_date).format("DD/MM/YYYY") : "-"}
                                        </td>
                                        <td className="border p-2">
                                            {r.evaso == 1 ? (
                                                <span className="text-green-600 font-semibold">Inviato</span>
                                            ) : (
                                                <span className="text-red-600 font-semibold">Non inviato</span>
                                            )}
                                        </td>
                                        <td className="border p-2 text-center flex gap-2 justify-center">
                                            {r.evaso == 1 ? (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => handleAggiorna(r.id_user, r.id_course, 0)}
                                                >
                                                    <XCircle className="mr-1 text-red-600" /> Annulla
                                                </Button>
                                            ) : (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => handleAggiorna(r.id_user, r.id_course, 1)}
                                                >
                                                    <CheckCircle className="mr-1 text-green-600" /> Segna Inviato
                                                </Button>
                                            )}
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => {
                                                    const n = prompt("Inserisci nota:", r.note || "");
                                                    if (n !== null) handleAggiorna(r.id_user, r.id_course, 2, n);
                                                }}
                                            >
                                                <StickyNote className="mr-1 text-yellow-600" /> Nota
                                            </Button>
                                        </td>
                                    </tr>
                                );
                            })
                        ) : (
                            <tr>
                                <td colSpan={10} className="p-4 text-center text-gray-500">
                                    Nessun risultato trovato
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* 🔹 Multi azione */}
            {rows.length > 0 && (
                <div className="mt-4 flex justify-end">
                    <Button
                        onClick={handleMultiAggiorna}
                        className="bg-green-600 hover:bg-green-700 text-white"
                    >
                        ✅ Segna come inviati ({selected.length})
                    </Button>
                </div>
            )}
            {showCalendarsModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
                    <div
                        className="fixed inset-0 bg-black/40"
                        onClick={() => setShowCalendarsModal(false)}
                    />
                    <div className="relative z-10 w-full max-w-[1200px] rounded-2xl border border-slate-200 bg-white shadow-2xl max-h-[calc(100vh-2rem)] overflow-auto">
                        <div className="flex items-center justify-between border-b px-6 py-4">
                            <div>
                                <p className="text-sm text-slate-500">Prenotazioni</p>
                                <h3 className="text-lg font-semibold text-slate-900">
                                    Scegli la sessione disponibile
                                </h3>
                            </div>
                            <button
                                type="button"
                                className="text-slate-500 hover:text-slate-900"
                                onClick={() => setShowCalendarsModal(false)}
                            >
                                ✕
                            </button>
                        </div>
                        <div className="grid grid-cols-1 gap-6 px-4 py-6 xl:grid-cols-2">
                            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                                <h4 className="mb-2 text-sm font-semibold text-slate-600">
                                    Calendario 60h
                                </h4>
                                <div className="rounded-lg bg-white p-2 shadow-inner">
                                    <Calendario60h />
                                </div>
                            </div>
                            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                                <h4 className="mb-2 text-sm font-semibold text-slate-600">
                                    Calendario Amm
                                </h4>
                                <div className="rounded-lg bg-white p-2 shadow-inner">
                                    <CalendarioAmm />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
