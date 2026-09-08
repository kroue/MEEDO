"use client";

import React, { useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useConcessionaire } from "@/lib/firebase/useConcessionaires";
import { formatPeso, getFullName } from "@/lib/utils";

/**
 * Printable water bill payment receipt — mirrors the layout already
 * established by app/connections/[id]/print-receipt (connection fee
 * receipts), so both kinds of receipt look and behave the same way: opened
 * in a hidden iframe by the caller, auto-triggers window.print() once data
 * loads, and relies on the shared AppShell's print:hidden sidebar/topnav.
 *
 * Looked up by `or` (the payment's OR number) rather than array index, since
 * that's stable even if another payment lands in between.
 */
export default function PrintPaymentReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const orNumber = searchParams.get("or") || "";

  const { concessionaire, loading } = useConcessionaire(id);

  useEffect(() => {
    if (!loading && concessionaire) {
      setTimeout(() => {
        window.print();
      }, 500); // Wait a bit for layout
    }
  }, [loading, concessionaire]);

  if (loading || !concessionaire) {
    return <div className="p-8 text-center text-sm font-medium text-slate-500">Loading receipt...</div>;
  }

  const payment = concessionaire.payments?.find((p) => p.orNumber === orNumber);

  if (!payment) {
    return <div className="p-8 text-center text-sm font-medium text-red-500">Payment record not found.</div>;
  }

  return (
    <div className="bg-white text-black min-h-screen p-8 max-w-[800px] mx-auto print:p-0 print:m-0 print:shadow-none font-sans">
      <div className="border border-slate-800 p-8">
        {/* Header */}
        <div className="text-center border-b border-slate-800 pb-6 mb-6">
          <h1 className="text-2xl font-bold uppercase tracking-widest mb-1">South Wao Water System</h1>
          <p className="text-xs font-medium text-slate-500">Wao, Lanao del Sur • Tel: 0985 762 5456</p>
          <p className="text-sm font-medium text-slate-600 uppercase mt-2">Water Bill Official Receipt</p>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-8 mb-8">
          <div>
            <p className="text-xs font-bold uppercase text-slate-500 mb-1">Received From</p>
            <p className="text-lg font-bold">{getFullName(concessionaire)}</p>
            <p className="text-sm">
              {concessionaire.barangay === "CG" ? "Cebuano Group" : concessionaire.barangay} • Purok {concessionaire.purok}
            </p>
            <p className="text-sm mt-1">
              Meter #: <strong>{concessionaire.meterNumber || "N/A"}</strong>
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase text-slate-500 mb-1">OR Number</p>
            <p className="text-xl font-mono font-bold text-slate-900">{payment.orNumber}</p>

            <p className="text-xs font-bold uppercase text-slate-500 mt-4 mb-1">Date</p>
            <p className="text-sm font-medium">
              {new Date(payment.date).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
        </div>

        {/* Payment Line Item */}
        <table className="w-full mb-8">
          <thead>
            <tr className="border-b-2 border-slate-800">
              <th className="text-left py-2 text-sm uppercase tracking-wider font-bold">Description</th>
              <th className="text-right py-2 text-sm uppercase tracking-wider font-bold">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-200">
              <td className="py-4 text-base font-medium">Water Bill Payment</td>
              <td className="py-4 text-right text-lg font-bold">{formatPeso(payment.amount)}</td>
            </tr>
          </tbody>
        </table>

        {/* Footer Totals */}
        <div className="flex justify-between items-end border-t border-slate-800 pt-6">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase text-slate-500">
              Balance Before: <span className="text-slate-900 ml-2">{formatPeso(payment.balanceBefore)}</span>
            </p>
            <p className="text-xs font-bold uppercase text-slate-500">
              Balance After: <span className="text-slate-900 ml-2">{formatPeso(payment.balanceAfter)}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase text-slate-500 mb-1">Amount Paid</p>
            <p className="text-3xl font-bold">{formatPeso(payment.amount)}</p>
          </div>
        </div>

        {/* Signature Line */}
        <div className="mt-16 pt-8 border-t border-slate-200 w-64">
          <p className="text-xs font-bold uppercase text-slate-500 text-center">Authorized Signature</p>
          <p className="text-[10px] text-slate-400 text-center mt-1">Recorded by: {payment.recordedBy}</p>
        </div>
      </div>

      {/* Hide this in print mode */}
      <div className="mt-8 text-center print:hidden">
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-sky-600 text-white rounded-md font-semibold text-sm hover:bg-sky-700"
        >
          Print Again
        </button>
      </div>
    </div>
  );
}
