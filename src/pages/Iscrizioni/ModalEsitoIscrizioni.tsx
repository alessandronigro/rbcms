import React from "react";

interface EsitoItem {
  email?: string;
  error?: string;
}

interface Props {
  open: boolean;
  success: number;
  failed: number;
  failures: EsitoItem[];
  onClose: () => void;
}

export default function ModalEsitoIscrizione({
  open,
  success,
  failed,
  failures,
  onClose,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-xl p-5">
        <h2 className="text-lg font-semibold mb-3">📩 Esito Iscrizione</h2>

        <div className="text-sm text-gray-800 leading-relaxed">
          ✅ Iscrizioni riuscite: <b className="text-green-600">{success}</b> <br />
          ❌ Fallite: <b className="text-red-600">{failed}</b>
        </div>

        {failed > 0 && (
          <div className="mt-3 max-h-56 overflow-y-auto border rounded p-3 bg-red-50 text-sm space-y-1">
            {failures.map((f, i) => (
              <div key={i}>
                <span className="font-medium">{f.email}</span> → {f.error}
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 text-right">
          <button
            className="bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700 text-sm"
            onClick={onClose}
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}