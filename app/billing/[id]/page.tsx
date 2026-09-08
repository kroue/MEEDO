"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useConcessionaire } from "@/lib/firebase/useConcessionaires";
import { subscribeToBills, subscribeToPayments } from "@/lib/firebase/bills";
import { issueBill, voidBill, previewBill, BillingError } from "@/lib/firebase/issueBill";
import { useAuth } from "@/lib/auth/AuthContext";
import type { BillingResult } from "@/lib/billingCalculator";
import type { MonthlyBillingRecord, PaymentRecord } from "@/lib/firebase/types";
import { getCubicUsed } from "@/lib/firebase/types";
import { getFullName, formatPeso } from "@/lib/utils";
import {
  monthSortKey,
  paymentStatus,
  PAYMENT_STATUS_STYLES,
  waterChargeOf,
  concessionaireDaysOverdue,
  isDisconnectionEligible,
  currentMonthStr,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const { user, role } = useAuth();
  const actorEmail = user?.email ?? "unknown";
  const canIssue = role === "admin";
  const { concessionaire, loading, error } = useConcessionaire(id, { realtime: true });

  // Bills and payments live in sub-collections now. Both subscriptions fall
  // back to the legacy arrays for an account the storage migration hasn't
  // reached, so this page works against either shape.
  const [billRecords, setBillRecords] = useState<MonthlyBillingRecord[]>([]);
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecord[]>([]);
  const legacyBills = useMemo(() => concessionaire?.billingHistory ?? [], [concessionaire]);
  const legacyPayments = useMemo(() => concessionaire?.payments ?? [], [concessionaire]);

  useEffect(() => {
    if (!id) return;
    const unsub = subscribeToBills(id, () => legacyBills, setBillRecords, console.error);
    return unsub;
  }, [id, legacyBills]);

  useEffect(() => {
    if (!id) return;
    const unsub = subscribeToPayments(id, () => legacyPayments, setPaymentRecords, console.error);
    return unsub;
  }, [id, legacyPayments]);

  // ── Office-side billing ──────────────────────────────────────────────────
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueMonth, setIssueMonth] = useState(currentMonthStr());
  const [issueReading, setIssueReading] = useState("");
  const [issueEstimated, setIssueEstimated] = useState(false);
  const [issueNote, setIssueNote] = useState("");
  const [issuePreview, setIssuePreview] = useState<BillingResult | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);

  const [voidTarget, setVoidTarget] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);

  // Recalculate the preview as the reading is typed, so the office sees the
  // exact figure before committing rather than after.
  const refreshPreview = useCallback(async () => {
    if (!concessionaire || !issueReading.trim()) {
      setIssuePreview(null);
      setIssueError(null);
      return;
    }
    const reading = Number(issueReading);
    if (!Number.isFinite(reading)) {
      setIssuePreview(null);
      setIssueError("Enter a valid meter reading.");
      return;
    }
    try {
      const { billing } = await previewBill(concessionaire, issueMonth, reading);
      setIssuePreview(billing);
      setIssueError(null);
    } catch (e) {
      setIssuePreview(null);
      setIssueError(e instanceof Error ? e.message : "Couldn't calculate that bill.");
    }
  }, [concessionaire, issueMonth, issueReading]);

  useEffect(() => {
    const t = setTimeout(refreshPreview, 250);
    return () => clearTimeout(t);
  }, [refreshPreview]);

  async function handleIssue() {
    if (!concessionaire) return;
    setIssuing(true);
    setIssueError(null);
    try {
      await issueBill({
        concessionaireId: concessionaire.id,
        monthStr: issueMonth,
        currentReading: Number(issueReading),
        estimated: issueEstimated,
        note: issueNote.trim() || undefined,
        actorEmail,
      });
      setIssueOpen(false);
      setIssueReading("");
      setIssueNote("");
      setIssueEstimated(false);
      setIssuePreview(null);
    } catch (e) {
      setIssueError(
        e instanceof BillingError || e instanceof Error ? e.message : "Failed to issue the bill."
      );
    } finally {
      setIssuing(false);
    }
  }

  async function handleVoidBill() {
    if (!concessionaire || !voidTarget) return;
    setVoiding(true);
    setVoidError(null);
    try {
      await voidBill(concessionaire.id, voidTarget, voidReason, actorEmail);
      setVoidTarget(null);
      setVoidReason("");
    } catch (e) {
      setVoidError(e instanceof Error ? e.message : "Failed to void the bill.");
    } finally {
      setVoiding(false);
    }
  }

  // How long the ACCOUNT has been carrying a balance — not how old each
  // individual bill is. Ageing per bill resets the clock every cycle, so a
  // long-standing debt never reached the 20-day disconnection threshold.
  const accountOverdueDays = useMemo(
    () => (concessionaire ? concessionaireDaysOverdue(concessionaire) : null),
    [concessionaire]
  );

  const bills = useMemo(() => {
    if (!concessionaire) return [];
    return [...billRecords]
      .map((h) => ({
        ...h,
        consumption: getCubicUsed(h),
        status: paymentStatus(h.pesoAmount, h.amountPaid),
      }))
      .sort((a, b) => monthSortKey(b.month) - monthSortKey(a.month));
  }, [concessionaire, billRecords]);

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

  const payments = useMemo(
    () =>
      [...paymentRecords].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
    [paymentRecords]
  );

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
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold text-slate-800">Billing History</CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Every bill for this concessionaire, newest first.
              </CardDescription>
            </div>
            {canIssue && (
              <Button
                size="sm"
                className="shrink-0 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold"
                onClick={() => {
                  setIssueMonth(currentMonthStr());
                  setIssueReading("");
                  setIssueNote("");
                  setIssueEstimated(false);
                  setIssuePreview(null);
                  setIssueError(null);
                  setIssueOpen(true);
                }}
              >
                <Receipt className="h-3.5 w-3.5 mr-1.5" />
                Issue bill
              </Button>
            )}
          </div>
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
                        <TableCell className="text-sm font-medium text-slate-800">
                          <div className="flex flex-col gap-0.5">
                            <span className={b.voided ? "line-through text-slate-400" : undefined}>
                              {b.month}
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {b.voided && (
                                <Badge
                                  variant="secondary"
                                  className="bg-red-50 text-red-700 border-red-200 text-[9px] px-1 py-0"
                                >
                                  VOID
                                </Badge>
                              )}
                              {b.source === "office" && (
                                <Badge
                                  variant="secondary"
                                  className="bg-slate-100 text-slate-600 border-slate-200 text-[9px] px-1 py-0"
                                >
                                  OFFICE
                                </Badge>
                              )}
                              {b.estimated && (
                                <Badge
                                  variant="secondary"
                                  className="bg-amber-50 text-amber-700 border-amber-200 text-[9px] px-1 py-0"
                                >
                                  ESTIMATED
                                </Badge>
                              )}
                            </div>
                            {b.voided && b.voidReason && (
                              <span className="text-[10px] text-red-600">{b.voidReason}</span>
                            )}
                          </div>
                        </TableCell>
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
                            {/* Only the newest bill can be voided — reversing
                                an older one would leave every bill after it
                                computed from a balance that no longer follows. */}
                            {canIssue && i === 0 && !b.voided && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-[11px] text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={() => {
                                  setVoidTarget(b.month);
                                  setVoidReason("");
                                  setVoidError(null);
                                }}
                              >
                                Void
                              </Button>
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

      {/* Issue a bill from the office. Same transaction semantics as the
          phone's upload: calculated against the balance read from the server,
          replacing rather than compounding an existing bill for the month. */}
      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Issue a bill</DialogTitle>
            <DialogDescription>
              For {concessionaire ? getFullName(concessionaire) : ""}. If a bill already exists for
              this month it is replaced, and its receipt number is reused rather than a new one
              being issued.
            </DialogDescription>
          </DialogHeader>

          {issueError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{issueError}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-700">Billing month</Label>
              <Input
                value={issueMonth}
                onChange={(e) => setIssueMonth(e.target.value.toUpperCase())}
                placeholder="SEP 2026"
                className="text-sm font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-700">Current reading (m³)</Label>
              <Input
                type="number"
                step="0.01"
                value={issueReading}
                onChange={(e) => setIssueReading(e.target.value)}
                placeholder="0"
                className="text-sm font-mono"
              />
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <Checkbox
              id="issue-estimated"
              checked={issueEstimated}
              onCheckedChange={(v) => setIssueEstimated(v === true)}
              className="mt-0.5"
            />
            <Label htmlFor="issue-estimated" className="text-xs text-amber-900 leading-relaxed">
              This reading is an estimate, not read off the meter. The bill is marked so nobody
              later mistakes it for a verified reading.
            </Label>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-700">Note (optional)</Label>
            <Input
              value={issueNote}
              onChange={(e) => setIssueNote(e.target.value)}
              placeholder="e.g. Meter inaccessible — averaged from the last three months"
              className="text-sm"
            />
          </div>

          {issuePreview && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Consumption</span>
                <span className="font-medium text-slate-800">
                  {issuePreview.consumption} m³
                  {issuePreview.meterRolledOver && (
                    <span className="ml-1 text-[10px] text-amber-700">(meter rolled over)</span>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Water charge</span>
                <span className="text-slate-800">{formatPeso(issuePreview.totalWaterCharge)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Previous balance</span>
                <span className="text-slate-800">{formatPeso(issuePreview.overdueBalance)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">
                  Overdue surcharge
                  {issuePreview.daysOverdue !== null && (
                    <span className="text-[10px] text-slate-400"> · {issuePreview.daysOverdue}d</span>
                  )}
                </span>
                <span className="text-slate-800">{formatPeso(issuePreview.overdueSurcharge)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Extension fee</span>
                <span className="text-slate-800">{formatPeso(issuePreview.extensionFee)}</span>
              </div>
              {issuePreview.creditApplied > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Less: advance credit</span>
                  <span>-{formatPeso(issuePreview.creditApplied)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-200 pt-1.5 mt-1.5">
                <span className="font-semibold text-slate-700">Total due</span>
                <span className="text-lg font-bold text-slate-900">
                  {formatPeso(issuePreview.totalAmountDue)}
                </span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueOpen(false)} className="text-sm">
              Cancel
            </Button>
            <Button
              className="bg-sky-600 hover:bg-sky-700 text-white text-sm"
              disabled={issuing || !issuePreview}
              onClick={handleIssue}
            >
              {issuing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Issue bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void a bill. Only the most recent one — reversing an older bill would
          leave every later bill computed from a balance that no longer
          follows from it. */}
      <Dialog open={voidTarget !== null} onOpenChange={(open) => !open && setVoidTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void the {voidTarget} bill</DialogTitle>
            <DialogDescription>
              Restores the balance to where it stood before this bill and returns any credit it
              consumed. The bill stays on record, marked voided, so its receipt number remains
              accounted for.
            </DialogDescription>
          </DialogHeader>

          {voidError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{voidError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-700">
              Reason <span className="text-red-500">*</span>
            </Label>
            <Input
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Reading was transposed — 1204 entered as 1024"
              className="text-sm"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidTarget(null)} className="text-sm">
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white text-sm"
              disabled={voiding || !voidReason.trim()}
              onClick={handleVoidBill}
            >
              {voiding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Void bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
