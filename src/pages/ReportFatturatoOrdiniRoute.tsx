import { useSearchParams } from "react-router-dom";
import Layout from "@/layouts/Layout";
import ProtectedAdmin from "@/components/ProtectedAdmin";
import ReportFatturatoOrdini from "./ReportFatturatoOrdini";

export default function ReportFatturatoOrdiniRoute() {
  const [params] = useSearchParams();
  const codFromParams = params.get("cod");
  const codFromLocation =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("cod")
      : null;
  const cod = (codFromParams || codFromLocation || "").trim();
  console.log("[fatturato-ordini] cod param:", {
    codFromParams,
    codFromLocation,
    cod,
    href: typeof window !== "undefined" ? window.location.href : "",
  });

  if (cod) {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-800">
        <ReportFatturatoOrdini />
      </div>
    );
  }

  return (
    <ProtectedAdmin>
      <Layout>
        <ReportFatturatoOrdini />
      </Layout>
    </ProtectedAdmin>
  );
}
