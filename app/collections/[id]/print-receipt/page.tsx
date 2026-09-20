"use client";

import { useParams, useSearchParams } from "next/navigation";
import { PrintPage } from "@/components/print/PrintHost";
import { PaymentReceipt } from "@/components/print/documents";

/**
 * A water bill receipt on a page of its own, for opening directly. The console
 * prints receipts in place (printDocument) without loading this route.
 */
export default function PrintPaymentReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const orNumber = useSearchParams().get("or") || "";
  return (
    <PrintPage>
      <PaymentReceipt concessionaireId={id} orNumber={orNumber} />
    </PrintPage>
  );
}
