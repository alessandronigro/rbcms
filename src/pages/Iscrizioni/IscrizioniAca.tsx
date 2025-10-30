import React, { useEffect, useState } from "react";

export default function IscrizioniAca() {
    const [ordini, setOrdini] = useState<any[]>([]);
    const [expanded, setExpanded] = useState<number | null>(null);
    const [corsisti, setCorsisti] = useState<Record<number, any[]>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch("/api/iscrizioni/aca")
            .then(r => r.json())
            .then(setOrdini)
            .finally(() => setLoading(false));
    }, []);

    const toggleExpand = async (order_id: number) => {
        if (expanded === order_id) return setExpanded(null);
        setExpanded(order_id);
        if (!corsisti[order_id]) {
            const res = await fetch(`/api/iscrizioni/ordini/${order_id}/corsisti`);
            const json = await res.json();
            setCorsisti(prev => ({ ...prev, [order_id]: json }));
        }
    };

    const iscrivi = async (order_id: number) => {
        if (!window.confirm("Eseguire iscrizione convenzione?")) return;
        await fetch("/api/iscrizioni/iscrivi-convenzione", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order_id }),
        });
        alert("Iscrizione completata");
    };

    if (loading) return <p>Caricamento...</p>;

    return (
        <div className="p-4">
            <h1 className="text-xl font-semibold mb-3">Iscrizioni Sito</h1>
            <table className="min-w-full border text-sm">
                <thead className="bg-gray-100">
                    <tr>
                        <th></th>
                        <th>Ordine</th>
                        <th>Data</th>
                        <th>Convenzione</th>
                        <th>Fattura</th>
                        <th>Pagamento</th>
                        <th>Stato</th>
                        <th>Tot</th>
                        <th>Azioni</th>
                    </tr>
                </thead>
                <tbody>
                    {ordini.map((row) => (
                        <React.Fragment key={row.order_id}>
                            <tr className="border-t hover:bg-gray-50">
                                <td>
                                    <button onClick={() => toggleExpand(row.order_id)}>🔽</button>
                                </td>
                                <td>{row.order_id}</td>
                                <td>{row.date_ins}</td>
                                <td>{row.nome_convenzione}</td>
                                <td>{row.intestazione_fattura}</td>
                                <td>{row.metodo_di_pagamento}</td>
                                <td>{row.order_status}</td>
                                <td>{row.fatturato} €</td>
                                <td>
                                    <button
                                        onClick={() => iscrivi(row.order_id)}
                                        className="px-2 py-1 bg-blue-500 text-white rounded text-xs"
                                    >
                                        Iscrivi
                                    </button>
                                </td>
                            </tr>
                            {expanded === row.order_id && (
                                <tr className="bg-gray-50">
                                    <td colSpan={9}>
                                        <table className="w-full text-xs border">
                                            <thead>
                                                <tr className="bg-gray-200">
                                                    <th>Nome</th>
                                                    <th>Cognome</th>
                                                    <th>Email</th>
                                                    <th>CF</th>
                                                    <th>Corso</th>
                                                    <th>Esito</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(corsisti[row.order_id] || []).map((c) => (
                                                    <tr key={c.id}>
                                                        <td>{c.corsista_first_name}</td>
                                                        <td>{c.corsista_last_name}</td>
                                                        <td>{c.corsista_email}</td>
                                                        <td>{c.corsista_cf}</td>
                                                        <td>{c.corso_title}</td>
                                                        <td>{c.esito}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </td>
                                </tr>
                            )}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
}