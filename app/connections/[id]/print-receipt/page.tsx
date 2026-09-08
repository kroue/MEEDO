"use client";

import React, { useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useConcessionaire } from "@/lib/firebase/useConcessionaires";
import { formatPeso, getFullName } from "@/lib/utils";

export default function PrintReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const paymentIndex = parseInt(searchParams.get("index") || "0", 10);
  
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

  const payment = concessionaire.meterPayments?.[paymentIndex];
  
  if (!payment) {
    return <div className="p-8 text-center text-sm font-medium text-red-500">Payment record not found.</div>;
  }

  const totalFee = concessionaire.connectionFeeDetails?.total || 0;
  // Calculate remaining balance after this specific payment by summing all payments up to this index
  const paymentsUpToThis = concessionaire.meterPayments.slice(0, paymentIndex + 1);
  const totalPaidSoFar = paymentsUpToThis.reduce((sum, p) => sum + p.amount, 0);
  const remainingBalance = Math.max(0, totalFee - totalPaidSoFar);

  return (
    <div className="bg-white text-black min-h-screen p-8 max-w-[800px] mx-auto print:p-0 print:m-0 print:shadow-none font-sans">
      <div className="border border-slate-800 p-8">
        {/* Header */}
        <div className="text-center border-b border-slate-800 pb-6 mb-6">
          <h1 className="text-2xl font-bold uppercase tracking-widest mb-1">Water Billing Admin</h1>
          <p className="text-sm font-medium text-slate-600 uppercase">Connection Fee Official Receipt</p>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-8 mb-8">
          <div>
            <p className="text-xs font-bold uppercase text-slate-500 mb-1">Received From</p>
            <p className="text-lg font-bold">{getFullName(concessionaire)}</p>
            <p className="text-sm">{concessionaire.barangay === "CG" ? "Cebuano Group" : concessionaire.barangay} • Purok {concessionaire.purok}</p>
            <p className="text-sm mt-1">Meter #: <strong>{concessionaire.meterNumber || "N/A"}</strong></p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase text-slate-500 mb-1">OR Number</p>
            <p className="text-xl font-mono font-bold text-slate-900">{payment.orNumber}</p>
            
            <p className="text-xs font-bold uppercase text-slate-500 mt-4 mb-1">Date</p>
            <p className="text-sm font-medium">
              {payment.date ? new Date(payment.date).toLocaleDateString(undefined, {
                year: 'numeric', month: 'long', day: 'numeric'
              }) : new Date().toLocaleDateString()}
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
              <td className="py-4 text-base font-medium">
                Connection Fee - {payment.slot === "Full" ? "Full Payment" : `${payment.slot} Installment`}
              </td>
              <td className="py-4 text-right text-lg font-bold">
                {formatPeso(payment.amount)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Footer Totals */}
        <div className="flex justify-between items-end border-t border-slate-800 pt-6">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase text-slate-500">Total Connection Fee: <span className="text-slate-900 ml-2">{formatPeso(totalFee)}</span></p>
            <p className="text-xs font-bold uppercase text-slate-500">Remaining Balance: <span className="text-slate-900 ml-2">{formatPeso(remainingBalance)}</span></p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase text-slate-500 mb-1">Amount Paid</p>
            <p className="text-3xl font-bold">{formatPeso(payment.amount)}</p>
          </div>
        </div>

        {/* Signature Line */}
        <div className="mt-16 pt-8 border-t border-slate-200 w-64">
          <p className="text-xs font-bold uppercase text-slate-500 text-center">Authorized Signature</p>
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
