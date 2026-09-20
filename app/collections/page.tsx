"use client";

import { printDocument } from "@/components/print/PrintHost";
import { PaymentReceipt, WaterBillStatement } from "@/components/print/documents";
import { userMessage } from "@/lib/userMessage";
import { useEffect, useMemo, useState } from "react";
import { useConcessionaires, useConcessionaire } from "@/lib/firebase/useConcessionaires";
import { recordPayment, voidPayment } from "@/lib/firebase/payments";
import {
  isOpenRequest,
  subscribeToAccountRequests,
  submitWaterPaymentRequest,
} from "@/lib/firebase/requests";
import { orNumberProblem } from "@/lib/receipts";
import { subscribeToBills, subscribeToRecentPayments } from "@/lib/firebase/bills";
import type { MonthlyBillingRecord, PaymentDocument, ServiceRequest } from "@/lib/firebase/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { getFullName, formatPeso } from "@/lib/utils";
import { isAccountApproved, sortHistoryAsc, paymentStatus, PAYMENT_STATUS_STYLES } from "@/lib/billing";
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
  const { user, role } = useAuth();
  const actorEmail = user?.email ?? "unknown";
  // Staff take the cash and write the receipt; an admin releases the payment
  // onto the account. Nothing a staff member records changes a balance here.
  const canPostDirectly = role === "admin";

  const { concessionaires } = useConcessionaires("all", { realtime: true });
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { concessionaire: selected } = useConcessionaire(selectedId, { realtime: true });

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [lastPayment, setLastPayment] = useState<PaymentRecord | null>(null);
  // The OR is copied off the receipt that was just written — never generated.
  const [paymentOr, setPaymentOr] = useState("");
  const [requestNotice, setRequestNotice] = useState<string | null>(null);
  const [accountRequests, setAccountRequests] = useState<{ id: string; rows: ServiceRequest[] }>({
    id: "",
    rows: [],
  });

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
        // A payment can't be taken on an account an admin hasn't approved.
        isAccountApproved(c) &&
        (getFullName(c).toLowerCase().includes(q) ||
          (c.accountNumber ?? "").toLowerCase().includes(q))
    );
  }, [concessionaires, search]);

  const handleSelect = (c: Concessionaire) => {
    setSelectedId(c.id);
    setPaymentOr("");
    setRequestNotice(null);
    const balance = c.billingBalance ?? 0;
    setPaymentAmount(balance > 0 ? balance.toFixed(2) : "");
    setPaymentError(null);
    setSearch("");
  };

  // Bills live in the `bills` sub-collection now. Accounts imported or migrated
  // since carry no `billingHistory` array at all, which is what made selecting
  // one of them crash this page (`undefined.filter`). The subscription falls
  // back to the legacy array for accounts the migration hasn't reached.
  const [selectedBills, setSelectedBills] = useState<MonthlyBillingRecord[]>([]);
  const legacySelectedBills = useMemo(() => selected?.billingHistory ?? [], [selected]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedBills([]);
      return;
    }
    return subscribeToBills(selectedId, () => legacySelectedBills, setSelectedBills, (e) =>
      console.warn("Couldn't load bills for the selected account", e)
    );
  }, [selectedId, legacySelectedBills]);

  // Oldest-first, matching the FIFO order a payment is applied in.
  const unpaidHistory = useMemo(
    () =>
      sortHistoryAsc(
        selectedBills.filter((h) => !h.voided && (h.amountPaid ?? 0) < h.pesoAmount)
      ),
    [selectedBills]
  );

  // Payments already sent for approval on this account, so the counter can
  // see one is pending rather than recording it a second time.
  useEffect(() => {
    if (!selectedId) return;
    return subscribeToAccountRequests(
      selectedId,
      (rows) => setAccountRequests({ id: selectedId, rows: rows.filter(isOpenRequest) }),
      (e) => console.warn("Couldn't load pending requests for this account", e)
    );
  }, [selectedId]);

  const pendingForAccount =
    accountRequests.id === selectedId ? accountRequests.rows : [];

  const amountEntered = parseFloat(paymentAmount);
  const advanceAmount =
    selected && amountEntered > selected.billingBalance
      ? amountEntered - selected.billingBalance
      : 0;

  async function handleProcessPayment() {
    if (!selected) return;
    const amount = parseFloat(paymentAmount);
    setPaymentError(null);
    setRequestNotice(null);

    if (!(amount > 0)) {
      setPaymentError("Enter a valid payment amount.");
      return;
    }
    const orProblem = orNumberProblem(paymentOr);
    if (orProblem) {
      setPaymentError(orProblem);
      return;
    }
    // Overpayment is accepted — anything beyond the balance is held as
    // advance credit and drawn down against the next bill. Refusing it left
    // the cashier with no legitimate way to take money from someone paying
    // ahead before travelling.

    setIsPaying(true);
    try {
      if (canPostDirectly) {
        const payment = await recordPayment(selected.id, amount, paymentOr, actorEmail);
        setLastPayment(payment);
        setSuccessOpen(true);
      } else {
        await submitWaterPaymentRequest(selected, { amount, orNumber: paymentOr }, actorEmail);
        setRequestNotice(
          `Sent to an admin for approval. The balance changes once it is approved — keep OR ${paymentOr.trim().toUpperCase()} with the receipt.`
        );
      }
      setPaymentAmount("");
      setPaymentOr("");
    } catch (err) {
      setPaymentError(userMessage(err, "Failed to process payment."));
    } finally {
      setIsPaying(false);
    }
  }

  async function handleVoidPayment() {
    if (!voidTarget) return;
    setIsVoiding(true);
    setVoidError(null);
    try {
      await voidPayment(voidTarget.concessionaireId, voidTarget.orNumber, voidReason, actorEmail);
      setVoidTarget(null);
      setVoidReason("");
    } catch (err) {
      setVoidError(userMessage(err, "Failed to void the payment."));
    } finally {
      setIsVoiding(false);
    }
  }

  // Payments live in per-account sub-collections now, so the feed is a
  // collection-group listener rather than a scan of every concessionaire's
  // array — it returns fifteen documents instead of the whole district.
  const [feedPayments, setFeedPayments] = useState<PaymentDocument[] | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);

  useEffect(() => {
    // Reported in the card rather than through console.error, which Next's
    // dev overlay turns into a full-screen error for what is only a feed.
    const unsub = subscribeToRecentPayments(
      (rows) => {
        setFeedPayments(rows);
        setFeedError(null);
      },
      (e) => {
        console.warn("Couldn't load recent payments", e);
        setFeedError(userMessage(e, "Couldn't load recent payments."));
      },
      15
    );
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
                Search by concessionaire name or account number to begin processing a payment.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Type a name or account number..."
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
                          {c.accountNumber || "No account number"} • {c.barangay}
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
                      onClick={() => printDocument(<WaterBillStatement concessionaireId={selected.id} />)}
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

                {requestNotice && (
                  <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <p className="text-sm text-emerald-900">{requestNotice}</p>
                  </div>
                )}

                {pendingForAccount.length > 0 && (
                  <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <p className="text-sm text-amber-900">
                      {pendingForAccount.length === 1
                        ? "1 request on this account is waiting for an admin"
                        : `${pendingForAccount.length} requests on this account are waiting for an admin`}
                      {pendingForAccount[0].orNumber ? ` (OR ${pendingForAccount[0].orNumber})` : ""}. The
                      balance below does not include it yet.
                    </p>
                  </div>
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

                  <div className="space-y-1.5">
                    <Label htmlFor="payment-or" className="text-xs font-medium text-slate-700">
                      OR Number *
                    </Label>
                    <Input
                      id="payment-or"
                      value={paymentOr}
                      onChange={(e) => setPaymentOr(e.target.value)}
                      placeholder="As written on the receipt"
                      className="font-mono text-sm"
                      autoComplete="off"
                    />
                    <p className="text-xs text-slate-500">
                      Copy the number from the receipt booklet — it is not generated here.
                    </p>
                    {paymentOr.trim() && orNumberProblem(paymentOr) && (
                      <p className="text-xs text-red-600">{orNumberProblem(paymentOr)}</p>
                    )}
                  </div>

                  <Button
                    onClick={handleProcessPayment}
                    disabled={
                      isPaying ||
                      !paymentAmount ||
                      parseFloat(paymentAmount) <= 0 ||
                      !paymentOr.trim() ||
                      orNumberProblem(paymentOr) !== null
                    }
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-12 text-sm font-semibold"
                    size="lg"
                  >
                    {isPaying ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {canPostDirectly ? "Processing..." : "Sending..."}
                      </>
                    ) : (
                      <>
                        <Receipt className="mr-2 h-4 w-4" />
                        {canPostDirectly
                          ? "Record Payment & Issue Receipt"
                          : "Send Payment for Approval"}
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
              {feedError && (
                <p className="mb-3 text-xs text-amber-700">
                  Couldn&apos;t load the latest payments: {feedError}
                </p>
              )}
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
                              printDocument(<PaymentReceipt concessionaireId={payment.concessionaireId} orNumber={payment.orNumber} />)
                            }
                          >
                            <Printer className="h-3 w-3 mr-1" />
                            Print
                          </Button>
                          {!payment.voided && canPostDirectly && (
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
                printDocument(<PaymentReceipt concessionaireId={selected.id} orNumber={lastPayment.orNumber} />)
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
