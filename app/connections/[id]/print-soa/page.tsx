"use client";

import { useParams } from "next/navigation";
import { PrintPage } from "@/components/print/PrintHost";
import { ConnectionFeeStatement } from "@/components/print/documents";

/**
 * A connection fee statement of account on a page of its own, for opening
 * directly. The console prints statements in place (printDocument) without
 * loading this route.
 */
export default function PrintSOAPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PrintPage>
      <ConnectionFeeStatement concessionaireId={id} />
    </PrintPage>
  );
}
