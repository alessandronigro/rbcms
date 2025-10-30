import { Navigate } from "react-router-dom";
import { useConv } from "@/context/ConvContext";

export default function ProtectedConv({ children }: { children: JSX.Element }) {
    const { conv, loading } = useConv();

    if (loading) {
        return (
            <div className="p-6 text-center text-gray-600">
                Verifica sessione…
            </div>
        );
    }

    if (!conv?.authenticated) {
        return <Navigate to="/login" replace />;
    }

    if (conv.role !== "conv") {
        return <Navigate to="/" replace />;
    }

    return children;
}