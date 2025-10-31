import { Outlet } from "react-router-dom";
import TopNav from "./TopNav";

export default function Layout() {
  return (
    <div className="flex flex-col min-h-screen bg-gray-50 text-gray-800">
      <TopNav />
      <main className="flex-1 p-6 overflow-y-auto">
        <Outlet />
      </main>
      <footer className="bg-gray-100 border-t text-center py-3 text-xs text-gray-500">
        © {new Date().getFullYear()} RB Consulting S.r.l. — Tutti i diritti
        riservati.
      </footer>
    </div>
  );
}
