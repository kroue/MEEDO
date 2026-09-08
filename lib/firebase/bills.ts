/**
 * lib/firebase/bills.ts
 *
 * Reading and writing bills and payments now that they live in
 * sub-collections rather than arrays on the concessionaire document.
 *
 * ### Why they moved
 *
 * Firestore caps a document at 1 MiB, and every write rewrites the whole
 * document. With a bill and a payment appended per month per account —
 * each bill carrying a full itemised breakdown — the arrays grew without
 * bound, and the mobile app's upload transaction rewrote the entire history
 * on every sync just to add one entry.
 *
 * ### The shape
 *
 *   concessionaires/{id}/bills/{monthKey}       one document per billing cycle
 *   concessionaires/{id}/payments/{orNumber}    one document per receipt
 *
 * Both carry denormalised owner fields (name, barangay, classification) so
 * collection-group queries — the Billing list, Reports, the recent-payments
 * feed — can filter and render without reading every parent. Firestore has no
 * joins; that duplication is the price of querying across sub-collections.
 *
 * The parent keeps `billingSummary`, a fixed-size view rewritten on every bill
 * write: lifetime totals plus the latest two bills. That is precisely what the
 * mobile app needs, so a route download stays one query instead of one query
 * per consumer.
 *
 * ### Migrating
 *
 * Accounts written before the move still hold `billingHistory` and `payments`
 * arrays. Everything here reads both shapes, preferring the sub-collection, so
 * the two can coexist while /migrate backfills. Nothing writes the arrays any
 * more.
 */

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Transaction,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { monthKeyFor, monthSortKey, sortHistoryAsc, sortHistoryDesc, waterChargeOf } from "../billing";
import { getFullName } from "../utils";
import type {
  BillDocument,
  BillingSummary,
  Concessionaire,
  DenormalisedOwner,
  MonthlyBillingRecord,
  PaymentDocument,
  PaymentRecord,
} from "./types";

const CONCESSIONAIRES = "concessionaires";
export const BILLS_SUBCOLLECTION = "bills";
export const PAYMENTS_SUBCOLLECTION = "payments";

export function billsRef(concessionaireId: string) {
  return collection(db, CONCESSIONAIRES, concessionaireId, BILLS_SUBCOLLECTION);
}

export function paymentsRef(concessionaireId: string) {
  return collection(db, CONCESSIONAIRES, concessionaireId, PAYMENTS_SUBCOLLECTION);
}

export function billDocRef(concessionaireId: string, monthStr: string) {
  return doc(db, CONCESSIONAIRES, concessionaireId, BILLS_SUBCOLLECTION, monthKeyFor(monthStr));
}

export function paymentDocRef(concessionaireId: string, orNumber: string) {
  return doc(db, CONCESSIONAIRES, concessionaireId, PAYMENTS_SUBCOLLECTION, orNumber);
}

/** Owner fields stamped onto every bill and payment document. */
export function ownerFieldsOf(
  concessionaireId: string,
  c: Partial<Concessionaire>
): DenormalisedOwner {
  return {
    concessionaireId,
    concessionaireName: getFullName(c),
    barangay: c.barangay ?? "",
    meterNumber: c.meterNumber ?? "",
    classification: c.classification ?? "RESIDENTIAL",
  };
}

// ── Reading ────────────────────────────────────────────────────────────────

/** True once this account's bills have been moved into the sub-collection. */
export function isMigrated(c: Pick<Concessionaire, "billingSummary">): boolean {
  return c.billingSummary !== undefined;
}

/**
 * One account's bills, newest first.
 *
 * Falls back to the legacy `billingHistory` array for accounts the migration
 * hasn't reached, so every caller works against either shape.
 */
export async function fetchBills(
  concessionaireId: string,
  legacy?: MonthlyBillingRecord[]
): Promise<MonthlyBillingRecord[]> {
  const snapshot = await getDocs(query(billsRef(concessionaireId), orderBy("monthKey", "desc")));
  if (!snapshot.empty) {
    return snapshot.docs.map((d) => d.data() as MonthlyBillingRecord);
  }
  return sortHistoryDesc(legacy ?? []);
}

export function subscribeToBills(
  concessionaireId: string,
  legacy: () => MonthlyBillingRecord[],
  onData: (bills: MonthlyBillingRecord[]) => void,
  onError: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(billsRef(concessionaireId), orderBy("monthKey", "desc")),
    (snapshot) => {
      if (snapshot.empty) {
        onData(sortHistoryDesc(legacy()));
        return;
      }
      onData(snapshot.docs.map((d) => d.data() as MonthlyBillingRecord));
    },
    onError
  );
}

export async function fetchPayments(
  concessionaireId: string,
  legacy?: PaymentRecord[]
): Promise<PaymentRecord[]> {
  const snapshot = await getDocs(query(paymentsRef(concessionaireId), orderBy("date", "desc")));
  if (!snapshot.empty) {
    return snapshot.docs.map((d) => d.data() as PaymentRecord);
  }
  return [...(legacy ?? [])].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export function subscribeToPayments(
  concessionaireId: string,
  legacy: () => PaymentRecord[],
  onData: (payments: PaymentRecord[]) => void,
  onError: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(paymentsRef(concessionaireId), orderBy("date", "desc")),
    (snapshot) => {
      if (snapshot.empty) {
        onData(
          [...legacy()].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        );
        return;
      }
      onData(snapshot.docs.map((d) => d.data() as PaymentRecord));
    },
    onError
  );
}

// ── Cross-account queries ──────────────────────────────────────────────────

/**
 * Bills across every account, newest month first — what the Billing list page
 * shows. Bounded by `max` because this is a collection group over the whole
 * district's history; the page filters client-side within that window.
 */
export async function fetchRecentBills(max = 500, barangay?: string): Promise<BillDocument[]> {
  const constraints = barangay && barangay !== "all" ? [where("barangay", "==", barangay)] : [];
  const snapshot = await getDocs(
    query(
      collectionGroup(db, BILLS_SUBCOLLECTION),
      ...constraints,
      orderBy("monthKey", "desc"),
      fsLimit(max)
    )
  );
  return snapshot.docs.map((d) => d.data() as BillDocument);
}

/** The most recent payments across every account — the Collections feed. */
export async function fetchRecentPayments(max = 15): Promise<PaymentDocument[]> {
  const snapshot = await getDocs(
    query(collectionGroup(db, PAYMENTS_SUBCOLLECTION), orderBy("date", "desc"), fsLimit(max))
  );
  return snapshot.docs.map((d) => d.data() as PaymentDocument);
}

export function subscribeToRecentPayments(
  onData: (payments: PaymentDocument[]) => void,
  onError: (e: Error) => void,
  max = 15
): Unsubscribe {
  return onSnapshot(
    query(collectionGroup(db, PAYMENTS_SUBCOLLECTION), orderBy("date", "desc"), fsLimit(max)),
    (snapshot) => onData(snapshot.docs.map((d) => d.data() as PaymentDocument)),
    onError
  );
}

// ── Summary maintenance ────────────────────────────────────────────────────

/** Rounds to centavos so float noise never reaches Firestore. */
function toCentavos(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Recomputes `billingSummary` after `changed` replaces (or removes) the bill
 * for its month.
 *
 * Deliberately incremental rather than re-reading the sub-collection: this
 * runs inside the same transaction as the bill write, and a transaction can't
 * run a query — only direct document reads. The previous summary plus the one
 * bill being changed is enough for every field except `latestBill` /
 * `previousBill`, which need the neighbouring months; those come from
 * `recentBills`, which the caller reads before opening the transaction.
 */
export function nextBillingSummary(
  previous: BillingSummary | undefined,
  recentBills: MonthlyBillingRecord[],
  changed: { month: string; before: MonthlyBillingRecord | null; after: MonthlyBillingRecord | null }
): BillingSummary {
  const base: BillingSummary = previous ?? {
    monthsBilled: 0,
    totalWaterCharged: 0,
    totalCollected: 0,
    latestBill: null,
    previousBill: null,
  };

  const beforeCharge = changed.before ? waterChargeOf(changed.before) : 0;
  const afterCharge = changed.after ? waterChargeOf(changed.after) : 0;

  const monthsDelta = (changed.after ? 1 : 0) - (changed.before ? 1 : 0);

  // Merge the change into the window the caller handed us, then take the top
  // two by month.
  const merged = recentBills.filter((b) => b.month !== changed.month);
  if (changed.after) merged.push(changed.after);
  const ordered = sortHistoryDesc(merged);

  return {
    monthsBilled: Math.max(0, base.monthsBilled + monthsDelta),
    totalWaterCharged: toCentavos(base.totalWaterCharged - beforeCharge + afterCharge),
    totalCollected: base.totalCollected,
    latestBill: ordered[0] ?? null,
    previousBill: ordered[1] ?? null,
  };
}

/**
 * The bills a summary rebuild needs to see: the latest few by month, which is
 * enough to re-derive `latestBill` and `previousBill` after any single change.
 * Read outside the transaction — queries aren't allowed inside one.
 */
export async function fetchSummaryWindow(
  concessionaireId: string,
  legacy?: MonthlyBillingRecord[]
): Promise<MonthlyBillingRecord[]> {
  const snapshot = await getDocs(
    query(billsRef(concessionaireId), orderBy("monthKey", "desc"), fsLimit(4))
  );
  if (!snapshot.empty) return snapshot.docs.map((d) => d.data() as MonthlyBillingRecord);
  return sortHistoryDesc(legacy ?? []).slice(0, 4);
}

/**
 * Full rebuild from the sub-collection. Used by the migration and by anything
 * that needs to be certain the summary is right rather than merely consistent.
 */
export async function rebuildBillingSummary(
  concessionaireId: string,
  fallbackBills?: MonthlyBillingRecord[],
  fallbackPayments?: PaymentRecord[]
): Promise<BillingSummary> {
  const bills = await fetchBills(concessionaireId, fallbackBills);
  const payments = await fetchPayments(concessionaireId, fallbackPayments);
  const ordered = sortHistoryDesc(bills);

  return {
    monthsBilled: ordered.length,
    totalWaterCharged: toCentavos(ordered.reduce((sum, b) => sum + waterChargeOf(b), 0)),
    totalCollected: toCentavos(
      payments.reduce((sum, p) => (p.voided ? sum : sum + p.amount), 0)
    ),
    latestBill: ordered[0] ?? null,
    previousBill: ordered[1] ?? null,
  };
}

/**
 * Reads one bill inside a transaction. Transactions can only read documents by
 * path, which is exactly why the bill's ID is its month key.
 */
export async function readBillInTransaction(
  transaction: Transaction,
  concessionaireId: string,
  monthStr: string
): Promise<MonthlyBillingRecord | null> {
  const snapshot = await transaction.get(billDocRef(concessionaireId, monthStr));
  return snapshot.exists() ? (snapshot.data() as MonthlyBillingRecord) : null;
}

/** Convenience for callers that only hold a document ID. */
export async function fetchConcessionaireRaw(concessionaireId: string) {
  const snapshot = await getDoc(doc(db, CONCESSIONAIRES, concessionaireId));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Concessionaire) : null;
}

export { monthKeyFor, monthSortKey, sortHistoryAsc, sortHistoryDesc };
