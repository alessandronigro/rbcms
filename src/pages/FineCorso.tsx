import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCcw, CheckCircle, XCircle, StickyNote } from "lucide-react";
import dayjs from "dayjs";

const BACKEND = import.meta.env.VITE_BACKEND_URL;

export default function FineCorso() {
    const [db, setDb] = useState("forma4");
    const [host, setHost] = useState("4.232.138.184");

    const [cat, setCat] = useState("Tutti");
    const [filter, setFilter] = useState("0"); // Non inviati di default
    const [rows, setRows] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);

    // 🔹 Carica i corsisti
    const loadData = async () => {
        setLoading(true);
        try {
            const res = await fetch(
                `${BACKEND}/api/finecorso/list?host=${host}&db=${db}&cat=${cat}&filter=${filter}`
            );
            const data = await res.json();
            if (data.success) setRows(data.rows);
        } catch (err) {
            console.error("Errore caricamento dati:", err);
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
                body: JSON.stringify({ host, db, iduser: id_user, idcourse: id_course, evaso, note }),
            });
            const data = await res.json();
            if (data.success) {
                alert(data.message);
                await loadData();
            } else {
                alert("Errore: " + data.error);
            }
        } catch (err) {
            alert("Errore di rete durante l’aggiornamento");
            console.error(err);
        }
    };

    // 🔹 Multi aggiorna
    const handleMultiAggiorna = async () => {
        if (selected.length === 0) return alert("Seleziona almeno un corsista");
        for (const id of selected) {
            const row = rows.find((r) => `${r.id_user}-${r.id_course}` === id);
            if (row) {
                await handleAggiorna(row.id_user, row.id_course, 1);
            }
        }
        alert("Operazione completata ✅");
        setSelected([]);
    };

    // 🔹 Gestione selezione multipla
    const toggleSelect = (id: string) => {
        setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
    };

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-4">🎓 Elenco Fine Corso</h1>

            {/* Filtri principali */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-6">
                <select value={`${host}-${db}`} onChange={(e) => {
                    const [h, d] = e.target.value.split("-");
                    setHost(h);
                    setDb(d);
                }} className="border rounded p-2">
                    <option value="EFAD-newformazionein">Piattaforma 2018-2024</option>
                    <option selected value="IFAD-forma4">Piattaforma 2025</option>
                    <option value="SITE-formazionein">Piattaforma 2011-2018</option>
                    <option value="167.86.110.96-formazionecondorb">RB Academy</option>
                </select>



                <select value={filter} onChange={(e) => setFilter(e.target.value)} className="border rounded p-2">
                    <option value="Tutti">Tutti</option>
                    <option value="1">Inviati</option>
                    <option value="0">Non Inviati</option>
                </select>

                <select value={cat} onChange={(e) => setCat(e.target.value)} className="border rounded p-2">
                    <option value="Tutti">Tutti</option>
                    <option value="ivass">IVASS</option>
                    <option value="oam">OAM</option>
                    <option value="oamservizi">OAM Servizi</option>
                    <option value="ivass60">IVASS 60h</option>
                </select>

                <Button onClick={loadData} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white">
                    {loading ? <Loader2 className="animate-spin mr-2" /> : <RefreshCcw className="mr-2" />}
                    Cerca
                </Button>
            </div>

            {/* Tabella risultati */}
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

            {/* Multi azione */}
            {rows.length > 0 && (
                <div className="mt-4 flex justify-end">
                    <Button onClick={handleMultiAggiorna} className="bg-green-600 hover:bg-green-700 text-white">
                        ✅ Segna come inviati ({selected.length})
                    </Button>
                </div>
            )}
        </div>
    );
}