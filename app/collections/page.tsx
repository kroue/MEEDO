"use client";

import { useEffect, useMemo, useState } from "react";
import { useConcessionaires, useConcessionaire } from "@/lib/firebase/useConcessionaires";
import { recordPayment, voidPayment, InvalidPaymentAmountError } from "@/lib/firebase/payments";
import { subscribeToRecentPayments } from "@/lib/firebase/bills";
import type { PaymentDocument } from "@/lib/firebase/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { getFullName, formatPeso } from "@/lib/utils";
import { sortHistoryAsc, paymentStatus, PAYMENT_STATUS_STYLES } from "@/lib/billing";
import type { Concessionaire, PaymentRecord } from "@/lib/firebase/types";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Search,
  Receipt,
  Printer,
  FileText,
  CheckCircle2,
  Banknote,
  Droplets,
  User,
  AlertCircle,
  Loader2,
  Wallet,
} from "lucide-react";

interface PaymentFeedRow extends PaymentRecord {
  concessionaireId: string;
  concessionaireName: string;
}

export default function CollectionsPage() {
  const { user } = useAuth();
  const actorEmail = user?.email ?? "unknown";

  const { concessionaires } = useConcessionaires("all", { realtime: true });
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { concessionaire: selected } = useConcessionaire(selectedId, { realtime: true });

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [lastPayment, setLastPayment] = useState<PaymentRecord | null>(null);

  // Void flow — a mistyped amount used to have no path back except a
  // developer editing Firestore by hand, which leaves no audit trail at all.
  const [voidTarget, setVoidTarget] = useState<PaymentFeedRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);
  const [isVoiding, setIsVoiding] = useState(false);

  const searchResults = useMemo(() => {
    if (search.trim().length < 2) return [];
    const q = search.trim().toLowerCase();
    return concessionaires.filter(
      (c) =>
        getFullName(c).toLowerCase().includes(q) ||
        c.meterNumber.toLowerCase().includes(q)
    );
  }, [concessionaires, search]);

  const handleSelect = (c: Concessionaire) => {
    setSelectedId(c.id);
    setPaymentAmount(c.billingBalance > 0 ? c.billingBalance.toFixed(2) : "");
    setPaymentError(null);
    setSearch("");
  };

  // Oldest-first, matching the FIFO order a payment is applied in.
  const unpaidHistory = useMemo(() => {
    if (!selected) return [];
    return sortHistoryAsc(selected.billingHistory.filter((h) => h.amountPaid < h.pesoAmount));
  }, [selected]);

  const amountEntered = parseFloat(paymentAmount);
  const advanceAmount =
    selected && amountEntered > selected.billingBalance
      ? amountEntered - selected.billingBalance
      : 0;

  async function handleProcessPayment() {
    if (!selected) return;
    const amount = parseFloat(paymentAmount);
    setPaymentError(null);

    if (!(amount > 0)) {
      setPaymentError("Enter a valid payment amount.");
      return;
    }
    // Overpayment is accepted — anything beyond the balance is held as
    // advance credit and drawn down against the next bill. Refusing it left
    // the cashier with no legitimate way to take money from someone paying
    // ahead before travelling.

    setIsPaying(true);
    try {
      const payment = await recordPayment(selected.id, amount, actorEmail);
      setLastPayment(payment);
      setSuccessOpen(true);
      setPaymentAmount("");
    } catch (err) {
      setPaymentError(
        err instanceof InvalidPaymentAmountError || err instanceof Error
          ? err.message
          : "Failed to process payment."
      );
    } finally {
      setIsPaying(false);
    }
  }

  // Prints a receipt route in a hidden iframe (rather than a new tab) — the
  // target page calls window.print() itself once it loads. Same pattern
  // already used for connection-fee receipts in app/connections/[id].
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

  async function handleVoidPayment() {
    if (!voidTarget) return;
    setIsVoiding(true);
    setVoidError(null);
    try {
      await voidPayment(voidTarget.concessionaireId, voidTarget.orNumber, voidReason, actorEmail);
      setVoidTarget(null);
      setVoidReason("");
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : "Failed to void the payment.");
    } finally {
      setIsVoiding(false);
    }
  }

  // Payments live in per-account sub-collections now, so the feed is a
  // collection-group listener rather than a scan of every concessionaire's
  // array — it returns fifteen documents instead of the whole district.
  const [feedPayments, setFeedPayments] = useState<PaymentDocument[] | null>(null);

  useEffect(() => {
    const unsub = subscribeToRecentPayments(setFeedPayments, console.error, 15);
    return unsub;
  }, []);

  const recentPayments = useMemo<PaymentFeedRow[]>(() => {
    if (feedPayments && feedPayments.length > 0) {
      return feedPayments.map((p) => ({
        ...p,
        concessionaireId: p.concessionaireId,
        concessionaireName: p.concessionaireName,
      }));
    }
    // Accounts not yet migrated still hold payments inline.
    const rows: PaymentFeedRow[] = [];
    concessionaires.forEach((c) => {
      (c.payments || []).forEach((p) => {
        rows.push({ ...p, concessionaireId: c.id, concessionaireName: getFullName(c) });
      });
    });
    return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 15);
  }, [concessionaires, feedPayments]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Collection Module</h2>
        <p className="text-sm text-slate-500">
          Process water bill payments from concessionaires and issue official receipts.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left Column — Account Lookup + Payment Form */}
        <div className="lg:col-span-3 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold text-slate-800">
                Account Lookup
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Search by concessionaire name or meter number to begin processing a payment.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Type a name or meter number..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 text-sm"
                />
              </div>
              {searchResults.length > 0 && (
                <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {searchResults.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleSelect(c)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-800">{getFullName(c)}</p>
                        <p className="text-xs text-slate-400">
                          {c.meterNumber} • {c.barangay}
                        </p>
                      </div>
                      <Badge
                        variant="secondary"
                        className={
                          c.billingBalance > 0
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }
                      >
                        {c.billingBalance > 0 ? formatPeso(c.billingBalance) : "No balance"}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {selected && (
            <Card className="border-blue-100">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold text-slate-800">
                    Payment Processing
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs font-semibold text-slate-600 border-slate-200 hover:bg-slate-50"
                      onClick={() => handlePrintWithoutNewTab(`/billing/${selected.id}/print-soa`)}
                    >
                      <FileText className="h-3.5 w-3.5 mr-1.5 text-sky-500" />
                      Print SOA
                    </Button>
                    <Badge variant="secondary" className={PAYMENT_STATUS_STYLES[
                      selected.billingBalance > 0 ? "UNPAID" : "PAID"
                    ]}>
                      {selected.billingBalance > 0 ? "Balance Due" : "Fully Paid"}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-slate-400" />
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-400">Concessionaire</p>
                        <p className="text-sm font-semibold text-slate-800">{getFullName(selected)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Receipt className="h-4 w-4 text-slate-400" />
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-400">Meter No.</p>
                        <p className="text-sm font-mono font-semibold text-slate-800">{selected.meterNumber}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-slate-400 mb-1">
                      <Banknote className="h-3.5 w-3.5" />
                      <span className="text-[10px] uppercase tracking-wider font-medium">
                        Outstanding Balance
                      </span>
                    </div>
                    <p className="text-2xl font-bold text-slate-900">
                      {formatPeso(selected.billingBalance)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-slate-400 mb-1">
                      <Wallet className="h-3.5 w-3.5" />
                      <span className="text-[10px] uppercase tracking-wider font-medium">
                        Advance Credit
                      </span>
                    </div>
                    <p className="text-2xl font-bold text-emerald-600">
                      {formatPeso(selected.creditBalance ?? 0)}
                    </p>
                  </div>
                </div>

                {unpaidHistory.length > 0 && (
                  <div className="rounded-lg border border-slate-200 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="text-[10px] uppercase tracking-wider text-slate-500">
                            Month
                          </TableHead>
                          <TableHead className="text-right text-[10px] uppercase tracking-wider text-slate-500">
                            Amount Due
                          </TableHead>
                          <TableHead className="text-right text-[10px] uppercase tracking-wider text-slate-500">
                            Paid
                          </TableHead>
                          <TableHead className="text-[10px] uppercase tracking-wider text-slate-500">
                            Status
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {unpaidHistory.map((h, i) => {
                          const status = paymentStatus(h.pesoAmount, h.amountPaid);
                          return (
                            <TableRow key={`${h.month}-${i}`}>
                              <TableCell className="text-xs text-slate-600">{h.month}</TableCell>
                              <TableCell className="text-right text-xs font-semibold text-slate-800">
                                {formatPeso(h.pesoAmount)}
                              </TableCell>
                              <TableCell className="text-right text-xs text-slate-500">
                                {formatPeso(h.amountPaid)}
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary" className={`${PAYMENT_STATUS_STYLES[status]} text-[10px]`}>
                                  {status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                <Separator />

                {paymentError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{paymentError}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-slate-700">
                      Amount to Pay (₱) *
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder="0.00"
                      className="text-sm font-mono text-lg font-semibold"
                    />
                    {advanceAmount > 0 && (
                      <p className="text-xs text-emerald-700">
                        {formatPeso(advanceAmount)} of this is more than the balance due — it will
                        be held as advance credit and applied to the next bill.
                      </p>
                    )}
                  </div>

                  <Button
                    onClick={handleProcessPayment}
                    disabled={isPaying || !paymentAmount || parseFloat(paymentAmount) <= 0}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-12 text-sm font-semibold"
                    size="lg"
                  >
                    {isPaying ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Receipt className="mr-2 h-4 w-4" />
                        Record Payment & Issue Receipt
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {!selected && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 mb-4">
                  <Wallet className="h-7 w-7 text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-500">No account selected</p>
                <p className="text-xs text-slate-400 mt-1">
                  Use the search above to look up a concessionaire account
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column — Recent Payments */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold text-slate-800">
                Recent Payments
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Latest water bill payments recorded, across all concessionaires.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentPayments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Droplets className="h-8 w-8 text-slate-300 mb-2" />
                  <p className="text-xs text-slate-400">No payments recorded yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentPayments.map((payment, i) => (
                    <div
                      key={`${payment.orNumber}-${i}`}
                      className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-slate-800 truncate">
                            {payment.concessionaireName}
                          </p>
                          {payment.voided && (
                            <Badge
                              variant="secondary"
                              className="bg-red-50 text-red-700 border-red-200 text-[9px] px-1 py-0"
                            >
                              VOID
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">
                          {payment.orNumber} • {payment.recordedBy}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {new Date(payment.date).toLocaleString("en-PH", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                        {payment.voided && payment.voidReason && (
                          <p className="text-[10px] text-red-600 mt-0.5">{payment.voidReason}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 ml-3">
                        <p
                          className={
                            payment.voided
                              ? "text-sm font-bold text-slate-400 line-through"
                              : "text-sm font-bold text-emerald-600"
                          }
                        >
                          {formatPeso(payment.amount)}
                        </p>
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[11px] text-sky-600 hover:text-sky-700 hover:bg-sky-50"
                            onClick={() =>
                              handlePrintWithoutNewTab(
                                `/collections/${payment.concessionaireId}/print-receipt?or=${encodeURIComponent(payment.orNumber)}`
                              )
                            }
                          >
                            <Printer className="h-3 w-3 mr-1" />
                            Print
                          </Button>
                          {!payment.voided && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[11px] text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => {
                                setVoidTarget(payment);
                                setVoidReason("");
                                setVoidError(null);
                              }}
                            >
                              Void
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Void a payment. The record is kept and marked voided rather than
          deleted — a cash receipt that was physically issued stays in the
          ledger so its OR number remains accounted for, and the reversal is
          itself an audited event. */}
      <Dialog open={voidTarget !== null} onOpenChange={(open) => !open && setVoidTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void payment {voidTarget?.orNumber}</DialogTitle>
            <DialogDescription>
              {voidTarget && (
                <>
                  This returns {formatPeso(voidTarget.amount)} to{" "}
                  {voidTarget.concessionaireName}&rsquo;s outstanding balance. The payment stays
                  on record, marked voided.
                </>
              )}
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
              placeholder="e.g. Wrong amount — 100 keyed as 1,000"
              className="text-sm"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidTarget(null)} className="text-sm">
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white text-sm"
              disabled={isVoiding || !voidReason.trim()}
              onClick={handleVoidPayment}
            >
              {isVoiding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Void Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Success Dialog */}
      <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
            <DialogTitle className="text-lg font-semibold text-slate-900">
              Payment Recorded
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              {lastPayment && lastPayment.balanceAfter <= 0
                ? "The account's water bill balance is now fully paid."
                : "The payment was applied. A balance remains outstanding."}
            </DialogDescription>
          </DialogHeader>
          {lastPayment && selected && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Concessionaire:</span>
                <span className="font-medium text-slate-800">{getFullName(selected)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">OR Number:</span>
                <span className="font-mono font-medium text-slate-800">{lastPayment.orNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Amount Paid:</span>
                <span className="font-bold text-emerald-600">{formatPeso(lastPayment.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Remaining Balance:</span>
                <span className="font-medium text-slate-800">{formatPeso(lastPayment.balanceAfter)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Recorded By:</span>
                <span className="font-medium text-slate-800">{lastPayment.recordedBy}</span>
              </div>
            </div>
          )}
          <DialogFooter className="flex gap-2 sm:justify-center">
            <Button variant="outline" onClick={() => setSuccessOpen(false)} className="text-sm">
              Close
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm"
              onClick={() =>
                selected &&
                lastPayment &&
                handlePrintWithoutNewTab(
                  `/collections/${selected.id}/print-receipt?or=${encodeURIComponent(lastPayment.orNumber)}`
                )
              }
            >
              <Printer className="mr-2 h-4 w-4" />
              Print Receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
