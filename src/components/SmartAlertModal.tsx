import { createContext, useContext, useState } from "react";

interface EnrollmentResult {
    nome?: string;
    cognome?: string;
    email?: string;
    pec?: string;
    bccEmail?: string;
    esitoIscrizione?: string;
    mailEsito?: string;
    bccEsito?: string;
    pecEsito?: string;
    note?: string;
    error?: string;
}

interface AlertOptions {
    title?: string;
    message?: string;
    type?: "success" | "error" | "warning" | "info" | "confirm";
    results?: EnrollmentResult[];
}

interface AlertState extends AlertOptions {
    open: boolean;
    resolve?: (value: void | PromiseLike<void>) => void;
    reject?: (reason?: unknown) => void;
    results?: EnrollmentResult[];
}

interface AlertContextValue {
    alert: (message: string, options?: Partial<AlertOptions>) => Promise<void>;
    confirm: (message: string, options?: Partial<AlertOptions>) => Promise<void>;
}

const AlertContext = createContext<AlertContextValue | null>(null);

export function AlertProvider({ children }: any) {
    const [modal, setModal] = useState<AlertState>({
        open: false,
        title: "",
        message: "",
        type: "info",
        results: [],
    });

    function alert(message: string, options: Partial<AlertOptions> = {}): Promise<void> {
        return new Promise<void>((resolve) => {
            setModal({
                open: true,
                title: options.title || "Avviso",
                message,
                type: options.type || "info",
                resolve,
                results: options.results || [],
            });
        });
    }

    function confirm(message: string, options: Partial<AlertOptions> = {}): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            setModal({
                open: true,
                title: options.title || "Conferma",
                message,
                type: "confirm",
                resolve,
                reject,
                results: options.results || [],
            });
        });
    }

    function close(type?: "ok" | "cancel") {
        if (type === "ok") modal.resolve?.(undefined);
        else modal.reject?.();
        setModal((m: any) => ({ ...m, open: false, results: [] }));
    }

    return (
        <AlertContext.Provider value={{ alert, confirm }}>
            {children}

            {modal.open && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
                    <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl text-center">

                        <h2 className="font-bold text-lg mb-4">
                            {modal.title}
                        </h2>

                        <div className="max-h-[70vh] overflow-y-auto text-left space-y-4">
                            {modal.message && (
                                <p className="text-gray-700 whitespace-pre-wrap">{modal.message}</p>
                            )}

                            {modal.results && modal.results.length > 0 && (
                                <div className="space-y-3">
                                    {modal.results.map((result, idx) => {
                                        const success = (result.esitoIscrizione || "").toLowerCase() === "ok" && !result.error;
                                        const fullName = [result.nome, result.cognome].filter(Boolean).join(" ") || result.email || `Corsista ${idx + 1}`;
                                        return (
                                            <div
                                                key={`${result.email || idx}-${idx}`}
                                                className={`rounded-lg border p-4 text-sm ${success ? "bg-green-50 border-green-200 text-green-900" : "bg-red-50 border-red-200 text-red-900"}`}
                                            >
                                                <p className="text-base font-semibold">{fullName}</p>
                                                <p className="mt-1">
                                                    Esito iscrizione:{" "}
                                                    <span className="font-semibold">
                                                        {result.esitoIscrizione || (result.error ? "KO" : "OK")}
                                                    </span>
                                                </p>
                                                {result.note && (
                                                    <p className="mt-1">Nota: {result.note}</p>
                                                )}
                                                {result.error && !result.note && (
                                                    <p className="mt-1">Errore: {result.error}</p>
                                                )}
                                                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                                                    <div className="rounded border border-current px-2 py-1">
                                                        <p className="font-semibold">Email</p>
                                                        <p className="truncate">{result.email || "—"}</p>
                                                        <p className="font-semibold mt-1">Esito: {result.mailEsito || "N/A"}</p>
                                                    </div>
                                                    <div className="rounded border border-current px-2 py-1">
                                                        <p className="font-semibold">PEC</p>
                                                        <p className="truncate">{result.pec || "—"}</p>
                                                        <p className="font-semibold mt-1">Esito: {result.pecEsito || "N/A"}</p>
                                                    </div>
                                                    <div className="rounded border border-current px-2 py-1">
                                                        <p className="font-semibold">BCC</p>
                                                        <p className="truncate">{result.bccEmail || "—"}</p>
                                                        <p className="font-semibold mt-1">Esito: {result.bccEsito || "N/A"}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="flex justify-center gap-3 mt-6">
                            {modal.type === "confirm" ? (
                                <>
                                    <button
                                        onClick={() => close("cancel")}
                                        className="px-4 py-1 rounded bg-gray-200"
                                    >
                                        Annulla
                                    </button>
                                    <button
                                        onClick={() => close("ok")}
                                        className="px-4 py-1 rounded bg-blue-600 text-white"
                                    >
                                        Conferma
                                    </button>
                                </>
                            ) : (
                                <button
                                    onClick={() => close("ok")}
                                    className="px-4 py-1 rounded bg-blue-600 text-white"
                                >
                                    OK
                                </button>
                            )}
                        </div>

                    </div>
                </div>
            )}
        </AlertContext.Provider>
    );
}

export function useAlert(): AlertContextValue {
    const context = useContext(AlertContext);
    if (!context) {
        throw new Error("useAlert must be used within an AlertProvider");
    }
    return context;
}
