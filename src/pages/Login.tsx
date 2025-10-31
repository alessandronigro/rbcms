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

      const me = await fetch("/api/auth/me", { credentials: "include" }).then((r) => r.json());
      if (!me.authenticated) throw new Error("Sessione non valida");

      setConv(me.user);
      if (me.user.role === "admin") navigate("/");
      else navigate("/report");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col justify-between bg-cover bg-center"
      style={{
        backgroundImage: "url('/images/bg-login.jpg')", // 📸 metti qui la tua immagine
      }}
    >
      {/* Overlay scuro per contrasto */}
      <div className="absolute inset-0 bg-black bg-opacity-50" />

      {/* Contenuto principale */}
      <div className="relative flex flex-col items-center justify-center flex-grow p-4 z-10">
        <div className="bg-white/80 backdrop-blur-md shadow-xl rounded-2xl p-8 w-full max-w-sm border border-gray-200">
          {/* Logo o immagine */}
          <div className="flex justify-center mb-4">
            <img
              src="https://www.formazioneintermediari.com/wp-content/uploads/loro-rb.png"
              alt="Logo"
              className="h-12"
            />
          </div>

          <h1 className="text-xl font-semibold text-center text-gray-800 mb-4">
            Accesso Riservato
          </h1>

          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              placeholder="Codice convenzione"
              className="w-full border border-gray-300 rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />

            {error && (
              <div className="text-red-600 text-sm text-center">{error}</div>
            )}

            <button
              className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 transition disabled:opacity-50"
              disabled={loading}
            >
              {loading ? "Accesso..." : "Entra"}
            </button>
          </form>

          {/* Assistenza */}
          <div className="mt-5 text-center text-sm text-gray-700 space-y-1">
            <p>📞 Assistenza clienti</p>
            <p>
              <strong>+39 081 123 4567</strong> <br />
              <strong>+39 333 743 3153</strong>
            </p>
            <p className="text-xs text-gray-500">Lun–Ven 9:00–18:00</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="relative z-10 bg-black/50 text-white text-center text-sm py-3">
        © {new Date().getFullYear()} Formazione Intermediari •{" "}
        <a href="https://www.formazioneintermediari.com/privacy" className="underline hover:text-gray-300">
          Privacy Policy
        </a>{" "}
        •{" "}
        <a href="mailto:info@formazioneintermediari.com" className="underline hover:text-gray-300">
          Contatti
        </a>
      </footer>
    </div>
  );
}