"use client";

import { printDocument } from "@/components/print/PrintHost";
import { ConnectionFeeReceipt, ConnectionFeeStatement } from "@/components/print/documents";
import { userMessage } from "@/lib/userMessage";
import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { 
  ArrowLeft, Loader2, AlertCircle, Plug, Banknote, Receipt,
  Printer, CheckCircle2, History, CreditCard, ChevronRight, Plus, Trash2, MessageSquare
} from "lucide-react";
import { useConcessionaire } from "@/lib/firebase/useConcessionaires";
import {
  updateConnectionFeeDetails,
  addMeterPayment,
  voidMeterPayment,
} from "@/lib/firebase/concessionaires";
import {
  isOpenRequest,
  subscribeToAccountRequests,
  submitConnectionPaymentRequest,
  submitConnectionSetupRequest,
} from "@/lib/firebase/requests";
import { orNumberProblem } from "@/lib/receipts";
import type { ServiceRequest } from "@/lib/firebase/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPeso, getFullName } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth/AuthContext";

export default function ConnectionDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const { user, role } = useAuth();
  const actorEmail = user?.email ?? "unknown";
  // Staff fill in the same forms; what differs is where it goes. An admin
  // applies it to the account, a staff member sends it for approval.
  const canPostDirectly = role === "admin";
  const router = useRouter();
  
  const { concessionaire, loading, error } = useConcessionaire(id, { realtime: true });

  // Init Connection State
  const [otherPayables, setOtherPayables] = useState<{description: string; amount: number}[]>([]);
  const [initialRemark, setInitialRemark] = useState("");
  const [isInitializing, setIsInitializing] = useState(false);

  // Payment State
  const [paymentSlot, setPaymentSlot] = useState<string>("1st");
  const [paymentAmount, setPaymentAmount] = useState<number | "">("");
  const [paymentOr, setPaymentOr] = useState("");
  const [isPaying, setIsPaying] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [requestNotice, setRequestNotice] = useState<string | null>(null);
  const [accountRequests, setAccountRequests] = useState<ServiceRequest[]>([]);

  // Anything on this account already waiting on an admin.
  useEffect(() => {
    if (!id) return;
    return subscribeToAccountRequests(
      id,
      (rows) => setAccountRequests(rows.filter(isOpenRequest)),
      (e) => console.warn("Couldn't load pending requests for this account", e)
    );
  }, [id]);

  // Void flow
  const [voidTarget, setVoidTarget] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);
  const [isVoiding, setIsVoiding] = useState(false);

  // Compute available slots dynamically based on existing payments
  // Voided payments release their slot and drop out of the running total —
  // otherwise a mistyped payment would block that installment forever.
  const existingSlots =
    concessionaire?.meterPayments?.filter((p) => !p.voided).map((p) => p.slot) || [];
  const availableSlots: { value: string; label: string }[] = [];
  
  if (existingSlots.length === 0) {
    availableSlots.push({ value: "Full", label: "Full Payment" });
    availableSlots.push({ value: "1st", label: "1st Installment" });
  } else if (existingSlots.includes("1st") && !existingSlots.includes("2nd")) {
    availableSlots.push({ value: "2nd", label: "2nd Installment" });
  } else if (existingSlots.includes("2nd") && !existingSlots.includes("3rd")) {
    availableSlots.push({ value: "3rd", label: "3rd Installment" });
  } else if (existingSlots.includes("3rd") && !existingSlots.includes("4th")) {
    availableSlots.push({ value: "4th", label: "4th Installment" });
  }

  // Auto-select first available slot if the current one is invalid
  // Also auto-fill amount if the auto-selected slot is "Full"
  useEffect(() => {
    if (availableSlots.length > 0 && !availableSlots.some((s) => s.value === paymentSlot)) {
      const firstAvailable = availableSlots[0].value;
      setPaymentSlot(firstAvailable);
      if (firstAvailable === "Full") {
        setPaymentAmount(concessionaire?.waterMeterBalance || "");
      }
    }
  }, [availableSlots, paymentSlot, concessionaire]);

  const handleSlotChange = (v: string) => {
    setPaymentSlot(v);
    if (v === "Full") {
      setPaymentAmount(concessionaire?.waterMeterBalance || "");
    }
  };

  if (loading && !concessionaire) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-sky-500 mb-4" />
        <p className="text-sm font-medium text-slate-500">Loading connection details...</p>
      </div>
    );
  }

  if (error || !concessionaire) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 flex flex-col items-center">
          <AlertCircle className="h-10 w-10 text-red-500 mb-3" />
          <h2 className="text-lg font-bold text-red-700">Error Loading Details</h2>
          <p className="text-sm text-red-600 mt-1 mb-4">{error ? userMessage(error) : "Concessionaire not found."}</p>
          <Button variant="outline" onClick={() => router.push("/connections")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Connections
          </Button>
        </div>
      </div>
    );
  }

  const { connectionFeeDetails, meterPayments = [] } = concessionaire;
  const totalPaid = meterPayments.reduce((sum, p) => (p.voided ? sum : sum + p.amount), 0);
  const isFullyPaid = connectionFeeDetails && totalPaid >= connectionFeeDetails.total && connectionFeeDetails.total > 0;

  async function handleInitialize() {
    if (!concessionaire) return;
    setIsInitializing(true);
    try {
      const fixedFees = { waterMeter: 1600, applicationFee: 150, inspectionFee: 50 };
      const otherPayablesTotal = otherPayables.reduce((sum, p) => sum + p.amount, 0);
      const total = fixedFees.waterMeter + fixedFees.applicationFee + fixedFees.inspectionFee + otherPayablesTotal;
      
      const newRemark = initialRemark.trim() ? {
        text: initialRemark.trim(),
        date: new Date().toISOString(),
      } : undefined;

      if (canPostDirectly) {
        await updateConnectionFeeDetails(
          concessionaire.id,
          { ...fixedFees, otherPayables, total },
          actorEmail,
          newRemark
        );
      } else {
        await submitConnectionSetupRequest(
          concessionaire,
          {
            connectionFeeDetails: { ...fixedFees, otherPayables, total },
            note: initialRemark,
          },
          actorEmail
        );
        setRequestNotice(
          "Sent to an admin for approval. The connection is set up once it is approved."
        );
      }
    } catch (err) {
      console.error(err);
      setInitError(userMessage(err, "Failed to initialize connection."));
    } finally {
      setIsInitializing(false);
    }
  }

  async function handlePayment() {
    if (!concessionaire || !paymentAmount || !paymentSlot || !paymentOr.trim()) return;
    const orProblem = orNumberProblem(paymentOr);
    if (orProblem) {
      setPaymentError(orProblem);
      return;
    }
    setIsPaying(true);
    setPaymentError(null);
    setRequestNotice(null);
    try {
      // The balance is now recomputed server-side inside a transaction —
      // passing a client-computed figure meant two cashiers recording
      // installments seconds apart produced two payment rows but only one
      // balance reduction.
      if (canPostDirectly) {
        await addMeterPayment(
          concessionaire.id,
          {
            slot: paymentSlot,
            amount: Number(paymentAmount),
            orNumber: paymentOr.trim(),
            date: new Date().toISOString(),
          },
          actorEmail
        );
      } else {
        await submitConnectionPaymentRequest(
          concessionaire,
          {
            amount: Number(paymentAmount),
            orNumber: paymentOr,
            slot: paymentSlot,
          },
          actorEmail
        );
        setRequestNotice(
          `Sent to an admin for approval. The connection fee balance changes once it is approved — keep OR ${paymentOr
            .trim()
            .toUpperCase()} with the receipt.`
        );
      }

      setPaymentAmount("");
      setPaymentOr("");
    } catch (err) {
      console.error(err);
      setPaymentError(userMessage(err, "Failed to process payment."));
    } finally {
      setIsPaying(false);
    }
  }

  async function handleVoidPayment() {
    if (!concessionaire || !voidTarget) return;
    setIsVoiding(true);
    setVoidError(null);
    try {
      await voidMeterPayment(concessionaire.id, voidTarget, voidReason, actorEmail);
      setVoidTarget(null);
      setVoidReason("");
    } catch (err) {
      setVoidError(userMessage(err, "Failed to void the payment."));
    } finally {
      setIsVoiding(false);
    }
  }

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-4xl mx-auto">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/connections">
            <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl shrink-0">
              <ArrowLeft className="h-4 w-4 text-slate-600" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                {getFullName(concessionaire)}
              </h1>
              {isFullyPaid && (
                <Badge className="bg-emerald-500 hover:bg-emerald-600 border-none shadow-none text-white gap-1 ml-2">
                  <CheckCircle2 className="h-3 w-3" /> Fully Paid
                </Badge>
              )}
            </div>
            <p className="text-sm font-medium text-slate-500">
              Meter {concessionaire.meterNumber} • {concessionaire.barangay === "CG" ? "Cebuano Group" : concessionaire.barangay}
            </p>
          </div>
        </div>
        {connectionFeeDetails && (
          <div className="flex gap-2 items-center">
            <Button 
              variant="outline"
              className="bg-white border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold shadow-sm"
              onClick={() => printDocument(<ConnectionFeeStatement concessionaireId={concessionaire.id} />)}
            >
              <Printer className="h-4 w-4 mr-2 text-slate-400" />
              Print SOA
            </Button>
          </div>
        )}
      </div>

      {requestNotice && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 max-w-2xl">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <p className="text-sm text-emerald-900">{requestNotice}</p>
        </div>
      )}

      {accountRequests.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 max-w-2xl">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-sm text-amber-900">
            {accountRequests.length === 1
              ? "1 request on this account is waiting for an admin"
              : `${accountRequests.length} requests on this account are waiting for an admin`}
            . The balances below do not include it yet.
          </p>
        </div>
      )}

      {!connectionFeeDetails ? (
        // Init State
        <Card className="border-sky-100 shadow-sm bg-white overflow-hidden max-w-2xl">
          <div className="h-1 bg-sky-500 w-full" />
          <CardHeader className="bg-sky-50/50 pb-4 border-b border-sky-100">
            <CardTitle className="text-lg flex items-center gap-2 text-sky-900">
              <Plug className="h-5 w-5 text-sky-600" />
              Initialize New Connection
            </CardTitle>
            <CardDescription className="text-sky-700/70">
              {canPostDirectly
                ? "Generate the connection fee balance for this concessionaire."
                : "Fill this in and send it to an admin. The balance is created once they approve."}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-slate-100">
                <span className="text-sm text-slate-600 font-medium">Water Meter</span>
                <span className="text-sm font-semibold text-slate-900">{formatPeso(1600)}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-100">
                <span className="text-sm text-slate-600 font-medium">Application Fee</span>
                <span className="text-sm font-semibold text-slate-900">{formatPeso(150)}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-100">
                <span className="text-sm text-slate-600 font-medium">Inspection Fee</span>
                <span className="text-sm font-semibold text-slate-900">{formatPeso(50)}</span>
              </div>
              
              <div className="pt-4 border-t border-slate-200">
                <div className="flex justify-between items-center mb-3">
                  <Label className="text-sm text-slate-800 font-bold uppercase tracking-wider">Other Payables</Label>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-7 text-xs bg-white text-sky-600 hover:text-sky-700 hover:bg-sky-50 border-sky-200"
                    onClick={() => setOtherPayables([...otherPayables, { description: "", amount: 0 }])}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Item
                  </Button>
                </div>
                
                {otherPayables.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">No additional payables.</p>
                ) : (
                  <div className="space-y-3">
                    {otherPayables.map((item, index) => (
                      <div key={index} className="flex items-center gap-3">
                        <Input 
                          placeholder="Description (e.g. Extra Pipes)"
                          value={item.description}
                          onChange={(e) => {
                            const newItems = [...otherPayables];
                            newItems[index].description = e.target.value;
                            setOtherPayables(newItems);
                          }}
                          className="h-8 text-sm flex-1"
                        />
                        <div className="relative w-32 shrink-0">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                          <Input 
                            type="number"
                            min="0"
                            value={item.amount || ""}
                            onChange={(e) => {
                              const newItems = [...otherPayables];
                              newItems[index].amount = Number(e.target.value) || 0;
                              setOtherPayables(newItems);
                            }}
                            className="pl-7 h-8 text-right font-semibold text-sm"
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                          onClick={() => {
                            const newItems = [...otherPayables];
                            newItems.splice(index, 1);
                            setOtherPayables(newItems);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 p-4 flex items-center justify-between border border-slate-200">
              <span className="text-sm font-bold text-slate-700 uppercase tracking-widest">Total Fees</span>
              <span className="text-xl font-bold text-slate-900">
                {formatPeso(1800 + otherPayables.reduce((sum, p) => sum + p.amount, 0))}
              </span>
            </div>

            <div className="pt-2">
              <Label className="text-sm text-slate-800 font-bold tracking-wider mb-2 flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-slate-400" />
                Initial Remark (Optional)
              </Label>
              <Textarea 
                placeholder="Add any notes or context about this connection..."
                className="text-sm resize-none bg-slate-50 border-slate-200 h-20"
                value={initialRemark}
                onChange={(e) => setInitialRemark(e.target.value)}
              />
            </div>
          </CardContent>
          <CardFooter className="bg-slate-50/50 border-t border-slate-100 px-6 py-4 flex-col gap-3 items-stretch">
            {initError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{initError}</AlertDescription>
              </Alert>
            )}
            <Button 
              className="w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold shadow-sm"
              onClick={handleInitialize}
              disabled={isInitializing}
            >
              {isInitializing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              {canPostDirectly ? "Generate Connection Balance" : "Send for Approval"}
            </Button>
          </CardFooter>
        </Card>
      ) : (
        // Active State
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            
            {/* Payment History */}
            <Card className="border-slate-200 shadow-sm bg-white overflow-hidden">
              <CardHeader className="bg-slate-50/50 pb-4 border-b border-slate-100">
                <CardTitle className="text-base flex items-center gap-2 text-slate-800">
                  <History className="h-5 w-5 text-slate-500" />
                  Payment History
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {meterPayments.length === 0 ? (
                  <div className="p-8 text-center text-slate-500">
                    <Receipt className="h-8 w-8 mx-auto mb-3 text-slate-300" />
                    <p className="text-sm font-medium">No payments recorded yet.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {meterPayments.map((p, i) => (
                      <div key={i} className="p-4 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-[10px] bg-slate-100 text-slate-600 border-slate-200 uppercase tracking-wider">{p.slot}</Badge>
                            <span className={p.voided ? "text-sm font-bold text-slate-400 line-through" : "text-sm font-bold text-slate-800"}>
                              {formatPeso(p.amount)}
                            </span>
                            {p.voided && (
                              <Badge variant="secondary" className="text-[10px] bg-red-50 text-red-700 border-red-200">
                                VOIDED
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                            <span className="font-mono bg-slate-100 px-1.5 rounded text-slate-600">OR# {p.orNumber}</span>
                            {p.date && <span>• {new Date(p.date).toLocaleDateString()}</span>}
                          </div>
                          {p.voided && p.voidReason && (
                            <p className="text-[11px] text-red-600 mt-1">
                              Voided by {p.voidedBy} — {p.voidReason}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 text-sky-600 hover:text-sky-700 hover:bg-sky-50"
                            onClick={() => printDocument(<ConnectionFeeReceipt concessionaireId={concessionaire.id} paymentIndex={i} />)}
                          >
                            <Printer className="h-4 w-4 mr-1.5" />
                            <span className="text-xs font-semibold">Print</span>
                          </Button>
                          {!p.voided && canPostDirectly && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => {
                                setVoidTarget(p.orNumber);
                                setVoidReason("");
                                setVoidError(null);
                              }}
                            >
                              <span className="text-xs font-semibold">Void</span>
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            {/* Balance Summary */}
            <Card className="border-slate-200 shadow-sm bg-white">
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Total Fee</p>
                    <p className="text-lg font-semibold text-slate-900">{formatPeso(connectionFeeDetails.total)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Amount Paid</p>
                    <p className="text-lg font-semibold text-emerald-600">{formatPeso(totalPaid)}</p>
                  </div>
                  <div className="pt-4 border-t border-slate-100">
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Remaining Balance</p>
                    <p className="text-2xl font-bold text-slate-900">{formatPeso(concessionaire.waterMeterBalance)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Add Payment Form */}
            {!isFullyPaid && (
              <Card className="border-sky-100 shadow-sm bg-sky-50/30 overflow-hidden">
                <CardHeader className="bg-sky-50/50 pb-4 border-b border-sky-100">
                  <CardTitle className="text-sm flex items-center gap-2 text-sky-900 uppercase tracking-widest font-bold">
                    <CreditCard className="h-4 w-4 text-sky-600" />
                    Record Payment
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-5 space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">Payment Slot</Label>
                    <Select value={paymentSlot} onValueChange={(v) => v && handleSlotChange(v)}>
                      <SelectTrigger className="bg-white border-slate-200 h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableSlots.map((slot) => (
                          <SelectItem key={slot.value} value={slot.value}>
                            {slot.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <Label className="text-xs font-semibold text-slate-700">Amount (₱)</Label>
                      {paymentSlot !== "Full" && (
                        <button
                          className="text-[10px] font-bold text-sky-600 hover:text-sky-800 uppercase tracking-wider transition-colors"
                          onClick={() => setPaymentAmount(concessionaire.waterMeterBalance)}
                        >
                          Pay Remaining Balance
                        </button>
                      )}
                    </div>
                    <Input 
                      type="number"
                      min="1"
                      className="bg-white border-slate-200 h-9 text-sm font-semibold"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value ? Number(e.target.value) : "")}
                      placeholder="e.g. 450"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">OR Number <span className="text-red-500">*</span></Label>
                    <Input 
                      className="bg-white border-slate-200 h-9 text-sm font-mono"
                      value={paymentOr}
                      onChange={(e) => setPaymentOr(e.target.value)}
                      placeholder="As written on the receipt"
                      autoComplete="off"
                    />
                    <p className="text-[11px] text-slate-500">
                      Copy the number from the receipt booklet — it is not generated here.
                    </p>
                    {paymentOr.trim() && orNumberProblem(paymentOr) && (
                      <p className="text-[11px] text-red-600">{orNumberProblem(paymentOr)}</p>
                    )}
                  </div>
                  
                  {paymentError && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{paymentError}</AlertDescription>
                    </Alert>
                  )}

                  <Button 
                    className="w-full mt-2 bg-sky-600 hover:bg-sky-700 text-white font-semibold text-sm"
                    disabled={
                      isPaying ||
                      !paymentAmount ||
                      !paymentOr.trim() ||
                      orNumberProblem(paymentOr) !== null
                    }
                    onClick={handlePayment}
                  >
                    {isPaying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Banknote className="h-4 w-4 mr-2" />}
                    {canPostDirectly ? "Save Payment" : "Send Payment for Approval"}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Void a connection-fee payment. The record is kept and marked voided
          rather than deleted — a receipt that was physically issued stays in
          the ledger so its OR number remains accounted for. */}
      <Dialog open={voidTarget !== null} onOpenChange={(open) => !open && setVoidTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void payment {voidTarget}</DialogTitle>
            <DialogDescription>
              This restores the connection fee balance and frees the installment slot.
              The payment stays on record, marked voided.
            </DialogDescription>
          </DialogHeader>

          {voidError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{voidError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700">
              Reason <span className="text-red-500">*</span>
            </Label>
            <Textarea
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Wrong amount entered — ₱450 keyed as ₱4,500"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={isVoiding || !voidReason.trim()}
              onClick={handleVoidPayment}
            >
              {isVoiding && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Void Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
