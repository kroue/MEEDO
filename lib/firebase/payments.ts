/**
 * lib/firebase/payments.ts
 *
 * Records — and reverses — a concessionaire's payment against their water
 * bill balance. This is the counter-side transaction for the Collections
 * page. Distinct from addMeterPayment() in concessionaires.ts, which pays
 * down the one-time connection fee instead.
 *
 * Everything here runs inside a single Firestore transaction so the OR
 * number mint, the billingHistory ledger update, the balance change and the
 * delinquency-clock update can never end up inconsistent with each other.
 *
 * Two behaviours worth knowing about:
 *
 *  - Overpayment is accepted. Anything beyond what's owed becomes
 *    `creditBalance`, which the mobile app draws down against the next bill.
 *    Refusing advance payments left the cashier with no legitimate option
 *    when someone wanted to pay ahead.
 *
 *  - Payments are voided, never deleted. A cash receipt that was physically
 *    issued stays in the ledger marked `voided`, so the OR number remains
 *    accounted for and the reversal is itself auditable.
 */

import { doc, runTransaction, serverTimestamp, deleteField } from "firebase/firestore";
import { db } from "./firebase";
import { applyPaymentToHistory, reversePaymentInHistory } from "../billing";
import { logAuditEvent } from "./auditLog";
import { getFullName } from "../utils";
import type { PaymentRecord, MonthlyBillingRecord } from "./types";

const CONCESSIONAIRES_COLLECTION = "concessionaires";
const PAYMENT_COUNTER_DOC = "paymentOrCounter";

export class InvalidPaymentAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPaymentAmountError";
  }
}

export class PaymentNotFoundError extends Error {
  constructor(orNumber: string) {
    super(`No payment found with receipt number ${orNumber}.`);
    this.name = "PaymentNotFoundError";
  }
}

export class PaymentAlreadyVoidedError extends Error {
  constructor(orNumber: string) {
    super(`Payment ${orNumber} has already been voided.`);
    this.name = "PaymentAlreadyVoidedError";
  }
}

/** Rounds to centavos — float arithmetic on money otherwise leaves 0.30000000000000004 in Firestore. */
function toCentavos(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Records a payment of `amount` against `concessionaireId`'s outstanding
 * water bill balance, mints a sequential "PMT-YYYY-NNNNNN" receipt number,
 * and returns the resulting [PaymentRecord].
 *
 * Any amount beyond the outstanding balance is accepted and held as advance
 * credit on the account. Throws [InvalidPaymentAmountError] only if `amount`
 * is not a positive number.
 */
export async function recordPayment(
  concessionaireId: string,
  rawAmount: number,
  actorEmail: string
): Promise<PaymentRecord> {
  const amount = toCentavos(rawAmount);
  if (!(amount > 0) || !Number.isFinite(amount)) {
    throw new InvalidPaymentAmountError("Payment amount must be greater than zero.");
  }

  const docRef = doc(db, CONCESSIONAIRES_COLLECTION, concessionaireId);
  const counterRef = doc(db, "settings", PAYMENT_COUNTER_DOC);
  const now = new Date();

  const { paymentRecord, concessionaireName } = await runTransaction(db, async (transaction) => {
    // All reads must precede all writes inside a Firestore transaction.
    const snapshot = await transaction.get(docRef);
    if (!snapshot.exists()) {
      throw new Error("Concessionaire not found.");
    }
    const counterSnapshot = await transaction.get(counterRef);

    const data = snapshot.data();
    const concessionaireName = getFullName(data as { firstName?: string; lastName?: string });
    const outstandingBalance: number = data.billingBalance ?? 0;
    const waterMeterBalance: number = data.waterMeterBalance ?? 0;
    const existingCredit: number = data.creditBalance ?? 0;
    const billingHistory = (data.billingHistory ?? []) as MonthlyBillingRecord[];
    const payments = (data.payments ?? []) as PaymentRecord[];

    const appliedToBalance = toCentavos(Math.min(amount, outstandingBalance));
    const creditedAmount = toCentavos(amount - appliedToBalance);

    const { updatedHistory, fullyPaid } = applyPaymentToHistory(
      billingHistory,
      appliedToBalance,
      outstandingBalance
    );

    const counterYear = counterSnapshot.exists() ? counterSnapshot.data().year : null;
    const lastNumber = counterSnapshot.exists() ? counterSnapshot.data().lastNumber ?? 0 : 0;
    const billingYear = now.getFullYear();
    const nextNumber = counterYear === billingYear ? lastNumber + 1 : 1;
    const orNumber = `PMT-${billingYear}-${String(nextNumber).padStart(6, "0")}`;

    transaction.set(counterRef, { year: billingYear, lastNumber: nextNumber });

    const newBillingBalance = fullyPaid ? 0 : toCentavos(outstandingBalance - appliedToBalance);
    const newCreditBalance = toCentavos(existingCredit + creditedAmount);
    const newTotalBalance = toCentavos(newBillingBalance + waterMeterBalance);

    const paymentRecord: PaymentRecord = {
      orNumber,
      amount,
      date: now.toISOString(),
      recordedBy: actorEmail,
      balanceBefore: outstandingBalance,
      balanceAfter: newBillingBalance,
      appliedToBalance,
      creditedAmount,
    };

    transaction.update(docRef, {
      billingHistory: updatedHistory,
      billingBalance: newBillingBalance,
      creditBalance: newCreditBalance,
      totalBalance: newTotalBalance,
      // Rewriting the whole array rather than arrayUnion: void marks a
      // record in place, and arrayUnion can't express that.
      payments: [...payments, paymentRecord],
      // Balance cleared — the delinquency clock stops. A later bill starts a
      // fresh one (see the mobile app's uploadReading).
      ...(newBillingBalance <= 0 ? { delinquentSince: deleteField() } : {}),
      updatedBy: actorEmail,
      updatedAt: serverTimestamp(),
    });

    return { paymentRecord, concessionaireName };
  });

  const creditNote =
    paymentRecord.creditedAmount && paymentRecord.creditedAmount > 0
      ? ` ₱${paymentRecord.creditedAmount.toFixed(2)} held as advance credit.`
      : "";
  logAuditEvent(
    "Payment",
    `Recorded water bill payment of ₱${paymentRecord.amount.toFixed(2)} for ${concessionaireName || concessionaireId}. OR ${paymentRecord.orNumber}.${creditNote}`,
    actorEmail
  );

  return paymentRecord;
}

/**
 * Reverses a previously recorded water bill payment: restores the balance,
 * unwinds the history ledger, returns any advance credit the payment created,
 * and marks the payment record `voided` rather than removing it.
 *
 * `reason` is required — a reversal with no stated cause is exactly the kind
 * of entry an audit needs an explanation for.
 */
export async function voidPayment(
  concessionaireId: string,
  orNumber: string,
  reason: string,
  actorEmail: string
): Promise<void> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new InvalidPaymentAmountError("A reason is required to void a payment.");
  }

  const docRef = doc(db, CONCESSIONAIRES_COLLECTION, concessionaireId);
  const now = new Date();

  const { amount, concessionaireName } = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(docRef);
    if (!snapshot.exists()) throw new Error("Concessionaire not found.");

    const data = snapshot.data();
    const concessionaireName = getFullName(data as { firstName?: string; lastName?: string });
    const payments = (data.payments ?? []) as PaymentRecord[];
    const billingHistory = (data.billingHistory ?? []) as MonthlyBillingRecord[];

    const target = payments.find((p) => p.orNumber === orNumber);
    if (!target) throw new PaymentNotFoundError(orNumber);
    if (target.voided) throw new PaymentAlreadyVoidedError(orNumber);

    // Records written before the split existed applied their whole amount.
    const appliedToBalance = target.appliedToBalance ?? target.amount;
    const creditedAmount = target.creditedAmount ?? 0;

    const currentBalance: number = data.billingBalance ?? 0;
    const currentCredit: number = data.creditBalance ?? 0;
    const waterMeterBalance: number = data.waterMeterBalance ?? 0;

    const restoredBalance = toCentavos(currentBalance + appliedToBalance);
    // Credit may already have been spent against a later bill; never go negative.
    const restoredCredit = toCentavos(Math.max(0, currentCredit - creditedAmount));

    const updatedHistory = reversePaymentInHistory(billingHistory, appliedToBalance);

    const updatedPayments = payments.map((p) =>
      p.orNumber === orNumber
        ? {
            ...p,
            voided: true,
            voidedAt: now.toISOString(),
            voidedBy: actorEmail,
            voidReason: trimmedReason,
          }
        : p
    );

    transaction.update(docRef, {
      payments: updatedPayments,
      billingHistory: updatedHistory,
      billingBalance: restoredBalance,
      creditBalance: restoredCredit,
      totalBalance: toCentavos(restoredBalance + waterMeterBalance),
      // The account owes again, so the delinquency clock restarts — dated
      // from the reversal, not backdated, since the reversal is what made it
      // delinquent as far as the record is concerned.
      ...(restoredBalance > 0 && !data.delinquentSince
        ? { delinquentSince: now.toISOString() }
        : {}),
      updatedBy: actorEmail,
      updatedAt: serverTimestamp(),
    });

    return { amount: target.amount, concessionaireName };
  });

  logAuditEvent(
    "Payment",
    `VOIDED water bill payment ${orNumber} (₱${amount.toFixed(2)}) for ${concessionaireName || concessionaireId}. Reason: ${trimmedReason}`,
    actorEmail
  );
}
