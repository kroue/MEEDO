"use client";

import { useParams } from "next/navigation";
import { PrintPage } from "@/components/print/PrintHost";
import { WaterBillStatement } from "@/components/print/documents";

/**
 * A water bill statement of account on a page of its own, for opening
 * directly. The console prints statements in place (printDocument) without
 * loading this route.
 */
export default function PrintWaterBillSOAPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PrintPage>
      <WaterBillStatement concessionaireId={id} />
    </PrintPage>
  );
}
