import { FormEvent, useMemo, useState } from "react";
import { backendUrl } from "@/config/backend";

type MailCheckForm = {
  email: string;
  nome: string;
  cognome: string;
  subject: string;
  start: string;
  end: string;
  limit: string;
};

type MailCheckRow = {
  email: string;
  subject: string;
  date: string;
  from: string;
  messageId: string;
  uuid: string;
  tags: string[];
};

type Metadata = {
  requiredBcc: string;
  filters: {
    email: string;
    subject: string;
    range: { start: string; end: string };
    limit: number;
    offset: number;
  };
  totalAvailable: number;
  returned: number;
};

type DecemberRow = {
  idUser: number;
  idst: number;
  nome: string;
  cognome: string;
  email: string;
  courseCode: string;
  courseName: string;
  dateInscr: string;
  status: string;
  brevoMatch:
    | {
        subject: string;
        date: string;
        from: string;
        messageId: string;
        uuid: string;
        tags: string[];
      }
    | null;
  userid: string;
  idCourse: number;
};

type DecemberMetadata = {
  year: number;
  month: number;
  limit: number;
  range: { start: string; end: string };
  totalUsers: number;
  brevoRequests: number;
  matched: number;
  uniqueEmails: number;
  expectedBcc: string;
};

const INITIAL_FORM: MailCheckForm = {
  email: "",
  nome: "",
  cognome: "",
  subject: "",
  start: "",
  end: "",
  limit: "25",
};

const formatDate = (value: string) => {
  if (!value) return "";
  const normalized = new Date(value);
  if (Number.isNaN(normalized.getTime())) return value;
  return normalized.toLocaleString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

export default function MailCheck() {
  const [form, setForm] = useState<MailCheckForm>(INITIAL_FORM);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<MailCheckRow[]>([]);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decemberYear, setDecemberYear] = useState(String(new Date().getFullYear()));
  const [decemberLimit, setDecemberLimit] = useState("100");
  const [decemberRows, setDecemberRows] = useState<DecemberRow[]>([]);
  const [decemberMetadata, setDecemberMetadata] = useState<DecemberMetadata | null>(null);
  const [decemberLoading, setDecemberLoading] = useState(false);
  const [decemberError, setDecemberError] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<Record<string, string>>({});
  const [resendLoading, setResendLoading] = useState<Record<string, boolean>>({});

  const canSubmit = useMemo(() => form.email.trim().length > 0, [form.email]);

  const handleChange = (field: keyof MailCheckForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      setError("Indirizzo email obbligatorio per verificare gli invii");
      return;
    }

    setLoading(true);
    setError(null);
    setRows([]);
    setMetadata(null);

    const params = new URLSearchParams();
    Object.entries(form).forEach(([key, value]) => {
      if (!value) return;
      params.set(key, value);
    });

    try {
      const response = await fetch(`${backendUrl}/api/mailcheck/welcome?${params.toString()}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Errore nella chiamata all'API");
      }
      const data = await response.json();
      setMetadata(data.metadata ?? null);
      setRows(Array.isArray(data.data) ? data.data : []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDecemberFetch = async () => {
    setDecemberLoading(true);
    setDecemberError(null);
    setDecemberRows([]);
    setDecemberMetadata(null);

    const params = new URLSearchParams({
      year: decemberYear,
      month: "12",
      limit: decemberLimit,
    });

    try {
      const response = await fetch(`${backendUrl}/api/mailcheck/december?${params.toString()}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Errore nella chiamata all'API December");
      }
      const payload = await response.json();
      if (!payload.success) {
        throw new Error(payload.error || "Richiesta fallita");
      }
      setDecemberMetadata(payload.metadata ?? null);
      setDecemberRows(Array.isArray(payload.data) ? payload.data : []);
    } catch (err) {
      setDecemberError((err as Error).message);
    } finally {
      setDecemberLoading(false);
    }
  };

  const resendKey = (row: DecemberRow) => `${row.idUser}-${row.idCourse}`;

  const handleResend = async (row: DecemberRow) => {
    const key = resendKey(row);
    setResendStatus((prev) => ({ ...prev, [key]: "" }));
    setResendLoading((prev) => ({ ...prev, [key]: true }));

    try {
      const response = await fetch(`${backendUrl}/api/corsi/reinvia-mail`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          db: "forma4",
          iduser: row.idUser,
          idcourse: row.idCourse,
          nome: row.nome,
          cognome: row.cognome,
          email: row.email,
          userid: row.userid,
          courseName: row.courseName,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Errore nel reinvio");
      }

      const payload = await response.json();
      setResendStatus((prev) => ({ ...prev, [key]: payload.message || "Mail inviata" }));
    } catch (err) {
      setResendStatus((prev) => ({ ...prev, [key]: (err as Error).message }));
    } finally {
      setResendLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-xl shadow border p-6 space-y-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Controllo email di benvenuto
          </p>
          <h1 className="text-2xl font-bold text-gray-800">Verifica invii Brevo</h1>
          <p className="text-sm text-gray-600">
            Inserisci l’email dell’utente per sapere se Brevo ha inviato un messaggio con oggetto “Benvenuto
            …”.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-gray-500">Email (obbligatoria)</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => handleChange("email", event.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="mario.rossi@example.com"
              required
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-500">Nome</span>
            <input
              value={form.nome}
              onChange={(event) => handleChange("nome", event.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Mario"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-500">Cognome</span>
            <input
              value={form.cognome}
              onChange={(event) => handleChange("cognome", event.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Rossi"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-500">Oggetto (facoltativo)</span>
            <input
              value={form.subject}
              onChange={(event) => handleChange("subject", event.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Benvenuto Mario Rossi"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-500">Dal (YYYY-MM-DD)</span>
            <input
              value={form.start}
              onChange={(event) => handleChange("start", event.target.value)}
              type="date"
              className="mt-1 w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-500">Al (YYYY-MM-DD)</span>
            <input
              value={form.end}
              onChange={(event) => handleChange("end", event.target.value)}
              type="date"
              className="mt-1 w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-500">Limite righe</span>
            <input
              value={form.limit}
              onChange={(event) => handleChange("limit", event.target.value)}
              type="number"
              min={1}
              max={200}
              className="mt-1 w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </label>
        </form>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={loading || !canSubmit}
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {loading ? "Verifico..." : "Controlla email"}
          </button>
        </div>
        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl shadow border p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">Risultati</h2>
          <p className="text-sm text-gray-500">
            {metadata
              ? `Filtrati ${metadata.returned} messaggi, ${metadata.totalAvailable} disponibili.`
              : "Ancora nessuna chiamata API eseguita."}
          </p>
        </div>

        {metadata && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-600">
              <p className="font-semibold text-gray-800">Intervallo</p>
              <p>{metadata.filters.range.start} → {metadata.filters.range.end}</p>
              <p className="text-xs text-gray-500">limite {metadata.filters.limit}</p>
            </div>
            <div className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-600">
              <p className="font-semibold text-gray-800">Soggetto cercato</p>
              <p>{metadata.filters.subject}</p>
              <p className="text-xs text-gray-500">BCC previsto: {metadata.requiredBcc}</p>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-2 py-2">Data</th>
                <th className="px-2 py-2">Soggetto</th>
                <th className="px-2 py-2">Mittente</th>
                <th className="px-2 py-2">Tags / UUID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                    {loading ? "Sto caricando…" : "Nessun invio registrato per questa email."}
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={`${row.email}-${row.uuid ?? row.messageId}`}>
                  <td className="px-2 py-3 font-medium text-gray-700">{formatDate(row.date)}</td>
                  <td className="px-2 py-3 text-gray-600">{row.subject}</td>
                  <td className="px-2 py-3 text-gray-600">{row.from || "—"}</td>
                  <td className="px-2 py-3 text-gray-500">
                    <div className="text-xs text-gray-400">{row.messageId}</div>
                    <div className="text-xs text-gray-400">{row.uuid}</div>
                    {row.tags.length > 0 && (
                      <div className="text-xs text-gray-500">Tags: {row.tags.join(", ")}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white rounded-xl shadow border p-6 space-y-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Lista iscritti dicembre
          </p>
          <h2 className="text-2xl font-bold text-gray-800">Controllo mail automatico</h2>
          <p className="text-sm text-gray-600">
            Recupera da `forma4` gli utenti iscritti a dicembre e fai il match con le email “Benvenuto …”
            inviate tramite Brevo.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-500">Anno</span>
            <input
              type="number"
              min={2010}
              max={2050}
              value={decemberYear}
              onChange={(event) => setDecemberYear(event.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-500">Limite record</span>
            <input
              type="number"
              min={1}
              max={200}
              value={decemberLimit}
              onChange={(event) => setDecemberLimit(event.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </label>
          <div className="flex items-end justify-end">
            <button
              type="button"
              onClick={handleDecemberFetch}
              disabled={decemberLoading}
              className="inline-flex items-center gap-2 rounded-full bg-amber-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:cursor-not-allowed disabled:bg-amber-300"
            >
              {decemberLoading ? "Caricamento…" : "Carica Dicembre"}
            </button>
          </div>
        </div>
        {decemberError && (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {decemberError}
          </div>
        )}
        {decemberMetadata && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-600">
              <p className="font-semibold text-gray-800">Range</p>
              <p>
                {decemberMetadata.range.start} → {decemberMetadata.range.end}
              </p>
              <p className="text-xs text-gray-500">Anno {decemberMetadata.year}</p>
            </div>
            <div className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-600">
              <p className="font-semibold text-gray-800">Totale utenti</p>
              <p>
                {decemberMetadata.totalUsers} trovati · {decemberMetadata.matched} match
              </p>
              <p className="text-xs text-gray-500">
                {decemberMetadata.uniqueEmails} email controllate
              </p>
            </div>
            <div className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-600">
              <p className="font-semibold text-gray-800">Brevo</p>
              <p>{decemberMetadata.brevoRequests} richieste</p>
              <p className="text-xs text-gray-500">BCC atteso: {decemberMetadata.expectedBcc}</p>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-2 py-2">Nome</th>
                <th className="px-2 py-2">Email</th>
                <th className="px-2 py-2">Corso</th>
                <th className="px-2 py-2">Iscrizione</th>
                <th className="px-2 py-2">Match Brevo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {decemberRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                    {decemberLoading
                      ? "Caricamento degli iscritti di dicembre…"
                      : "Clicca su «Carica Dicembre» per richiamare gli iscritti di dicembre."}
                  </td>
                </tr>
              )}
              {decemberRows.map((row) => (
                <tr key={`${row.idUser}-${row.courseCode}-${row.dateInscr}`}>
                  <td className="px-2 py-3 font-medium text-gray-700">
                    {row.nome} {row.cognome}
                  </td>
                  <td className="px-2 py-3 text-gray-600">{row.email || "—"}</td>
                  <td className="px-2 py-3 text-gray-600">
                    <div>{row.courseCode}</div>
                    <div className="text-xs text-gray-500">{row.courseName}</div>
                  </td>
                  <td className="px-2 py-3 text-gray-600">{formatDate(row.dateInscr)}</td>
                  <td className="px-2 py-3 text-gray-600">
                    {row.brevoMatch ? (
                      <div className="space-y-0.5">
                        <span className="text-xs font-semibold uppercase tracking-wide text-green-600">
                          Trovato
                        </span>
                        <div className="text-xs text-gray-500">{row.brevoMatch.subject}</div>
                        <div className="text-[11px] text-gray-400">
                          {formatDate(row.brevoMatch.date)}
                        </div>
                        {row.brevoMatch.tags.length > 0 && (
                          <div className="text-[11px] text-gray-400">
                            Tag: {row.brevoMatch.tags.join(", ")}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-red-600">
                          Non trovato
                        </span>
                        <button
                          type="button"
                          onClick={() => handleResend(row)}
                          disabled={resendLoading[resendKey(row)]}
                          className="rounded-full border border-amber-500 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-600 transition hover:bg-amber-100 disabled:opacity-60"
                        >
                          {resendLoading[resendKey(row)] ? "Reinvio..." : "Reinvia mail"}
                        </button>
                        {resendStatus[resendKey(row)] && (
                          <div className="text-[11px] text-gray-500">
                            {resendStatus[resendKey(row)]}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
