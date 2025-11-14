import React from "react";
import { useConv } from "@/context/ConvContext";

export default function ReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const conv = useConv();
  console.log(conv);
  if (!conv) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-600">
        Autenticazione…
      </div>
    );
  }

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 text-white px-4 py-2 flex justify-between items-center">
        <div className="flex items-center gap-3">
          {conv.conv?.logoUrl && (
            <img
              src={conv.conv.logoUrl}
              alt="Logo"
              className="h-9 w-auto object-contain"
            />
          )}
          <span>Benvenuto {conv.conv?.nome_convenzione}</span>
        </div>
        <button onClick={logout} className="text-sm underline">
          Esci
        </button>
      </header>

      {/* Content */}
      <main className="p-4">{children}</main>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-300 text-xs p-3 text-center">
        RB Consulting S.r.l. — P.I./C.F. 17044041006 — © 2011–2025 Tutti i
        diritti riservati
      </footer>
    </div>
  );
}
