/**
 * lib/firebase/issueBill.ts
 *
 * Issuing and reversing a bill from the office.
 *
 * Until now every bill came from a phone: all the billing maths lived in
 * `WaterBillingCalculator.kt` and the console only read the results. That left
 * a real gap — a concessionaire never assigned for reading was never billed, so
 * no surcharge and no extension fee ever accrued however long the balance sat,
 * and there was no way to correct a wrong bill except to send someone back out.
 *
 * This is the office-side counterpart to the phone's `uploadReading`. It shares
 * the same rules deliberately:
 *
 *  - The bill is calculated inside the transaction against the balance read
 *    from the server, never a figure computed by the caller.
 *  - Re-issuing for a month that already has a bill replaces it, backing that
 *    bill's own charges out of the balance first, so a correction can never
 *    compound the previous attempt.
 *  - The OR number is minted from the shared `settings/orCounter` and reused
 *    on a correction rather than burning a new one.
 *
 * The one difference is provenance: these bills are stamped `source: "office"`,
 * and `estimated: true` when the reading was estimated rather than read off the
 * meter, so a bill nobody physically verified is never silently indistinguishable
 * from one that was.
 */

import { doc, runTransaction, serverTimestamp, deleteField } from "firebase/firestore";
import { db } from "./firebase";
import { calculateBill, validateReading, type BillingResult } from "../billingCalculator";
import {
  billDocRef,
  fetchSummaryWindow,
  monthKeyFor,
  nextBillingSummary,
  ownerFieldsOf,
  readBillInTransaction,
} from "./bills";
import { logAuditEvent } from "./auditLog";
import { getFullName } from "../utils";
import type { BillingSummary, Concessionaire, MonthlyBillingRecord } from "./types";

const CONCESSIONAIRES = "concessionaires";
const OR_COUNTER_DOC = "orCounter";

export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingError";
  }
}

function toCentavos(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * What a bill added to the running balance on top of whatever it carried in.
 * Subtracting it recovers the balance as it stood before that bill — the same
 * calculation the phone's upload does, for the same reason.
 */
function chargesAddedBy(record: MonthlyBillingRecord | null): number {
  if (!record) return 0;
  if (record.minimumCharge === undefined && record.commodityCharge === undefined) {
    // Written before the itemised breakdown existed.
    return Math.max(0, record.pesoAmount - (record.overdueBalance ?? 0));
  }
  return (
    (record.minimumCharge ?? 0) +
    (record.commodityCharge ?? 0) +
    (record.overdueSurcharge ?? 0) +
    (record.extensionFee ?? 0) -
    (record.creditApplied ?? 0)
  );
}

export interface IssueBillInput {
  concessionaireId: string;
  /** e.g. "SEP 2026" */
  monthStr: string;
  currentReading: number;
  /** True when the reading is the office's estimate, not a meter reading. */
  estimated: boolean;
  /** Free text recorded on the bill's audit entry. */
  note?: string;
  actorEmail: string;
}

export interface IssueBillResult {
  orNumber: string;
  billing: BillingResult;
  monthStr: string;
}

/**
 * Previews what `issueBill` would produce, without writing anything.
 *
 * Reads the same fields the transaction will, so the number shown in the
 * dialog is the number that gets billed — barring a concurrent change, which
 * the transaction itself would then recalculate against.
 */
export async function previewBill(
  c: Concessionaire,
  monthStr: string,
  currentReading: number,
  now: number = Date.now()
): Promise<{ billing: BillingResult; previousReading: number; replacing: MonthlyBillingRecord | null }> {
  const window = await fetchSummaryWindow(c.id, c.billingHistory);
  const existing = window.find((b) => b.month === monthStr) ?? null;
  const prior = window.find((b) => b.month !== monthStr) ?? null;
  const previousReading = prior?.reading ?? 0;

  const problem = validateReading(previousReading, currentReading);
  if (problem) {
    throw new BillingError(
      problem.kind === "below-previous"
        ? `That's below the previous reading of ${previousReading} m³.`
        : problem.kind === "implausibly-high"
        ? `That would be ${Math.round(problem.consumption)} m³ this cycle, which looks like a typo.`
        : "Enter a valid meter reading."
    );
  }

  const priorBalance = Math.max(0, (c.billingBalance ?? 0) - chargesAddedBy(existing));
  const creditAvailable = (c.creditBalance ?? 0) + (existing?.creditApplied ?? 0);

  const billing = calculateBill({
    previousReading,
    currentReading,
    classification: c.classification,
    overdueBalance: priorBalance,
    delinquentSinceMillis: c.delinquentSince ? Date.parse(c.delinquentSince) : null,
    creditBalance: creditAvailable,
    extensionFeeAlreadyCharged: window.some(
      (b) => b.month !== monthStr && b.extensionFeeCharged === true
    ),
    now,
  });

  return { billing, previousReading, replacing: existing };
}

/**
 * Issues (or re-issues) the bill for one month and updates the account's
 * balance, credit, delinquency clock and billing summary in one transaction.
 */
export async function issueBill(input: IssueBillInput): Promise<IssueBillResult> {
  const { concessionaireId, monthStr, currentReading, estimated, note, actorEmail } = input;

  const docRef = doc(db, CONCESSIONAIRES, concessionaireId);
  const counterRef = doc(db, "settings", OR_COUNTER_DOC);
  const now = new Date();
  const billingYear = parseInt(monthStr.split(/\s+/)[1] ?? String(now.getFullYear()), 10);

  // Queries aren't allowed inside a transaction, so the window the summary
  // rebuild needs is read first. A concurrent write between here and the
  // transaction can only affect which bills appear as latest/previous, which
  // the next write corrects.
  const raw = await import("./bills").then((m) => m.fetchConcessionaireRaw(concessionaireId));
  if (!raw) throw new BillingError("Concessionaire not found.");
  const summaryWindow = await fetchSummaryWindow(concessionaireId, raw.billingHistory);

  const result = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(docRef);
    if (!snapshot.exists()) throw new BillingError("Concessionaire not found.");
    const data = snapshot.data() as Concessionaire;

    const existing = await readBillInTransaction(transaction, concessionaireId, monthStr);

    const priorBill = summaryWindow.find((b) => b.month !== monthStr) ?? null;
    const previousReading = priorBill?.reading ?? 0;

    const problem = validateReading(previousReading, currentReading);
    if (problem) {
      throw new BillingError(
        problem.kind === "below-previous"
          ? `That's below the previous reading of ${previousReading} m³.`
          : problem.kind === "implausibly-high"
          ? `That would be ${Math.round(problem.consumption)} m³ this cycle, which looks like a typo.`
          : "Enter a valid meter reading."
      );
    }

    const storedBalance = data.billingBalance ?? 0;
    const storedCredit = data.creditBalance ?? 0;
    const waterMeterBalance = data.waterMeterBalance ?? 0;

    const priorBalance = Math.max(0, storedBalance - chargesAddedBy(existing));
    const creditAvailable = storedCredit + (existing?.creditApplied ?? 0);
    const delinquentSince = data.delinquentSince ? Date.parse(data.delinquentSince) : null;

    const billing = calculateBill({
      previousReading,
      currentReading,
      classification: data.classification,
      overdueBalance: priorBalance,
      delinquentSinceMillis: Number.isNaN(delinquentSince as number) ? null : delinquentSince,
      creditBalance: creditAvailable,
      extensionFeeAlreadyCharged: summaryWindow.some(
        (b) => b.month !== monthStr && b.extensionFeeCharged === true
      ),
      now: now.getTime(),
    });

    // Reuse the OR number on a correction rather than burning a new one.
    let orNumber = existing?.orNumber?.trim() || "";
    if (!orNumber) {
      const counterSnapshot = await transaction.get(counterRef);
      const counterYear = counterSnapshot.exists() ? counterSnapshot.data().year : null;
      const lastNumber = counterSnapshot.exists() ? counterSnapshot.data().lastNumber ?? 0 : 0;
      const next = counterYear === billingYear ? lastNumber + 1 : 1;
      orNumber = `OR-${billingYear}-${String(next).padStart(6, "0")}`;
      transaction.set(counterRef, { year: billingYear, lastNumber: next });
    }

    const record: MonthlyBillingRecord = {
      month: monthStr,
      reading: currentReading,
      previousReading,
      pesoAmount: billing.totalAmountDue,
      orNumber,
      // Never wipe what the office already collected against this cycle.
      amountPaid: existing?.amountPaid ?? 0,
      billingDate: now.toISOString(),
      extensionFeeCharged: billing.extensionFee > 0,
      minimumCharge: billing.minimumCharge,
      commodityCharge: billing.commodityCharge,
      overdueBalance: billing.overdueBalance,
      overdueSurcharge: billing.overdueSurcharge,
      extensionFee: billing.extensionFee,
      creditApplied: billing.creditApplied,
      meterRolledOver: billing.meterRolledOver,
      source: "office",
      estimated,
      dueDateMillis: billing.dueDateMillis,
      projectedOverdueTotal: billing.projectedOverdueTotal,
    };

    transaction.set(billDocRef(concessionaireId, monthStr), {
      ...record,
      ...ownerFieldsOf(concessionaireId, data),
      monthKey: monthKeyFor(monthStr),
    });

    const newBillingBalance = billing.totalAmountDue;
    const summary = nextBillingSummary(data.billingSummary, summaryWindow, {
      month: monthStr,
      before: existing,
      after: record,
    });

    transaction.update(docRef, {
      billingBalance: newBillingBalance,
      creditBalance: billing.creditRemaining,
      totalBalance: toCentavos(newBillingBalance + waterMeterBalance),
      billingSummary: summary,
      // The clock starts when a balance appears on a cleared account and stops
      // when it's settled; issuing a new bill never restarts it.
      ...(newBillingBalance <= 0
        ? { delinquentSince: deleteField() }
        : delinquentSince
        ? {}
        : { delinquentSince: now.toISOString() }),
      updatedBy: actorEmail,
      updatedAt: serverTimestamp(),
    });

    return { orNumber, billing, monthStr, name: getFullName(data) };
  });

  logAuditEvent(
    "Account Update",
    `Issued ${estimated ? "an ESTIMATED " : "a "}bill from the office for ${
      result.name || concessionaireId
    }, ${monthStr}: ₱${result.billing.totalAmountDue.toFixed(2)}, OR ${result.orNumber}.` +
      (note ? ` Note: ${note}` : ""),
    actorEmail
  );

  return { orNumber: result.orNumber, billing: result.billing, monthStr: result.monthStr };
}

/**
 * Reverses a bill: restores the balance to where it stood before, returns any
 * credit the bill consumed, and marks the record voided rather than deleting
 * it, so the OR number stays accounted for.
 *
 * Only meaningful for the most recent bill — reversing an older one would
 * leave every later bill computed from a balance that no longer follows from
 * it, so that is refused rather than quietly producing a wrong ledger.
 */
export async function voidBill(
  concessionaireId: string,
  monthStr: string,
  reason: string,
  actorEmail: string
): Promise<void> {
  const trimmed = reason.trim();
  if (!trimmed) throw new BillingError("A reason is required to void a bill.");

  const docRef = doc(db, CONCESSIONAIRES, concessionaireId);
  const now = new Date();

  const raw = await import("./bills").then((m) => m.fetchConcessionaireRaw(concessionaireId));
  if (!raw) throw new BillingError("Concessionaire not found.");
  const summaryWindow = await fetchSummaryWindow(concessionaireId, raw.billingHistory);

  const latest = summaryWindow[0];
  if (!latest) throw new BillingError("This account has no bills to void.");
  if (latest.month !== monthStr) {
    throw new BillingError(
      `Only the most recent bill (${latest.month}) can be voided. Voiding an older one would ` +
        `leave every bill after it computed from a balance that no longer follows.`
    );
  }

  const name = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(docRef);
    if (!snapshot.exists()) throw new BillingError("Concessionaire not found.");
    const data = snapshot.data() as Concessionaire;

    const existing = await readBillInTransaction(transaction, concessionaireId, monthStr);
    if (!existing) throw new BillingError(`No bill found for ${monthStr}.`);
    if (existing.voided) throw new BillingError(`The ${monthStr} bill is already voided.`);

    const restoredBalance = Math.max(
      0,
      toCentavos((data.billingBalance ?? 0) - chargesAddedBy(existing))
    );
    const restoredCredit = toCentavos((data.creditBalance ?? 0) + (existing.creditApplied ?? 0));
    const waterMeterBalance = data.waterMeterBalance ?? 0;

    const voidedRecord: MonthlyBillingRecord = {
      ...existing,
      voided: true,
      voidedAt: now.toISOString(),
      voidedBy: actorEmail,
      voidReason: trimmed,
    };

    transaction.set(billDocRef(concessionaireId, monthStr), {
      ...voidedRecord,
      ...ownerFieldsOf(concessionaireId, data),
      monthKey: monthKeyFor(monthStr),
    });

    // A voided bill still occupies its month — it stays in the summary window
    // so the next bill's "previous reading" is unaffected, but it contributes
    // nothing to the water-sold total.
    const summary: BillingSummary = nextBillingSummary(data.billingSummary, summaryWindow, {
      month: monthStr,
      before: existing,
      after: voidedRecord,
    });
    summary.totalWaterCharged = toCentavos(
      summary.totalWaterCharged - (voidedRecord.minimumCharge ?? 0) - (voidedRecord.commodityCharge ?? 0)
    );

    transaction.update(docRef, {
      billingBalance: restoredBalance,
      creditBalance: restoredCredit,
      totalBalance: toCentavos(restoredBalance + waterMeterBalance),
      billingSummary: summary,
      ...(restoredBalance <= 0 ? { delinquentSince: deleteField() } : {}),
      updatedBy: actorEmail,
      updatedAt: serverTimestamp(),
    });

    return getFullName(data);
  });

  logAuditEvent(
    "Account Update",
    `VOIDED the ${monthStr} bill for ${name || concessionaireId}. Reason: ${trimmed}`,
    actorEmail
  );
}
