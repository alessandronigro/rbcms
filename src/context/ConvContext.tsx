import React, { createContext, useContext, useEffect, useState } from "react";

interface ConvSession {
    authenticated: boolean;
    role: "admin" | "conv";
    code: string;
    nome_convenzione: string;
    piattaforma: string;
    host: string;
    logoUrl?: string;
}

const ConvContext = createContext<{
    conv: ConvSession | null;
    loading: boolean;
    setConv: (v: ConvSession | null) => void;
} | null>(null);

export function ConvProvider({ children }: { children: React.ReactNode }) {
    const [conv, setConv] = useState<ConvSession | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch("/api/auth/me", { credentials: "include" })
            .then(r => r.json())
            .then(j => {
                console.log(j);
                if (j.authenticated && j.user) setConv(j.user);
                else setConv(null);
            })
            .finally(() => setLoading(false));
    }, []);

    return (
        <ConvContext.Provider value={{ conv, loading, setConv }}>
            {children}
        </ConvContext.Provider>
    );
}
export const useConv = () => {
    const ctx = useContext(ConvContext);
    if (!ctx) throw new Error("useConv must be within ConvProvider");
    return ctx;
};