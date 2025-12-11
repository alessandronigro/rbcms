import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConv } from "@/context/ConvContext";

export default function Login() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const navigate = useNavigate();
  const { setConv } = useConv();
  const year = new Date().getFullYear();

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
    <div className="relative min-h-screen flex flex-col overflow-hidden bg-slate-950 text-white">
      <style>
        {`
        @keyframes moveGradient {
          0% { transform: translate3d(-20%, -20%, 0) scale(1); }
          50% { transform: translate3d(20%, 10%, 0) scale(1.1); }
          100% { transform: translate3d(-20%, -20%, 0) scale(1); }
        }
        @keyframes floatUp {
          0% { transform: translateY(0); opacity: 0.4; }
          50% { opacity: 0.8; }
          100% { transform: translateY(-40px); opacity: 0.2; }
        }
        @keyframes glowPulse {
          0%,100% { opacity: 0.3; }
          50% { opacity: 0.6; }
        }
      `}
      </style>

      {/* animated gradient background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900 via-slate-900 to-indigo-950 animate-[glowPulse_10s_ease-in-out_infinite]" />
        <div
          className="absolute -inset-1/2 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.35),_transparent_55%)] opacity-70"
          style={{ animation: "moveGradient 18s ease-in-out infinite" }}
        />
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(115deg, rgba(255,255,255,0.05) 0%, transparent 45%, rgba(255,255,255,0.05) 100%)",
            backgroundSize: "400% 400%",
            animation: "moveGradient 25s linear infinite",
          }}
        />
      </div>

      {/* floating particles */}
      {[...Array(12)].map((_, idx) => (
        <span
          key={idx}
          className="absolute w-2 h-2 bg-blue-300 rounded-full blur-sm"
          style={{
            top: `${10 + (idx * 8) % 90}%`,
            left: `${(idx * 13) % 100}%`,
            animation: `floatUp ${10 + (idx % 5)}s ease-in-out infinite`,
            animationDelay: `${idx * 0.6}s`,
          }}
        />
      ))}

      {/* content */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="text-center mb-10 space-y-2">
          <p className="text-sm uppercase tracking-[0.3em] text-blue-200">Accesso convenzioni</p>
          <h1 className="text-3xl sm:text-4xl font-semibold">
            RB CONSULTING <span className="text-blue-300">Portal</span>
          </h1>
          <p className="text-base text-slate-200 max-w-lg">
            Gestisci reportistica, iscrizioni e strumenti dedicati alla tua convenzione in un’unica area riservata.
          </p>
        </div>

        <div className="w-full max-w-md bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl shadow-[0_20px_50px_rgba(15,23,42,0.6)] p-8 space-y-6">
          <div className="flex justify-center">
            <div className="p-3 rounded-full bg-white/10 border border-white/20">
              <img
                src="https://www.formazioneintermediari.com/wp-content/uploads/loro-rb.png"
                alt="Logo"
                className="h-12"
              />
            </div>
          </div>

          <div className="text-center space-y-1">
            <h2 className="text-2xl font-semibold text-white">Area riservata convenzioni</h2>
            <p className="text-sm text-blue-100">Inserisci il codice univoco fornito dal team RB Consulenza.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm text-blue-100 mb-1 block">Codice convenzione</label>
              <input
                placeholder="Es. 9999"
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder:text-white/60 focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                required
              />
            </div>

            {error && <div className="text-red-300 text-sm text-center bg-red-900/30 py-2 rounded-lg">{error}</div>}

            <button
              className="w-full bg-gradient-to-r from-blue-500 to-indigo-500 text-white py-3 rounded-xl font-semibold tracking-wide shadow-lg shadow-blue-900/40 hover:from-blue-400 hover:to-indigo-400 transition disabled:opacity-50"
              disabled={loading}
            >
              {loading ? "Accesso in corso…" : "Entra"}
            </button>
          </form>

          <div className="border-t border-white/10 pt-4 text-center text-sm text-blue-100 space-y-2">
            <p className="uppercase text-xs tracking-[0.2em] text-white/60">Assistenza dedicata</p>
            <p className="text-lg font-semibold text-white">800 69 99 92</p>
            <a href="mailto:supporto@formazioneintermediari.com" className="text-blue-200 underline">
              supporto@formazioneintermediari.com
            </a>
            <p className="text-xs text-white/60">Lun–Ven 9:00 – 18:00</p>
          </div>
        </div>
      </div>

      <footer className="relative z-10 text-center text-xs sm:text-sm text-blue-100 py-4 bg-slate-950/60 backdrop-blur">
        © {year} Formazione Intermediari •{" "}
        <a href="https://www.formazioneintermediari.com/privacy" className="underline hover:text-white">
          Privacy Policy
        </a>{" "}
        •{" "}
        <a href="mailto:info@formazioneintermediari.com" className="underline hover:text-white">
          Contatti
        </a>
      </footer>
    </div>
  );
}
