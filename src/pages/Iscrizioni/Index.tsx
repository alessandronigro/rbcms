import { useState } from "react";
import IscrizioniSito from "./IscrizioniSito";
import IscrizioniAca from "./IscrizioniAca";
import IscrizioniNova from "./IscrizioniNova";
import IscrizioniExcel from "./IscrizioniExcel";

export default function IscrizioniIndex() {
  const [activeTab, setActiveTab] = useState<"sito" | "aca" | "nova" | "excel">(
    "sito",
  );

  const tabs = [
    { key: "sito", label: "Iscrizioni Sito" },
    { key: "aca", label: "Iscrizioni Aca" },
    { key: "nova", label: "Iscrizioni Nova" },
    { key: "excel", label: "Da Excel" },
  ];

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Gestione Iscrizioni</h1>

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key as any)}
            className={`px-4 py-2 text-sm rounded-t-md ${activeTab === t.key
                ? "bg-blue-600 text-white font-medium"
                : "bg-gray-100 hover:bg-gray-200"
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenuto tab */}
      <div className="mt-2">
        {activeTab === "sito" && <IscrizioniSito />}
        {activeTab === "aca" && <IscrizioniAca />}
        {activeTab === "nova" && <IscrizioniNova />}
        {activeTab === "excel" && <IscrizioniExcel />}
      </div>
    </div>
  );
}
