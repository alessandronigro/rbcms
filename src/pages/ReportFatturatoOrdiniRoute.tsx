import { useSearchParams } from "react-router-dom";
import Layout from "@/layouts/Layout";
import ProtectedAdmin from "@/components/ProtectedAdmin";
import ReportFatturatoOrdini from "./ReportFatturatoOrdini";

export default function ReportFatturatoOrdiniRoute() {
  const [params] = useSearchParams();
  const cod = params.get("cod")?.trim();

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
