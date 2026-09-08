"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useConcessionaire } from "@/lib/firebase/useConcessionaires";
import { getCubicUsed } from "@/lib/firebase/types";
import { getFullName, formatPeso } from "@/lib/utils";
import {
  monthSortKey,
  paymentStatus,
  PAYMENT_STATUS_STYLES,
  waterChargeOf,
  concessionaireDaysOverdue,
  isDisconnectionEligible,
} from "@/lib/billing";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CircleDollarSign,
  Droplets,
  FileText,
  Loader2,
  Plug,
  Printer,
  Receipt,
  Wallet,
} from "lucide-react";

export default function ConcessionaireBillingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { concessionaire, loading, error } = useConcessionaire(id, { realtime: true });

  // How long the ACCOUNT has been carrying a balance — not how old each
  // individual bill is. Ageing per bill resets the clock every cycle, so a
  // long-standing debt never reached the 20-day disconnection threshold.
  const accountOverdueDays = useMemo(
    () => (concessionaire ? concessionaireDaysOverdue(concessionaire) : null),
    [concessionaire]
  );

  const bills = useMemo(() => {
    if (!concessionaire) return [];
    return [...(concessionaire.billingHistory || [])]
      .map((h) => ({
        ...h,
        consumption: getCubicUsed(h),
        status: paymentStatus(h.pesoAmount, h.amountPaid),
      }))
      .sort((a, b) => monthSortKey(b.month) - monthSortKey(a.month));
  }, [concessionaire]);

  const summary = useMemo(
    () =>
      bills.reduce(
        (acc, b) => {
          // Water sold this cycle, not the bill total — each bill's
          // pesoAmount already carries the previous balance forward, so
          // summing it counts the same debt once per unpaid month.
          acc.totalWaterCharged += waterChargeOf(b);
          return acc;
        },
        { totalWaterCharged: 0 }
      ),
    [bills]
  );

  const payments = useMemo(() => {
    if (!concessionaire) return [];
    return [...(concessionaire.payments || [])].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [concessionaire]);

  // Prints a receipt route in a hidden iframe — the target page calls
  // window.print() itself once it loads. Same pattern used on the
  // Collections and Connections pages for their own receipts.
  const handlePrintWithoutNewTab = (url: string) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0px";
    iframe.style.height = "0px";
    iframe.style.border = "none";
    iframe.src = url;
    document.body.appendChild(iframe);

    setTimeout(() => {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    }, 60_000);
  };

  if (loading && !concessionaire) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-sky-500 mb-4" />
        <p className="text-sm font-medium text-slate-500">Loading billing history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 flex flex-col items-center">
          <AlertCircle className="h-10 w-10 text-red-500 mb-3" />
          <h2 className="text-lg font-bold text-red-700">Error Loading Billing History</h2>
          <p className="text-sm text-red-600 mt-1 mb-4">{error.message}</p>
          <Button variant="outline" onClick={() => router.push("/billing")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Billing
          </Button>
        </div>
      </div>
    );
  }

  if (!concessionaire) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 flex flex-col items-center">
          <Receipt className="h-10 w-10 text-slate-400 mb-3" />
          <h2 className="text-lg font-bold text-slate-700">Concessionaire Not Found</h2>
          <p className="text-sm text-slate-500 mt-1 mb-4">
            The record you are looking for does not exist or has been removed.
          </p>
          <Button variant="outline" onClick={() => router.push("/billing")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Billing
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/billing">
            <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl shrink-0">
              <ArrowLeft className="h-4 w-4 text-slate-600" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              {getFullName(concessionaire)}
            </h1>
            <p className="text-sm font-medium text-slate-500">
              {concessionaire.barangay === "CG" ? "Cebuano Group" : concessionaire.barangay} • Purok{" "}
              {concessionaire.purok} • {concessionaire.meterNumber}
            </p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <Badge
            variant="secondary"
            className={
              concessionaire.status === "CONNECTED"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-red-50 text-red-700 border-red-200"
            }
          >
            {concessionaire.status || "CONNECTED"}
          </Badge>
          <Badge variant="outline">{concessionaire.classification}</Badge>
          <Button
            variant="outline"
            className="bg-white border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold shadow-sm"
            onClick={() => handlePrintWithoutNewTab(`/billing/${concessionaire.id}/print-soa`)}
          >
            <FileText className="h-4 w-4 mr-2 text-sky-500" />
            Print SOA
          </Button>
          <Link href={`/concessionaires/${concessionaire.id}`}>
            <Button variant="outline" className="bg-white border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold shadow-sm">
              <Plug className="h-4 w-4 mr-2 text-sky-500" />
              Full Record
            </Button>
          </Link>
        </div>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <CalendarDays className="h-3.5 w-3.5" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">Months Billed</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{bills.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <CircleDollarSign className="h-3.5 w-3.5" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">Water Charged</span>
            </div>
            <p className="text-2xl font-bold text-blue-600">{formatPeso(summary.totalWaterCharged)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Wallet className="h-3.5 w-3.5" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">Outstanding</span>
            </div>
            <p className="text-2xl font-bold text-amber-600">
              {formatPeso(concessionaire.billingBalance ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Billing history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-slate-800">Billing History</CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Every reading captured for this concessionaire, newest first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Droplets className="h-10 w-10 text-slate-300 mb-3" />
              <p className="text-sm font-medium text-slate-500">No bills yet</p>
              <p className="text-xs text-slate-400 mt-1">
                A bill appears here once a field reader submits a reading for this account.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Month
                    </TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Reading
                    </TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Consumption
                    </TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Amount Due
                    </TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Amount Paid
                    </TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      OR Number
                    </TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bills.map((b, i) => {
                    const overdueDays = b.status !== "PAID" ? accountOverdueDays : null;
                    const disconnectionEligible = isDisconnectionEligible(overdueDays);
                    return (
                      <TableRow key={`${b.month}-${i}`}>
                        <TableCell className="text-sm font-medium text-slate-800">{b.month}</TableCell>
                        <TableCell className="text-right text-sm text-slate-600">
                          {b.previousReading} → {b.reading} m³
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold text-blue-600">
                          {b.consumption} m³
                        </TableCell>
                        <TableCell className="text-right text-sm font-bold text-slate-800">
                          {formatPeso(b.pesoAmount)}
                        </TableCell>
                        <TableCell className="text-right text-sm text-slate-600">
                          {formatPeso(b.amountPaid)}
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {b.orNumber || <span className="text-slate-300">—</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 items-start">
                            <Badge variant="secondary" className={PAYMENT_STATUS_STYLES[b.status]}>
                              {b.status}
                            </Badge>
                            {overdueDays !== null && overdueDays > 0 && (
                              <span
                                className={
                                  disconnectionEligible
                                    ? "text-[10px] font-semibold text-red-600 flex items-center gap-1"
                                    : "text-[10px] text-slate-400"
                                }
                              >
                                {disconnectionEligible && <AlertTriangle className="h-3 w-3" />}
                                {overdueDays}d overdue
                                {disconnectionEligible && " • disconnection eligible"}
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-slate-800">Payment History</CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Every water bill payment recorded for this concessionaire, newest first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Wallet className="h-10 w-10 text-slate-300 mb-3" />
              <p className="text-sm font-medium text-slate-500">No payments yet</p>
              <p className="text-xs text-slate-400 mt-1">
                Payments appear here once recorded from the Collection Module.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Date
                    </TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      OR Number
                    </TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Amount
                    </TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Balance Before → After
                    </TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Recorded By
                    </TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Receipt
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p, i) => (
                    <TableRow key={`${p.orNumber}-${i}`}>
                      <TableCell className="text-sm text-slate-600">
                        {new Date(p.date).toLocaleString("en-PH", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="text-sm font-mono text-slate-700">{p.orNumber}</TableCell>
                      <TableCell className="text-right text-sm font-bold text-emerald-600">
                        {formatPeso(p.amount)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-slate-500">
                        {formatPeso(p.balanceBefore)} → {formatPeso(p.balanceAfter)}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">{p.recordedBy}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-sky-600 hover:text-sky-700 hover:bg-sky-50"
                          onClick={() =>
                            handlePrintWithoutNewTab(
                              `/collections/${concessionaire.id}/print-receipt?or=${encodeURIComponent(p.orNumber)}`
                            )
                          }
                        >
                          <Printer className="h-4 w-4 mr-1.5" />
                          <span className="text-xs font-semibold">Print</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
