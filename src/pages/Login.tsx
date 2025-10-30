import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConv } from "@/context/ConvContext";

export default function Login() {
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const navigate = useNavigate();
    const { setConv } = useConv();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const res = await fetch("/api/auth/login", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code }),
            });

            const j = await res.json();
            if (!j.success) throw new Error(j.error || "Credenziali errate");

            // ✅ Se login ok, PRIMA carichiamo i dati utente reali
            const me = await fetch("/api/auth/me", {
                credentials: "include",
            }).then(r => r.json());

            if (!me.authenticated) throw new Error("Sessione non valida");

            setConv(me.user); // ✅ ora user è valido

            if (me.user.role === "admin") navigate("/");
            else navigate("/report");

        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
            <form onSubmit={handleSubmit} className="bg-white p-6 rounded shadow-md w-full max-w-xs space-y-3">

                <h1 className="text-lg font-semibold text-center">Accesso</h1>

                <input
                    placeholder="Codice"
                    className="w-full border rounded px-3 py-2"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                />

                {error && <div className="text-red-600 text-sm text-center">{error}</div>}

                <button
                    className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
                    disabled={loading}
                >
                    {loading ? "Accesso..." : "Entra"}
                </button>

            </form>
        </div>
    );
}