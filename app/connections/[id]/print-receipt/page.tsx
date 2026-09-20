"use client";

import { useParams, useSearchParams } from "next/navigation";
import { PrintPage } from "@/components/print/PrintHost";
import { ConnectionFeeReceipt } from "@/components/print/documents";

/**
 * A connection fee receipt on a page of its own, for opening directly. The
 * console prints receipts in place (printDocument) without loading this route.
 */
export default function PrintReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const paymentIndex = parseInt(useSearchParams().get("index") || "0", 10);
  return (
    <PrintPage>
      <ConnectionFeeReceipt concessionaireId={id} paymentIndex={paymentIndex} />
    </PrintPage>
  );
}
