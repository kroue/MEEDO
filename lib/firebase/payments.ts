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
import {
  billDocRef,
  fetchBills,
  fetchConcessionaireRaw,
  monthKeyFor,
  ownerFieldsOf,
  paymentDocRef,
} from "./bills";
import { logAuditEvent } from "./auditLog";
import { getFullName } from "../utils";
import type { BillingSummary, Concessionaire, PaymentRecord } from "./types";

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

  // Bills live in a sub-collection now, and a transaction can't run a query —
  // only read documents by path. So the ledger is read up front; the
  // transaction then writes back only the bill documents whose amountPaid it
  // actually changes, which is a handful rather than the whole history.
  const owner = await fetchConcessionaireRaw(concessionaireId);
  if (!owner) throw new Error("Concessionaire not found.");
  const existingBills = await fetchBills(concessionaireId, owner.billingHistory);

  const { paymentRecord, concessionaireName, touchedBills } = await runTransaction(
    db,
    async (transaction) => {
      // All reads must precede all writes inside a Firestore transaction.
      const snapshot = await transaction.get(docRef);
      if (!snapshot.exists()) {
        throw new Error("Concessionaire not found.");
      }
      const counterSnapshot = await transaction.get(counterRef);

      const data = snapshot.data() as Concessionaire;
      const concessionaireName = getFullName(data);
      const outstandingBalance: number = data.billingBalance ?? 0;
      const waterMeterBalance: number = data.waterMeterBalance ?? 0;
      const existingCredit: number = data.creditBalance ?? 0;
      const billingHistory = existingBills;

      const appliedToBalance = toCentavos(Math.min(amount, outstandingBalance));
      const creditedAmount = toCentavos(amount - appliedToBalance);

      const { updatedHistory, fullyPaid } = applyPaymentToHistory(
        billingHistory,
        appliedToBalance,
        outstandingBalance
      );

      // Only the rows whose paid amount actually moved need rewriting.
      const paidBefore = new Map(billingHistory.map((b) => [b.month, b.amountPaid ?? 0]));
      const touchedBills = updatedHistory.filter(
        (b) => (paidBefore.get(b.month) ?? 0) !== (b.amountPaid ?? 0)
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

      const ownerFields = ownerFieldsOf(concessionaireId, data);

      transaction.set(paymentDocRef(concessionaireId, orNumber), {
        ...paymentRecord,
        ...ownerFields,
      });

      touchedBills.forEach((b) => {
        transaction.set(
          billDocRef(concessionaireId, b.month),
          { ...b, ...ownerFields, monthKey: monthKeyFor(b.month) },
          { merge: true }
        );
      });

      const summary: BillingSummary = {
        monthsBilled: data.billingSummary?.monthsBilled ?? billingHistory.length,
        totalWaterCharged: data.billingSummary?.totalWaterCharged ?? 0,
        totalCollected: toCentavos((data.billingSummary?.totalCollected ?? 0) + amount),
        latestBill: data.billingSummary?.latestBill ?? null,
        previousBill: data.billingSummary?.previousBill ?? null,
      };

      transaction.update(docRef, {
        billingBalance: newBillingBalance,
        creditBalance: newCreditBalance,
        totalBalance: newTotalBalance,
        billingSummary: summary,
        // Balance cleared — the delinquency clock stops. A later bill starts a
        // fresh one (see the mobile app's uploadReading).
        ...(newBillingBalance <= 0 ? { delinquentSince: deleteField() } : {}),
        updatedBy: actorEmail,
        updatedAt: serverTimestamp(),
      });

      return { paymentRecord, concessionaireName, touchedBills };
    }
  );

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

  // Read the ledger before opening the transaction — see recordPayment.
  const owner = await fetchConcessionaireRaw(concessionaireId);
  if (!owner) throw new Error("Concessionaire not found.");
  const existingBills = await fetchBills(concessionaireId, owner.billingHistory);

  const { amount, concessionaireName } = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(docRef);
    if (!snapshot.exists()) throw new Error("Concessionaire not found.");

    const paymentRef = paymentDocRef(concessionaireId, orNumber);
    const paymentSnapshot = await transaction.get(paymentRef);

    const data = snapshot.data() as Concessionaire;
    const concessionaireName = getFullName(data);
    const billingHistory = existingBills;

    // Prefer the sub-collection document; fall back to the legacy array for an
    // account the migration hasn't reached yet.
    const legacyPayments = (data.payments ?? []) as PaymentRecord[];
    const target = paymentSnapshot.exists()
      ? (paymentSnapshot.data() as PaymentRecord)
      : legacyPayments.find((p) => p.orNumber === orNumber);
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
    const paidBefore = new Map(billingHistory.map((b) => [b.month, b.amountPaid ?? 0]));
    const touchedBills = updatedHistory.filter(
      (b) => (paidBefore.get(b.month) ?? 0) !== (b.amountPaid ?? 0)
    );

    const ownerFields = ownerFieldsOf(concessionaireId, data);
    const voidedPayment: PaymentRecord = {
      ...target,
      voided: true,
      voidedAt: now.toISOString(),
      voidedBy: actorEmail,
      voidReason: trimmedReason,
    };

    transaction.set(paymentRef, { ...voidedPayment, ...ownerFields });

    touchedBills.forEach((b) => {
      transaction.set(
        billDocRef(concessionaireId, b.month),
        { ...b, ...ownerFields, monthKey: monthKeyFor(b.month) },
        { merge: true }
      );
    });

    const summary: BillingSummary = {
      monthsBilled: data.billingSummary?.monthsBilled ?? billingHistory.length,
      totalWaterCharged: data.billingSummary?.totalWaterCharged ?? 0,
      totalCollected: toCentavos(
        Math.max(0, (data.billingSummary?.totalCollected ?? 0) - target.amount)
      ),
      latestBill: data.billingSummary?.latestBill ?? null,
      previousBill: data.billingSummary?.previousBill ?? null,
    };

    transaction.update(docRef, {
      billingBalance: restoredBalance,
      creditBalance: restoredCredit,
      totalBalance: toCentavos(restoredBalance + waterMeterBalance),
      billingSummary: summary,
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
