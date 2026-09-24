/**
 * lib/firebase/payments.ts
 *
 * Records — and reverses — a concessionaire's payment against their water
 * bill balance. This is the counter-side transaction for the Collections
 * page. Distinct from addMeterPayment() in concessionaires.ts, which pays
 * down the one-time connection fee instead.
 *
 * Everything here runs inside a single Firestore transaction so the receipt,
 * the billingHistory ledger update, the balance change and the
 * delinquency-clock update can never end up inconsistent with each other.
 *
 * Two behaviours worth knowing about:
 *
 *  - A payment never exceeds the balance due. The office holds no advance
 *    credit: cash handed over beyond what is owed goes back as change, and
 *    the receipt records both the cash received and the change given so the
 *    drawer reconciles. Credit left on accounts from before this rule is
 *    still honoured — the mobile app takes it off the next bill — but nothing
 *    here adds to it any more.
 *
 *  - Payments are voided, never deleted. A cash receipt that was physically
 *    issued stays in the ledger marked `voided`, so the OR number remains
 *    accounted for and the reversal is itself auditable.
 */

import { doc, runTransaction, serverTimestamp, deleteField } from "firebase/firestore";
import { db } from "./firebase";
import { applyPaymentToHistory, isAccountApproved, reversePaymentInHistory } from "../billing";
import {
  billDocRef,
  fetchBills,
  fetchConcessionaireRaw,
  monthKeyFor,
  ownerFieldsOf,
  paymentDocRef,
} from "./bills";
import { logAuditEvent } from "./auditLog";
import { DuplicateOrNumberError, requireOrNumber } from "../receipts";
import { getFullName } from "../utils";
import type { BillingSummary, Concessionaire, PaymentRecord } from "./types";

const CONCESSIONAIRES_COLLECTION = "concessionaires";

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
 * water bill balance under the receipt number `rawOrNumber`, and returns the
 * resulting [PaymentRecord].
 *
 * The OR is typed in, never generated: the office issues receipts from the
 * booklet the treasury hands out against the Business Tax listing, so the
 * number on the paper receipt is the number that must be stored. It doubles
 * as the payment's id, so a number already used is refused
 * ([DuplicateOrNumberError]) rather than overwriting the earlier receipt.
 *
 * `options.approvedBy` records the admin who released a staff member's
 * payment from the approval queue; `actorEmail` stays whoever took the cash.
 *
 * `amount` is what goes against the bill and may not exceed the balance due —
 * that is refused with [InvalidPaymentAmountError], checked inside the
 * transaction against the balance as it stands then. `options.cashTendered`
 * is the cash actually handed over; when it is more than `amount`, the
 * difference is recorded as the change given back (see splitCashPayment).
 */
export async function recordPayment(
  concessionaireId: string,
  rawAmount: number,
  rawOrNumber: string,
  actorEmail: string,
  options: { approvedBy?: string; cashTendered?: number } = {}
): Promise<PaymentRecord> {
  const amount = toCentavos(rawAmount);
  if (!(amount > 0) || !Number.isFinite(amount)) {
    throw new InvalidPaymentAmountError("Payment amount must be greater than zero.");
  }
  const cashTendered =
    options.cashTendered !== undefined && Number.isFinite(options.cashTendered)
      ? toCentavos(options.cashTendered)
      : amount;
  if (cashTendered < amount) {
    throw new InvalidPaymentAmountError(
      `The cash received (₱${cashTendered.toFixed(2)}) is less than the payment (₱${amount.toFixed(2)}).`
    );
  }
  const changeGiven = toCentavos(cashTendered - amount);
  const orNumber = requireOrNumber(rawOrNumber);

  const docRef = doc(db, CONCESSIONAIRES_COLLECTION, concessionaireId);
  const now = new Date();

  // Bills live in a sub-collection now, and a transaction can't run a query —
  // only read documents by path. So the ledger is read up front; the
  // transaction then writes back only the bill documents whose amountPaid it
  // actually changes, which is a handful rather than the whole history.
  const owner = await fetchConcessionaireRaw(concessionaireId);
  if (!owner) throw new Error("Concessionaire not found.");
  if (!isAccountApproved(owner)) {
    throw new InvalidPaymentAmountError(
      "This account is waiting for admin approval and can't take payments yet."
    );
  }
  const existingBills = await fetchBills(concessionaireId, owner.billingHistory);

  const { paymentRecord, concessionaireName, touchedBills } = await runTransaction(
    db,
    async (transaction) => {
      // All reads must precede all writes inside a Firestore transaction.
      const snapshot = await transaction.get(docRef);
      if (!snapshot.exists()) {
        throw new Error("Concessionaire not found.");
      }
      // The OR is the payment's id, so an existing document means this
      // receipt number has already been recorded against this account.
      const receiptRef = paymentDocRef(concessionaireId, orNumber);
      const receiptSnapshot = await transaction.get(receiptRef);
      if (receiptSnapshot.exists()) throw new DuplicateOrNumberError(orNumber);

      const data = snapshot.data() as Concessionaire;
      const concessionaireName = getFullName(data);
      const outstandingBalance: number = data.billingBalance ?? 0;
      const waterMeterBalance: number = data.waterMeterBalance ?? 0;
      const billingHistory = existingBills;

      // No advance credit: the payment is capped at what is owed right now.
      // Checked here, against the balance inside the transaction, because a
      // staff request can sit in the queue while another payment lands.
      if (outstandingBalance <= 0) {
        throw new InvalidPaymentAmountError(
          "Nothing is owed on this account, so there is no payment to record. Give the money back."
        );
      }
      if (amount > outstandingBalance) {
        throw new InvalidPaymentAmountError(
          `₱${amount.toFixed(2)} is more than the ₱${outstandingBalance.toFixed(2)} balance due. ` +
            `Record ₱${outstandingBalance.toFixed(2)} and give the rest back as change.`
        );
      }

      const { updatedHistory, fullyPaid } = applyPaymentToHistory(
        billingHistory,
        amount,
        outstandingBalance
      );

      // Only the rows whose paid amount actually moved need rewriting.
      const paidBefore = new Map(billingHistory.map((b) => [b.month, b.amountPaid ?? 0]));
      const touchedBills = updatedHistory.filter(
        (b) => (paidBefore.get(b.month) ?? 0) !== (b.amountPaid ?? 0)
      );

      const newBillingBalance = fullyPaid ? 0 : toCentavos(outstandingBalance - amount);
      const newTotalBalance = toCentavos(newBillingBalance + waterMeterBalance);

      const paymentRecord: PaymentRecord = {
        orNumber,
        amount,
        date: now.toISOString(),
        recordedBy: actorEmail,
        balanceBefore: outstandingBalance,
        balanceAfter: newBillingBalance,
        appliedToBalance: amount,
        ...(changeGiven > 0 ? { cashTendered, changeGiven } : {}),
        ...(options.approvedBy ? { approvedBy: options.approvedBy } : {}),
      };

      const ownerFields = ownerFieldsOf(concessionaireId, data);

      transaction.set(receiptRef, { ...paymentRecord, ...ownerFields });

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

  const changeNote = paymentRecord.changeGiven
    ? ` Cash ₱${paymentRecord.cashTendered?.toFixed(2)}, change ₱${paymentRecord.changeGiven.toFixed(2)}.`
    : "";
  logAuditEvent(
    "Payment",
    `Recorded water bill payment of ₱${paymentRecord.amount.toFixed(2)} for ${concessionaireName || concessionaireId}. OR ${paymentRecord.orNumber}.${changeNote}`,
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
