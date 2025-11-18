import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, FileSpreadsheet, FileText } from "lucide-react";
import dayjs from "dayjs";
import { useAlert } from "../components/SmartAlertModal";

const BACKEND = import.meta.env.VITE_BACKEND_URL;

export default function ReportCorsi() {
    const [db, setDb] = useState("forma4");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [courses, setCourses] = useState<any[]>([]);
    const [selectedCourse, setSelectedCourse] = useState("");
    const [selectedCat, setSelectedCat] = useState("Seleziona Categoria");
    const [loading, setLoading] = useState(false);
    const [reportData, setReportData] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const { alert: showAlert } = useAlert();

    // 🧠 Funzione per determinare DB automatico in base all’anno
    const pickDbByDates = (fromISO: string, toISO: string) => {
        const year = dayjs(toISO || fromISO).year();
        if (year >= 2025) return "forma4";
        if (year >= 2018) return "newformazionein";
        return "formazionein";
    };

    // 🔹 Carica corsi filtrando “Formazione Intermediari” e price > 0
    const loadCourses = async () => {
        if (!from || !to) return; // serve un intervallo valido
        try {
            const selectedDb = pickDbByDates(from, to);
            setDb(selectedDb);

            const res = await fetch(
                `${BACKEND}/api/report/filters?from=${from}&to=${to}`
            );
            const data = await res.json();

            if (data.success) {
                const filteredCourses = (data.courses || []).filter(
                    (c: any) =>
                        (c.user_entry?.toLowerCase?.().includes("formazione intermediari") ||
                            c.user_entry?.toLowerCase?.().includes("rb intermediari")) &&
                        parseFloat(c.price || 0) > 0
                );
                // Se non esiste user_entry nel backend, mostra tutti quelli con prezzo > 0
                setCourses(filteredCourses.length ? filteredCourses : data.courses || []);
            }
        } catch (err) {
            console.error("Errore caricamento corsi:", err);
        }
    };

    // 🔁 Ricarica corsi ogni volta che cambiano le date
    useEffect(() => {
        if (from && to) loadCourses();
    }, [from, to]);

    // 🔎 Cerca report
    const getReport = async () => {
        if (!from || !to) {
            await showAlert("Inserisci un intervallo date valido");
            return;
        }
        setLoading(true);
        setReportData([]);
        setTotal(0);

        try {
            const selectedDb = pickDbByDates(from, to);
            setDb(selectedDb);

            const url = `${BACKEND}/api/report/data?db=${selectedDb}&datequest=${from}&datequest2=${to}&idcourse=${selectedCourse || "[-]"}&idcat=${selectedCat}`;
            const res = await fetch(url);
            const data = await res.json();

            if (data.success) {
                setReportData(data.rows);
                const sum = data.rows.reduce(
                    (acc: number, r: any) => acc + (parseFloat(r.fatturato) || 0),
                    0
                );
                setTotal(sum);
            }
        } catch (err) {
            console.error("Errore caricamento report:", err);
        } finally {
            setLoading(false);
        }
    };

    // 📤 Export PDF o Excel
    const handleExport = async (format: "pdf" | "excel") => {
        try {
            const selectedDb = pickDbByDates(from, to);
            const res = await fetch(`${BACKEND}/api/report/export?format=${format}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    db: selectedDb,
                    from,
                    to,
                    idcourse: selectedCourse,
                    idcat: selectedCat,
                    rows: reportData,
                }),
            });
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `Report_Corsi.${format === "excel" ? "xlsx" : "pdf"}`;
            a.click();
        } catch (err) {
            console.error("Errore esportazione:", err);
        }
    };

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-6">📊 Report Corsi</h1>

            {/* Filtri principali */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
                <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="border rounded p-2"
                />
                <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="border rounded p-2"
                />

                {/* Mostra DB scelto automaticamente */}
                <input
                    type="text"
                    value={db}
                    readOnly
                    className="border rounded p-2 bg-gray-100 text-gray-600"
                />

                <Button onClick={getReport} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white">
                    {loading ? <Loader2 className="animate-spin mr-2" /> : null}
                    Cerca
                </Button>
            </div>

            {/* Corsi e Categorie */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <select
                    value={selectedCourse}
                    onChange={(e) => setSelectedCourse(e.target.value)}
                    className="border rounded p-2"
                >
                    <option value="">-- Seleziona corso --</option>
                    {courses.map((c) => (
                        <option key={c.idcourse} value={c.idcourse}>
                            {c.name} ({c.price ? `${c.price}€` : ""})
                        </option>
                    ))}
                </select>

                {/* 🔸 Categorie statiche come in ASP.NET */}
                <select
                    value={selectedCat}
                    onChange={(e) => setSelectedCat(e.target.value)}
                    className="border rounded p-2"
                >
                    <option value="Seleziona Categoria">Seleziona Categoria</option>
                    <option value="10,12,1">OAM</option>
                    <option value="5,16,21,2">IVASS</option>
                    <option value="23,3">OCF</option>
                </select>
            </div>

            {/* Tabella risultati */}
            {loading ? (
                <p>Caricamento...</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full border text-sm">
                        <thead className="bg-gray-100 text-left">
                            <tr>
                                <th className="p-2 border">Data iscrizione</th>
                                <th className="p-2 border">Nome</th>
                                <th className="p-2 border">Cognome</th>
                                <th className="p-2 border">Codice corso</th>
                                <th className="p-2 border">Nome corso</th>
                                <th className="p-2 border">Fatturato</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reportData.length > 0 ? (
                                reportData.map((r, i) => (
                                    <tr key={i}>
                                        <td className="p-2 border">
                                            {dayjs(r.date_inscr).format("DD/MM/YYYY")}
                                        </td>
                                        <td className="p-2 border">{r.firstname}</td>
                                        <td className="p-2 border">{r.lastname}</td>
                                        <td className="p-2 border">{r.code}</td>
                                        <td className="p-2 border">{r.name}</td>
                                        <td className="p-2 border text-right">
                                            € {parseFloat(r.fatturato || 0).toLocaleString("it-IT")}
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={6} className="text-center p-4 text-gray-500">
                                        Nessun dato trovato
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        {reportData.length > 0 && (
                            <tfoot className="font-bold bg-gray-50">
                                <tr>
                                    <td colSpan={5} className="text-right p-2">
                                        Totale:
                                    </td>
                                    <td className="p-2 text-right">
                                        € {total.toLocaleString("it-IT")}
                                    </td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            )}

            {/* Esportazione */}
            {reportData.length > 0 && (
                <div className="flex gap-3 mt-6">
                    <Button
                        onClick={() => handleExport("excel")}
                        className="bg-green-600 hover:bg-green-700 text-white"
                    >
                        <FileSpreadsheet className="mr-2" /> Esporta Excel
                    </Button>
                    <Button
                        onClick={() => handleExport("pdf")}
                        className="bg-red-600 hover:bg-red-700 text-white"
                    >
                        <FileText className="mr-2" /> Esporta PDF
                    </Button>
                </div>
            )}
        </div>
    );
}
