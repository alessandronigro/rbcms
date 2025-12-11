import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import dayjs from "dayjs";
import { backendUrl as BACKEND } from "@/config/backend";
import { useAlert } from "../components/SmartAlertModal";

export default function ReportFatturatoOrdini() {
    const [month, setMonth] = useState(dayjs().format("YYYY-MM"));
    const [rows, setRows] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [total, setTotal] = useState(0);
    const [loadedMonth, setLoadedMonth] = useState("");
    const { alert: showAlert } = useAlert();
    const [corsistiCount, setCorsistiCount] = useState(0);

    const getReport = async () => {
        if (!month) {
            await showAlert("Seleziona un mese valido");
            return;
        }

        setLoading(true);
        setRows([]);
        setTotal(0);
        setCorsistiCount(0);
        setLoadedMonth("");
        try {
            const res = await fetch(`${BACKEND}/api/report/fatturato-ordini?month=${month}`);
            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || "Errore nel caricamento");
            }

            setRows(data.rows || []);
            setTotal(Number(data.totalRevenue ?? 0));
            setCorsistiCount(Number(data.corsistiCount ?? 0));
            setLoadedMonth(data.month || month);
        } catch (err: unknown) {
            console.error("Errore caricamento report ordini:", err);
            const message =
                err instanceof Error ? err.message : "Errore durante la richiesta";
            await showAlert(message);
        } finally {
            setLoading(false);
        }
    };

    const formatEuro = (value: number) =>
        new Intl.NumberFormat("it-IT", {
            style: "currency",
            currency: "EUR",
            minimumFractionDigits: 2,
        }).format(value);

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-6">📋 Report Fatturato Ordini</h1>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6 items-end">
                <label className="flex flex-col gap-1 text-sm text-gray-600">
                    Mese
                    <input
                        type="month"
                        value={month}
                        onChange={(e) => setMonth(e.target.value)}
                        className="border rounded px-2 py-1"
                    />
                </label>

                <div className="md:col-span-2 flex gap-2">
                    <Button
                        onClick={getReport}
                        disabled={loading}
                        className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2"
                    >
                        {loading ? <Loader2 className="animate-spin h-4 w-4" /> : null}
                        Cerca
                    </Button>
                </div>
            </div>

            {rows.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-4 text-sm">
                    <div className="flex flex-col rounded border border-gray-200 bg-white px-4 py-3 shadow-sm">
                        <span className="text-xs uppercase text-gray-500">Ordini caricati</span>
                        <span className="text-lg font-semibold">{rows.length.toLocaleString("it-IT")}</span>
                    </div>
                    <div className="flex flex-col rounded border border-gray-200 bg-white px-4 py-3 shadow-sm">
                        <span className="text-xs uppercase text-gray-500">Corsisti iscritti</span>
                        <span className="text-lg font-semibold">
                            {corsistiCount.toLocaleString("it-IT")}
                        </span>
                    </div>
                    <div className="flex flex-col rounded border border-gray-200 bg-white px-4 py-3 shadow-sm">
                        <span className="text-xs uppercase text-gray-500">Totale fatturato</span>
                        <span className="text-lg font-semibold">{formatEuro(total)}</span>
                    </div>
                    {loadedMonth ? (
                        <div className="flex flex-col rounded border border-gray-200 bg-white px-4 py-3 shadow-sm">
                            <span className="text-xs uppercase text-gray-500">Mese analizzato</span>
                            <span className="text-lg font-semibold">{loadedMonth}</span>
                        </div>
                    ) : null}
                </div>
            )}

            {loading ? (
                <p>Caricamento in corso...</p>
            ) : rows.length ? (
                <div className="overflow-x-auto">
                    <table className="w-full border text-sm">
                        <thead className="bg-gray-100 text-left text-xs uppercase">
                            <tr>
                                <th className="p-2 border">Data iscrizione</th>
                                <th className="p-2 border">Order ID</th>
                                <th className="p-2 border">Data ordine</th>
                                <th className="p-2 border">Nome</th>
                                <th className="p-2 border">Email</th>
                                <th className="p-2 border">Codici corsi</th>
                                <th className="p-2 border">Nomi corsi</th>
                                <th className="p-2 border text-center">Item</th>
                                <th className="p-2 border text-right">Fatturato</th>
                                <th className="p-2 border">Stato / Pagamento</th>
                                <th className="p-2 border">DB fonte</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, index) => (
                                <tr key={`${row.orderId}-${index}`} className="even:bg-white odd:bg-gray-50">
                                    <td className="p-2 border">
                                        {row.enrollmentAt
                                            ? dayjs(row.enrollmentAt).format("DD/MM/YYYY")
                                            : "-"}
                                    </td>
                                    <td className="p-2 border">{row.orderId}</td>
                                    <td className="p-2 border">
                                        {row.orderPlacedAt
                                            ? dayjs(row.orderPlacedAt).format("DD/MM/YYYY")
                                            : "-"}
                                    </td>
                                    <td className="p-2 border">{row.billingNome || "-"}</td>
                                    <td className="p-2 border">{row.billingEmail || "-"}</td>
                                    <td className="p-2 border">
                                        {(row.courseCodes || []).join(", ") || "-"}
                                    </td>
                                    <td className="p-2 border">{(row.courseNames || []).join(", ") || "-"}</td>
                                    <td className="p-2 border text-center">{row.itemCount || 0}</td>
                                    <td className="p-2 border text-right">
                                        {formatEuro(row.fatturato || 0)}
                                    </td>
                                    <td className="p-2 border">
                                        <div>{row.orderStatus || "-"}</div>
                                        <div className="text-xs text-gray-500">
                                            {row.paymentMethod || "-"}
                                        </div>
                                    </td>
                                    <td className="p-2 border">
                                        {(row.sourceDbs || []).join(", ") || "-"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="font-bold bg-gray-100">
                            <tr>
                                <td colSpan={8} className="p-2 text-right">
                                    Totale
                                </td>
                                <td className="p-2 text-right">{formatEuro(total)}</td>
                                <td colSpan={2} />
                            </tr>
                        </tfoot>
                    </table>
                </div>
            ) : (
                <p>Nessun dato disponibile per il mese selezionato.</p>
            )}
        </div>
    );
}
