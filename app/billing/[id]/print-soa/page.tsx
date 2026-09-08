"use client";

import React, { useEffect } from "react";
import { useParams } from "next/navigation";
import { useConcessionaire } from "@/lib/firebase/useConcessionaires";
import { monthSortKey, paymentStatus, PAYMENT_STATUS_STYLES, daysOverdue } from "@/lib/billing";
import { formatPeso, getFullName } from "@/lib/utils";

/**
 * Printable Statement of Account for a concessionaire's water bill —
 * mirrors the layout already established by app/connections/[id]/print-soa
 * (connection fee SOA) and app/collections/[id]/print-receipt, so every
 * printed document in the app looks and behaves the same way: opened in a
 * hidden iframe by the caller, auto-triggers window.print() once data
 * loads, and relies on the shared AppShell's print:hidden sidebar/topnav.
 */
export default function PrintWaterBillSOAPage() {
  const { id } = useParams<{ id: string }>();
  const { concessionaire, loading } = useConcessionaire(id);

  useEffect(() => {
    if (!loading && concessionaire) {
      setTimeout(() => {
        window.print();
      }, 500);
    }
  }, [loading, concessionaire]);

  if (loading || !concessionaire) {
    return <div className="p-8 text-center text-sm font-medium text-slate-500">Loading SOA...</div>;
  }

  // Chronological — oldest first, like a bank statement — rather than the
  // newest-first order the on-screen billing history table uses.
  const bills = [...(concessionaire.billingHistory || [])].sort(
    (a, b) => monthSortKey(a.month) - monthSortKey(b.month)
  );

  const totalBilled = bills.reduce((sum, b) => sum + b.pesoAmount, 0);
  const totalPaid = bills.reduce((sum, b) => sum + b.amountPaid, 0);

  return (
    <div className="bg-white text-black min-h-screen p-8 max-w-[800px] mx-auto print:p-0 print:m-0 print:shadow-none font-sans">
      <div className="border border-slate-800 p-8">
        {/* Header */}
        <div className="text-center border-b border-slate-800 pb-6 mb-6">
          <h1 className="text-2xl font-bold uppercase tracking-widest mb-1">South Wao Water System</h1>
          <p className="text-xs font-medium text-slate-500">Wao, Lanao del Sur • Tel: 0985 762 5456</p>
          <p className="text-sm font-medium text-slate-600 uppercase mt-2">Statement of Account (Water Bill)</p>
          <p className="text-xs font-medium text-slate-400 mt-2">
            Date Generated: {new Date().toLocaleDateString()}
          </p>
        </div>

        {/* Account Info */}
        <div className="mb-8 border border-slate-200 p-4 rounded bg-slate-50">
          <p className="text-xs font-bold uppercase text-slate-500 mb-1">Account Information</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-bold text-slate-800">
                Name: <span className="font-medium text-slate-700 ml-2">{getFullName(concessionaire)}</span>
              </p>
              <p className="text-sm font-bold text-slate-800 mt-1">
                Barangay:{" "}
                <span className="font-medium text-slate-700 ml-2">
                  {concessionaire.barangay === "CG" ? "Cebuano Group" : concessionaire.barangay}
                </span>
              </p>
              <p className="text-sm font-bold text-slate-800 mt-1">
                Purok: <span className="font-medium text-slate-700 ml-2">{concessionaire.purok}</span>
              </p>
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">
                Meter #: <span className="font-medium text-slate-700 ml-2">{concessionaire.meterNumber || "N/A"}</span>
              </p>
              <p className="text-sm font-bold text-slate-800 mt-1">
                Class: <span className="font-medium text-slate-700 ml-2">{concessionaire.classification || "N/A"}</span>
              </p>
              <p className="text-sm font-bold text-slate-800 mt-1">
                Status: <span className="font-medium text-slate-700 ml-2">{concessionaire.status || "CONNECTED"}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Billing History */}
        <div className="mb-8">
          <p className="text-sm font-bold uppercase tracking-wider text-slate-800 border-b border-slate-800 pb-2 mb-4">
            Billing History
          </p>
          {bills.length === 0 ? (
            <p className="text-sm text-slate-500 italic py-4">No billing history recorded.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-slate-600">
                  <th className="py-2 text-left font-semibold">Month</th>
                  <th className="py-2 text-right font-semibold">Amount Due</th>
                  <th className="py-2 text-right font-semibold">Amount Paid</th>
                  <th className="py-2 text-right font-semibold">Balance</th>
                  <th className="py-2 text-center font-semibold">Status</th>
                  <th className="py-2 text-right font-semibold">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b, i) => {
                  const status = paymentStatus(b.pesoAmount, b.amountPaid);
                  const balance = b.pesoAmount - b.amountPaid;
                  const overdueDays = status !== "PAID" ? daysOverdue(b.billingDate) : null;
                  return (
                    <tr key={`${b.month}-${i}`} className="border-b border-slate-100">
                      <td className="py-2">{b.month}</td>
                      <td className="py-2 text-right font-medium">{formatPeso(b.pesoAmount)}</td>
                      <td className="py-2 text-right">{formatPeso(b.amountPaid)}</td>
                      <td className="py-2 text-right font-medium">
                        {balance > 0 ? formatPeso(balance) : "—"}
                      </td>
                      <td className="py-2 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${PAYMENT_STATUS_STYLES[status]}`}
                        >
                          {status}
                        </span>
                      </td>
                      <td className="py-2 text-right text-xs text-slate-500">
                        {overdueDays !== null && overdueDays > 0 ? `${overdueDays}d` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Final Summary */}
        <div className="border-t-4 border-slate-800 pt-6 mt-8 flex justify-end">
          <table className="w-64 text-sm">
            <tbody>
              <tr>
                <td className="py-1 font-bold text-slate-600">Total Billed:</td>
                <td className="py-1 text-right font-bold">{formatPeso(totalBilled)}</td>
              </tr>
              <tr>
                <td className="py-1 font-bold text-slate-600">Total Paid:</td>
                <td className="py-1 text-right font-bold text-emerald-600">{formatPeso(totalPaid)}</td>
              </tr>
              <tr className="border-t border-slate-300">
                <td className="py-2 font-bold text-lg uppercase">Balance Due:</td>
                <td className="py-2 text-right font-bold text-xl">{formatPeso(concessionaire.billingBalance)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Hide this in print mode */}
      <div className="mt-8 text-center print:hidden">
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-sky-600 text-white rounded-md font-semibold text-sm hover:bg-sky-700 transition-colors"
        >
          Print Again
        </button>
      </div>
    </div>
  );
}
