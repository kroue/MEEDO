"use client";

import React, { useEffect } from "react";
import { useParams } from "next/navigation";
import { useConcessionaire } from "@/lib/firebase/useConcessionaires";
import { formatPeso, getFullName } from "@/lib/utils";

export default function PrintSOAPage() {
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

  const { connectionFeeDetails, meterPayments = [] } = concessionaire;

  if (!connectionFeeDetails) {
    return <div className="p-8 text-center text-sm font-medium text-red-500">No connection details found.</div>;
  }

  const totalPaid = meterPayments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="bg-white text-black min-h-screen p-8 max-w-[800px] mx-auto print:p-0 print:m-0 print:shadow-none font-sans">
      <div className="border border-slate-800 p-8">
        {/* Header */}
        <div className="text-center border-b border-slate-800 pb-6 mb-6">
          <h1 className="text-2xl font-bold uppercase tracking-widest mb-1">Water Billing Admin</h1>
          <p className="text-sm font-medium text-slate-600 uppercase">Statement of Account (Connection)</p>
          <p className="text-xs font-medium text-slate-400 mt-2">Date Generated: {new Date().toLocaleDateString()}</p>
        </div>

        {/* Details */}
        <div className="mb-8 border border-slate-200 p-4 rounded bg-slate-50">
          <p className="text-xs font-bold uppercase text-slate-500 mb-1">Account Information</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-bold text-slate-800">Name: <span className="font-medium text-slate-700 ml-2">{getFullName(concessionaire)}</span></p>
              <p className="text-sm font-bold text-slate-800 mt-1">Barangay: <span className="font-medium text-slate-700 ml-2">{concessionaire.barangay === "CG" ? "Cebuano Group" : concessionaire.barangay}</span></p>
              <p className="text-sm font-bold text-slate-800 mt-1">Purok: <span className="font-medium text-slate-700 ml-2">{concessionaire.purok}</span></p>
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">Meter #: <span className="font-medium text-slate-700 ml-2">{concessionaire.meterNumber || "N/A"}</span></p>
              <p className="text-sm font-bold text-slate-800 mt-1">Class: <span className="font-medium text-slate-700 ml-2">{concessionaire.classification || "N/A"}</span></p>
            </div>
          </div>
        </div>

        {/* Breakdown of Fees */}
        <div className="mb-8">
          <p className="text-sm font-bold uppercase tracking-wider text-slate-800 border-b border-slate-800 pb-2 mb-4">Fee Breakdown</p>
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-slate-100">
                <td className="py-2 text-slate-700">Water Meter</td>
                <td className="py-2 text-right font-medium">{formatPeso(connectionFeeDetails.waterMeter)}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-2 text-slate-700">Application Fee</td>
                <td className="py-2 text-right font-medium">{formatPeso(connectionFeeDetails.applicationFee)}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-2 text-slate-700">Inspection Fee</td>
                <td className="py-2 text-right font-medium">{formatPeso(connectionFeeDetails.inspectionFee)}</td>
              </tr>
              {connectionFeeDetails.otherPayables && connectionFeeDetails.otherPayables.length > 0 && (
                connectionFeeDetails.otherPayables.map((item, idx) => (
                  <tr key={idx} className="border-b border-slate-100">
                    <td className="py-2 text-slate-700">Other: {item.description || "Unspecified"}</td>
                    <td className="py-2 text-right font-medium">{formatPeso(item.amount)}</td>
                  </tr>
                ))
              )}
              <tr className="border-t-2 border-slate-800">
                <td className="py-3 font-bold uppercase text-slate-800">Total Fees</td>
                <td className="py-3 text-right font-bold text-base">{formatPeso(connectionFeeDetails.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Payment History */}
        <div className="mb-8">
          <p className="text-sm font-bold uppercase tracking-wider text-slate-800 border-b border-slate-800 pb-2 mb-4">Payment History</p>
          {meterPayments.length === 0 ? (
            <p className="text-sm text-slate-500 italic py-4">No payments recorded.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-slate-600">
                  <th className="py-2 text-left font-semibold">Date</th>
                  <th className="py-2 text-left font-semibold">OR Number</th>
                  <th className="py-2 text-left font-semibold">Installment</th>
                  <th className="py-2 text-right font-semibold">Amount Paid</th>
                </tr>
              </thead>
              <tbody>
                {meterPayments.map((p, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2">{p.date ? new Date(p.date).toLocaleDateString() : "—"}</td>
                    <td className="py-2 font-mono text-xs">{p.orNumber}</td>
                    <td className="py-2 uppercase text-xs tracking-wider">{p.slot}</td>
                    <td className="py-2 text-right font-medium">{formatPeso(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Final Summary */}
        <div className="border-t-4 border-slate-800 pt-6 mt-8 flex justify-end">
          <table className="w-64 text-sm">
            <tbody>
              <tr>
                <td className="py-1 font-bold text-slate-600">Total Fees:</td>
                <td className="py-1 text-right font-bold">{formatPeso(connectionFeeDetails.total)}</td>
              </tr>
              <tr>
                <td className="py-1 font-bold text-slate-600">Total Paid:</td>
                <td className="py-1 text-right font-bold text-emerald-600">{formatPeso(totalPaid)}</td>
              </tr>
              <tr className="border-t border-slate-300">
                <td className="py-2 font-bold text-lg uppercase">Balance:</td>
                <td className="py-2 text-right font-bold text-xl">{formatPeso(concessionaire.waterMeterBalance)}</td>
              </tr>
            </tbody>
          </table>
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
