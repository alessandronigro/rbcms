import { Navigate, useLocation } from "react-router-dom";
import { useConv } from "@/context/ConvContext";

export default function ProtectedConv({ children }: { children: JSX.Element }) {
  const { conv, loading } = useConv();
  const location = useLocation();

  if (loading) {
    return (
      <div className="p-6 text-center text-gray-600">Verifica sessione…</div>
    );
  }

  if (!conv?.authenticated) {
    return <Navigate to={`/login${location.search}`} replace />;
  }

  if (conv.role !== "conv") {
    return <Navigate to="/" replace />;
  }

  return children;
}
