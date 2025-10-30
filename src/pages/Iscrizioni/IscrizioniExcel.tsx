import React, { useState } from "react";

interface ParsedRow {
    cognome: string;
    nome: string;
    email: string;
    cf: string;
    telefono?: string;
}

interface Convenzione {
    name: string;
    host: string;
    piattaforma: string;
}

interface Corso {
    code: string;
    name: string;
}

export default function IscrizioniExcel() {
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<ParsedRow[]>([]);
    const [selectedConv, setSelectedConv] = useState("");
    const [convenzioni, setConvenzioni] = useState<Convenzione[]>([]);
    const [corsi, setCorsi] = useState<Corso[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedCourse, setSelectedCourse] = useState("");

    // ✅ CSV → oggetto
    const parseCSV = (text: string) => {
        const rows = text.split(/\r?\n/).filter(r => r.trim() !== "");
        const parsed: ParsedRow[] = [];
        rows.forEach((row) => {
            const [cognome, nome, email, cf, telefono] = row.split(";");
            if (!cognome || !nome || !email || !cf) return;
            parsed.push({
                cognome: cognome.trim(),
                nome: nome.trim(),
                email: email.trim(),
                cf: cf.trim(),
                telefono: telefono?.trim(),
            });
        });
        return parsed;
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;

        setFile(f);
        setPreview([]);
        setConvenzioni([]);
        setCorsi([]);
        setSelectedConv("");

        const text = await f.text();
        const parsed = parseCSV(text);

        if (!parsed.length) {
            alert("⚠️ Nessun dato valido nel file");
            return;
        }

        setPreview(parsed);
        fetchConvenzioni();
    };

    const fetchConvenzioni = async () => {
        try {
            const r = await fetch("/api/iscrizioni/convenzioni");
            const json = await r.json();
            setConvenzioni(json || []);
        } catch (err) {
            console.error("Errore convenzioni:", err);
        }
    };

    const handleChangeConvenzione = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const value = e.target.value;
        setSelectedConv(value);
        setCorsi([]);

        if (!value) return;

        try {
            const r = await fetch(`/api/iscrizioni/corsi?convenzione=${encodeURIComponent(value)}`);
            const json = await r.json();
            console.log("Corsi by convenzione", json);

            if (!Array.isArray(json)) {
                console.warn("⚠️ corsi non array:", json);
                setCorsi([]);
                return;
            }

            setCorsi(json);
        } catch (err) {
            console.error("Errore caricamento corsi:", err);
            setCorsi([]);
        }
    };

    const handleIscrivi = async () => {
        if (!selectedConv || !selectedCourse) {
            alert("Seleziona convenzione e corso");
            return;
        }

        setLoading(true);

        const payload = {
            convenzione: selectedConv,
            corso: selectedCourse,
            utenti: preview,
        };

        const res = await fetch("/api/iscrizioni/excel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const data = await res.json();
        setLoading(false);

        alert(data.message || "Operazione eseguita");
    };

    return (
        <div className="p-4 space-y-4">
            <h2 className="text-xl font-bold text-blue-700">Iscrizioni da Excel CSV</h2>

            <input
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="border p-2 w-full max-w-sm"
            />

            {preview.length > 0 && (
                <>
                    <h3 className="font-semibold mt-3 text-green-700">
                        ✅ Caricati {preview.length} utenti
                    </h3>

                    <select
                        value={selectedConv}
                        onChange={handleChangeConvenzione}
                        className="border rounded p-2 w-full max-w-md mt-3"
                    >
                        <option value="">-- Seleziona Convenzione --</option>
                        {convenzioni.map((c, i) => (
                            <option
                                key={i}
                                value={c.name}
                            >
                                {c.name}
                            </option>
                        ))}
                    </select>

                    {selectedConv && (
                        <>
                            <select
                                value={selectedCourse}
                                onChange={(e) => setSelectedCourse(e.target.value)}
                                className="border rounded p-2 w-full max-w-md mt-3"
                            >
                                <option value="">-- Seleziona Corso --</option>
                                {Array.isArray(corsi) &&
                                    corsi.map((c, i) => (
                                        <option key={i} value={c.code}>
                                            {c.code} - {c.name}
                                        </option>
                                    ))}
                            </select>

                            <button
                                disabled={loading}
                                onClick={handleIscrivi}
                                className="mt-4 bg-blue-600 text-white px-4 py-2 rounded"
                            >
                                {loading ? "Iscrizione..." : "Iscrivi tutti"}
                            </button>
                        </>
                    )}

                    <hr className="my-4" />

                    <h3 className="font-semibold text-gray-700">Anteprima</h3>
                    <table className="min-w-full border text-sm">
                        <thead className="bg-gray-100">
                            <tr>
                                <th>Cognome</th>
                                <th>Nome</th>
                                <th>Email</th>
                                <th>CF</th>
                                <th>Telefono</th>
                            </tr>
                        </thead>
                        <tbody>
                            {preview.map((u, idx) => (
                                <tr key={idx} className="border text-center">
                                    <td>{u.cognome}</td>
                                    <td>{u.nome}</td>
                                    <td>{u.email}</td>
                                    <td>{u.cf}</td>
                                    <td>{u.telefono}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}
        </div>
    );
}