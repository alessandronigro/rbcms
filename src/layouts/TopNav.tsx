import { useState } from "react";
import { LogOut } from "lucide-react";
import MultiDropdown from "@/components/MultiDropDown";

type DesktopMenuItem = {
  label: string;
  href?: string;
  subitems?: { label: string; href: string }[];
};

const NAV_LINKS: DesktopMenuItem[] = [
  { label: "Convenzioni", href: "/convenzioni" },
  { label: "Iscrizioni", href: "/iscrizioni" },
  { label: "Template", href: "/template" },
  { label: "Fine Corso", href: "/finecorso" },
  { label: "Utenti", href: "/utenti" },
];

const REPORT_ITEMS: DesktopMenuItem[] = [
  { label: "Fatturato acquisti sito", href: "/report/fatturato" },
  { label: "Questionario di gradimento", href: "/report/questionari" },
  { label: "Reminder", href: "/reminder" },
  { label: "Fatturato ordini", href: "/report/fatturato-ordini" },
];

const CALENDARIO_ITEMS: DesktopMenuItem[] = [
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
];

const FATTURE_ITEMS: DesktopMenuItem[] = [
  { label: "Fatture ricevute", href: "/fatture/ricevute" },
  { label: "Fatture ricevute RB", href: "/fatture/ricevutenew" },
];

export default function TopNav() {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (key: string) => setOpen(open === key ? null : key);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const toggleMobileMenu = () => setMobileMenuOpen((prev) => !prev);
  const closeMobileMenu = () => setMobileMenuOpen(false);

  const logoutAdmin = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });

    window.location.href = "/login";
  };
  const renderMobileDropdownItems = (items: DesktopMenuItem[]) =>
    items.map((item) =>
      item.subitems ? (
        <div key={item.label}>
          <p className="text-[11px] uppercase tracking-wide text-gray-500 px-2">
            {item.label}
          </p>
          <div className="pl-2 space-y-1">
            {item.subitems.map((subitem) => (
              <a
                key={subitem.label}
                href={subitem.href}
                className="block px-2 py-1 rounded hover:bg-gray-100"
                onClick={closeMobileMenu}
              >
                {subitem.label}
              </a>
            ))}
          </div>
        </div>
      ) : (
        <a
          key={item.label}
          href={item.href ?? "#"}
          className="block px-2 py-1 rounded hover:bg-gray-100"
          onClick={closeMobileMenu}
        >
          {item.label}
        </a>
      )
    );
  return (
    <header className="bg-white border-b shadow-sm">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
        {/* LOGO */}
        <div className="flex items-center gap-2">
          <a href="/" className="flex items-center gap-2">
            <img
              src="/images/rb-technology-logo.svg"
              alt="RB Technology"
              className="h-9 w-auto"
            />
            <span className="sr-only">RB Technology</span>
          </a>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Apri menu mobile"
            aria-expanded={mobileMenuOpen}
            onClick={toggleMobileMenu}
            className="md:hidden text-gray-600 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
          >
            {mobileMenuOpen ? (
              <svg
                className="w-6 h-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg
                className="w-6 h-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>

          {/* MENU */}
          <nav className="hidden md:flex gap-6 text-sm font-medium">
            {NAV_LINKS.map((link) => (
              <a key={link.label} href={link.href} className="hover:text-blue-600">
                {link.label}
              </a>
            ))}

            <MultiDropdown
              label="Report"
              open={open === "report"}
              onToggle={() => toggle("report")}
              items={REPORT_ITEMS}
            />

            <MultiDropdown
              label="Calendario"
              open={open === "calendario"}
              onToggle={() => toggle("calendario")}
              items={CALENDARIO_ITEMS}
            />

            <MultiDropdown
              label="Fatture"
              open={open === "fatture"}
              onToggle={() => toggle("fatture")}
              items={FATTURE_ITEMS}
            />
          </nav>
        </div>

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
      {mobileMenuOpen && (
        <div className="md:hidden border-t bg-white shadow-inner">
          <nav className="max-w-7xl mx-auto px-4 py-4 space-y-4 text-sm">
            <div className="space-y-1">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="block px-2 py-1 rounded hover:bg-gray-100"
                  onClick={closeMobileMenu}
                >
                  {link.label}
                </a>
              ))}
            </div>

            <div className="space-y-3 border-t border-gray-100 pt-3">
              {(
                [
                  ["Report", REPORT_ITEMS],
                  ["Calendario", CALENDARIO_ITEMS],
                  ["Fatture", FATTURE_ITEMS],
                ] as const
              ).map(([title, items]) => (
                <div key={title} className="space-y-1">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500 px-2">
                    {title}
                  </p>
                  <div className="space-y-1">{renderMobileDropdownItems(items)}</div>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600">
              <span>Benvenuto, Admin</span>
              <button
                type="button"
                onClick={() => {
                  closeMobileMenu();
                  logoutAdmin();
                }}
                className="flex items-center gap-1 text-gray-600 hover:text-red-600 focus:outline-none"
              >
                <LogOut size={16} />
                Esci
              </button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
