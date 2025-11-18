import { useState } from "react";
import { LogOut } from "lucide-react";
import MultiDropdown from "@/components/MultiDropDown";

export default function TopNav() {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (key: string) => setOpen(open === key ? null : key);

  const logoutAdmin = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });

    window.location.href = "/login";
  };
  return (
    <header className="bg-white border-b shadow-sm">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
        {/* LOGO */}
        <div className="flex items-center gap-2">
          <i className="fa fa-cog text-blue-600"></i>
          <span className="font-semibold text-gray-700">
            {" "}
            <a href="/">RB Technology</a>
          </span>
        </div>

        {/* MENU */}
        <nav className="hidden md:flex gap-6 text-sm font-medium">
          <a href="/convenzioni" className="hover:text-blue-600">
            Convenzioni
          </a>
          <a href="/iscrizioni" className="hover:text-blue-600">
            Iscrizioni
          </a>

          <a href="/template" className="hover:text-blue-600">
            Template
          </a>
          <a href="/finecorso" className="hover:text-blue-600">
            Fine Corso
          </a>

          <MultiDropdown
            label="Report"
            open={open === "report"}
            onToggle={() => toggle("report")}
            items={[
              { label: "Fatturato acquisti sito", href: "/report/fatturato" },

              {
                label: "Questionario di gradimento",
                href: "/report/questionari",
              },

            ]}
          />

          <MultiDropdown
            label="Calendario"
            open={open === "calendario"}
            onToggle={() => toggle("calendario")}
            items={[
              {
                label: "60h",
                subitems: [
                  { label: "Sessioni", href: "/calendario/60h/sessioni" },

                  { label: "Fine Corso", href: "/calendario/60h/finecorso" },
                ],
              },

              {
                label: "Amm",
                subitems: [
                  { label: "Sessioni", href: "/calendario/amm/sessioni" },

                  { label: "Fine corso", href: "/calendario/amm/finecorso" },
                ],
              },
              {
                label: "Slot pubblici",
                href: "/calendario/slot-config",
              },

            ]}
          />

          <MultiDropdown
            label="Fatture"
            open={open === "fatture"}
            onToggle={() => toggle("fatture")}
            items={[
              { label: "Fatture ricevute", href: "/fatture/ricevute" },
              { label: "Fatture ricevute RB", href: "/fatture/ricevutenew" },
            ]}
          />

          <a href="/utenti" className="hover:text-blue-600">
            Utenti
          </a>
        </nav>

        {/* UTENTE */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Benvenuto, Admin</span>
          <LogOut
            size={18}
            onClick={logoutAdmin}
            className="text-gray-500 hover:text-red-500 cursor-pointer"
          />
        </div>
      </div>
    </header>
  );
}
