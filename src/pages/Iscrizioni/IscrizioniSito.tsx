import React, { useState, useEffect, useMemo } from "react";
import ModalEditOrdine from "./ModalEditOrdine";
import ModalEditCorsista from "./ModalEditCorsista";
import ModalEsitoIscrizione from "./ModalEsitoIscrizioni";
interface Corsista {
  id: number;
  corsista_first_name: string;
  corsista_last_name: string;
  corsista_email: string;
  corsista_pec: string;
  corsista_cf: string;
  codice_corso: string;
  corso_title: string;
  // Esito email (popolato dopo iscrizione)
  esitoEmail?: {
    to: "ok" | "ko" | "-";
    bcc: "ok" | "ko" | "-";
    pec: "ok" | "ko" | "-";
  };
}

interface Iscrizione {
  id: number;
  order_id: string;
  date_ins: string;
  nome_convenzione: string | null;
  intestazione_fattura: string | null;
  metodo_di_pagamento: string | null;
  order_status: string | null;
  fatturato?: number;
  costo_imponibile?: number;
  billing_discount?: number;
  interrompi?: number | null;
}

export default function IscrizioniSito() {
  const [rows, setRows] = useState<Iscrizione[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [subgrid, setSubgrid] = useState<Record<string, Corsista[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadingSub, setLoadingSub] = useState<Record<string, boolean>>({});
  const [editOrdine, setEditOrdine] = useState<null | { order: Iscrizione }>(
    null,
  );
  const [editCorsista, setEditCorsista] = useState<null | {
    corsista: Corsista;
    orderId: string;
  }>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState<any>(null);
  const limit = 50;

  const formatDateTime = (isoString: string) => {
    if (!isoString) return "";
    const d = new Date(isoString);
    const pad = (n: number) => (n < 10 ? "0" + n : n);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const fetchOrdini = async (p = 1) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/iscrizioni/sito?page=${p}&limit=${limit}`);
      const json = await res.json();
      const data = json.rows || [];
      const normalized = data.map((r: any) => ({
        ...r,
        fatturato:
          (Number(r.costo_imponibile || 0) - Number(r.billing_discount || 0)) *
          1.22,
      }));
      setRows(normalized);
      setTotal(json.total || data.length);
      setPage(p);
    } catch (err) {
      console.error("Errore caricamento ordini:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrdini(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchCorsisti = async (orderId: string) => {
    setLoadingSub((p) => ({ ...p, [orderId]: true }));
    try {
      const res = await fetch(
        `/api/iscrizioni/ordini/${encodeURIComponent(orderId)}/corsisti`,
      );
      const data = await res.json();
      setSubgrid((p) => ({ ...p, [orderId]: data }));
    } catch (err) {
      console.error("Errore caricamento corsisti:", err);
      setSubgrid((p) => ({ ...p, [orderId]: [] }));
    } finally {
      setLoadingSub((p) => ({ ...p, [orderId]: false }));
    }
  };

  const toggleRow = (rowId: string, orderId: string) => {
    setOpenRowId((current) => {
      if (current === rowId) return null;
      if (!subgrid[orderId]) fetchCorsisti(orderId);
      return rowId;
    });
  };

  // ====== AZIONI ======
  const EditIscrizionesito = (r: Iscrizione) => setEditOrdine({ order: r });

  const reinvia = async (orderId: string) => {
    if (!confirm(`Reinvia email ordine #${orderId} a billing_email?`)) return;
    const res = await fetch(
      `/api/iscrizioni/ordini/${encodeURIComponent(orderId)}/reinvia`,
      { method: "POST" },
    );
    const j = await res.json();
    if (j.success) alert("Email reinviata");
    else alert(j.error || "Errore invio email");
  };

  const segnala = async (orderId: string) => {
    if (!confirm(`Inviare sollecito pagamento per ordine #${orderId}?`)) return;
    const res = await fetch(
      `/api/iscrizioni/ordini/${encodeURIComponent(orderId)}/segnala`,
      { method: "POST" },
    );
    const j = await res.json();
    if (j.success) alert("Sollecito inviato");
    else alert(j.error || "Errore invio sollecito");
  };

  const interrompi = async (orderId: string) => {
    const ok = confirm("Interrompere le segnalazioni automatiche?");
    if (!ok) return;
    await fetch(`/api/iscrizioni/ordini/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interrompi: 1 }),
    });
    fetchOrdini(page);
  };

  // Iscrivi (ordine intero o singolo) — chiama
  const iscrivisito = async (idordine: number, nuovo: boolean) => {
    const body = {
      idordine,
      table: "woocommerce",
      webdb: "newformazione",

      chkexist: !nuovo,
      sendmail: true,
    };
    const res = await fetch("/api/iscrizioni/weborders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setModalData(json);
    setModalOpen(true);

    if (!json.success) {
      alert(json.error || "Errore iscrizione");
      return;
    }
    // Merge esitoEmail sui corsisti già caricati
    const mapEsiti: Record<
      string,
      { to: any; bcc: any; pec: any } | undefined
    > = {};
    json.result.forEach((r: any) => {
      mapEsiti[String(r.email).toLowerCase()] = r.esitoEmail;
    });
    setSubgrid((prev) => {
      const out = { ...prev };
      const orderKey = String(idordine);
      out[orderKey] = (out[orderKey] || []).map((c) => {
        const key = (c.corsista_email || "").toLowerCase();
        if (mapEsiti[key]) return { ...c, esitoEmail: mapEsiti[key] };
        return c;
      });
      return out;
    });
    alert("Iscrizione completata");
    fetchOrdini(page);
  };

  const iscrivisitosingolo = async (
    orderId: string,
    nuovo: boolean,
    corsistaId: number,
  ) => {
    // usa Options per limitare al corsista
    const body = {
      idordine: orderId,
      table: "woocommerce",
      webdb: "newformazione",

      chkexist: !nuovo,
      sendmail: true,
      Options: `a.order_id=${orderId} AND b.id=${corsistaId}`,
    };
    const res = await fetch("/api/iscrizioni/iscriviwebnew", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!j.success) {
      alert(j.error || "Errore iscrizione singolo");
      return;
    }
    // aggiorna badge email
    const es = j.result?.[0]?.esitoEmail;
    if (es) {
      setSubgrid((prev) => {
        const out = { ...prev };
        const list = (out[orderId] || []).map((c) =>
          c.id === corsistaId ? { ...c, esitoEmail: es } : c,
        );
        out[orderId] = list;
        return out;
      });
    }
    alert("Iscrizione singolo completata");
    fetchOrdini(page);
  };

  // Modifica corsista

  // Totale pagina
  const totale = useMemo(
    () => rows.reduce((s, r) => s + (r.fatturato || 0), 0),
    [rows],
  );

  const badge = (val?: "ok" | "ko" | "-") => {
    const color =
      val === "ok"
        ? "bg-green-100 text-green-700"
        : val === "ko"
          ? "bg-red-100 text-red-700"
          : "bg-gray-100 text-gray-600";
    return (
      <span
        className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${color}`}
      >
        {val || "-"}
      </span>
    );
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <h1 className="text-lg sm:text-xl font-semibold">
        📦 Iscrizioni da sito
      </h1>

      {loading ? (
        <p className="text-center text-gray-500">Caricamento...</p>
      ) : (
        <div className="overflow-x-auto border rounded-md shadow-sm">
          <table className="min-w-[1100px] border-collapse text-sm table-fixed w-full">
            <thead className="bg-gray-100 text-gray-600 sticky top-0 z-10">
              <tr>
                <th className="w-6"></th>
                <th className="w-[380px] p-2 text-left">Azioni</th>
                <th className="p-2">N. Ordine</th>
                <th className="p-2">Data</th>
                <th className="p-2">Convenzione</th>
                <th className="p-2">Intestazione Fattura</th>
                <th className="p-2">Modalità</th>
                <th className="p-2">Esito</th>
                <th className="p-2 text-right">Tot €</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const rowKey = String(row.id || row.order_id || index);
                const isOpen = openRowId === rowKey;
                const orderKey = String(row.order_id);
                const corsisti = subgrid[orderKey] || [];

                return (
                  <React.Fragment key={rowKey}>
                    <tr
                      className={`border-t hover:bg-gray-50 ${row.order_status === "completed" ? "bg-orange-50" : ""}`}
                    >
                      <td
                        className="text-center cursor-pointer select-none"
                        onClick={() => toggleRow(rowKey, orderKey)}
                      >
                        {isOpen ? "▼" : "▶"}
                      </td>

                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          <button
                            title="Modifica"
                            onClick={() => EditIscrizionesito(row)}
                            className="px-2 py-1 text-xs bg-yellow-400 hover:bg-yellow-500 text-white rounded"
                          >
                            ✏️
                          </button>
                          <button
                            title="Iscrivi"
                            onClick={() =>
                              iscrivisito(Number(row.order_id), false)
                            }
                            className="px-2 py-1 text-xs bg-red-500 hover:bg-red-600 text-white rounded"
                          >
                            Iscrivi
                          </button>
                          <button
                            title="Iscrivi nuovo"
                            onClick={() =>
                              iscrivisito(Number(row.order_id), true)
                            }
                            className="px-2 py-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded"
                          >
                            Nuovo
                          </button>
                          <button
                            title="Reinvia"
                            onClick={() => reinvia(orderKey)}
                            className="px-2 py-1 text-xs bg-purple-500 hover:bg-purple-600 text-white rounded"
                          >
                            Reinvia
                          </button>
                          {row.interrompi !== 1 && (
                            <>
                              <button
                                title="Segnala"
                                onClick={() => segnala(orderKey)}
                                className="px-2 py-1 text-xs bg-yellow-500 hover:bg-yellow-600 text-white rounded"
                              >
                                ⚠️
                              </button>
                              <button
                                title="Interrompi"
                                onClick={() => interrompi(orderKey)}
                                className="px-2 py-1 text-xs bg-red-700 hover:bg-red-800 text-white rounded"
                              >
                                🔒
                              </button>
                            </>
                          )}
                          <span className="px-2 py-1 text-xs bg-gray-200 rounded">
                            {row.order_id}
                          </span>
                        </div>
                      </td>

                      <td className="p-2">{row.order_id}</td>
                      <td className="p-2">{formatDateTime(row.date_ins)}</td>
                      <td className="p-2">{row.nome_convenzione || "-"}</td>
                      <td className="p-2">{row.intestazione_fattura || "-"}</td>
                      <td className="p-2">{row.metodo_di_pagamento || "-"}</td>
                      <td className="p-2">
                        {row.order_status === "completed"
                          ? "Iscritto"
                          : row.order_status || "-"}
                      </td>
                      <td className="p-2 text-right">
                        {row.fatturato
                          ? row.fatturato.toLocaleString("it-IT")
                          : "-"}
                      </td>
                    </tr>

                    {isOpen && (
                      <tr>
                        <td colSpan={9} className="bg-gray-50 p-3">
                          <h3 className="text-sm font-semibold mb-2">
                            👥 Corsisti ordine #{row.order_id}
                          </h3>

                          {loadingSub[orderKey] ? (
                            <div className="text-center text-gray-500 py-2">
                              <div className="animate-spin inline-block w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full mr-2"></div>
                              Caricamento corsisti...
                            </div>
                          ) : corsisti.length === 0 ? (
                            <p className="text-gray-500 text-sm">
                              Nessun corsista associato.
                            </p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full border text-xs bg-white min-w-[980px]">
                                <thead className="bg-gray-100 text-gray-600">
                                  <tr>
                                    <th className="p-2 w-[380px]">Azioni</th>
                                    <th className="p-2">Nome</th>
                                    <th className="p-2">Cognome</th>
                                    <th className="p-2">Email</th>
                                    <th className="p-2">PEC</th>
                                    <th className="p-2">CF</th>
                                    <th className="p-2">Corso</th>
                                    <th className="p-2 text-center">Email</th>
                                    <th className="p-2 text-center">BCC</th>
                                    <th className="p-2 text-center">PEC</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {corsisti.map((c, idx) => {
                                    const corsistaKey = `${orderKey}-${c.id ?? idx}`;
                                    return (
                                      <tr
                                        key={corsistaKey}
                                        className="border-t hover:bg-gray-50"
                                      >
                                        <td className="p-2">
                                          <div className="flex flex-wrap gap-1">
                                            <button
                                              onClick={() =>
                                                setEditCorsista({
                                                  orderId: orderKey,
                                                  corsista: c,
                                                })
                                              }
                                              className="px-2 py-1 bg-yellow-500 text-white text-xs rounded"
                                            >
                                              Modifica
                                            </button>
                                            <button
                                              onClick={() =>
                                                iscrivisitosingolo(
                                                  orderKey,
                                                  false,
                                                  c.id,
                                                )
                                              }
                                              className="px-2 py-1 bg-blue-500 text-white text-xs rounded"
                                            >
                                              Iscrivi
                                            </button>
                                            <button
                                              onClick={() =>
                                                iscrivisitosingolo(
                                                  orderKey,
                                                  true,
                                                  c.id,
                                                )
                                              }
                                              className="px-2 py-1 bg-green-600 text-white text-xs rounded"
                                            >
                                              Nuovo
                                            </button>
                                          </div>
                                        </td>
                                        <td className="p-2">
                                          {c.corsista_first_name}
                                        </td>
                                        <td className="p-2">
                                          {c.corsista_last_name}
                                        </td>
                                        <td className="p-2">
                                          {c.corsista_email}
                                        </td>
                                        <td className="p-2">
                                          {c.corsista_pec}
                                        </td>
                                        <td className="p-2">{c.corsista_cf}</td>
                                        <td className="p-2">
                                          {c.codice_corso} - {c.corso_title}
                                        </td>
                                        <td className="p-2 text-center">
                                          {badge(c.esitoEmail?.to)}
                                        </td>
                                        <td className="p-2 text-center">
                                          {badge(c.esitoEmail?.bcc)}
                                        </td>
                                        <td className="p-2 text-center">
                                          {badge(c.esitoEmail?.pec)}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          <div className="flex flex-col sm:flex-row justify-between items-center text-sm p-3 border-t bg-gray-50 gap-2">
            <span>
              Pagina {page} / {Math.ceil(total / limit)} (
              {total.toLocaleString("it-IT")} ordini)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => fetchOrdini(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded disabled:opacity-50"
              >
                ← Precedente
              </button>
              <button
                onClick={() => fetchOrdini(page + 1)}
                disabled={page * limit >= total}
                className="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded disabled:opacity-50"
              >
                Successiva →
              </button>
            </div>
          </div>
        </div>
      )}

      {!loading && (
        <div className="pt-4 text-right text-sm text-gray-700 font-semibold">
          Totale pagina:{" "}
          {totale.toLocaleString("it-IT", {
            style: "currency",
            currency: "EUR",
          })}
        </div>
      )}

      {/* Modali */}
      {editOrdine && (
        <ModalEditOrdine
          ordine={editOrdine.order}
          onClose={() => setEditOrdine(null)}
          onSaved={() => {
            setEditOrdine(null);
            fetchOrdini(page);
          }}
        />
      )}
      {editCorsista && (
        <ModalEditCorsista
          corsista={editCorsista.corsista}
          onClose={() => setEditCorsista(null)}
          onSaved={() => {
            setEditCorsista(null);
            if (openRowId) fetchCorsisti(String(editCorsista.orderId));
          }}
        />
      )}
      {modalOpen && modalData && (
        <ModalEsitoIscrizione
          open={modalOpen}
          success={modalData.success}
          failed={modalData.failed}
          failures={modalData.failures || []}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
