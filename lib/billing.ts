/**
 * lib/billing.ts
 *
 * Shared helpers for working with `billingHistory` entries — used by the
 * Billing pages, Reports, Collections, and the top nav.
 *
 * Two rules in here are load-bearing across both apps and are worth reading
 * before changing anything:
 *
 *  1. Month strings are built from a fixed table, never from
 *     `toLocaleString`. The mobile app formats them with
 *     `SimpleDateFormat("MMM yyyy", Locale.US)`, which is locale-independent;
 *     a browser-locale-dependent string here would silently disagree with it
 *     (en-GB's ICU renders September as "Sept", not "SEP") and the phone
 *     would download an empty route for that month.
 *
 *  2. How overdue an account is comes from `delinquentSince` — the moment its
 *     balance last went from zero to owing — not from the age of its newest
 *     bill and not from the oldest row still showing an unpaid amount. See
 *     `delinquencyStart` below for why.
 */

import type { MonthlyBillingRecord, Concessionaire } from "./firebase/types";

const MONTH_ORDER = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Sortable key for a "MMM yyyy" month string, e.g. "AUG 2026". */
export function monthSortKey(monthStr: string): number {
  const [mon, year] = monthStr.split(" ");
  const idx = MONTH_ORDER.indexOf((mon || "").toUpperCase());
  return parseInt(year || "0", 10) * 12 + (idx === -1 ? 0 : idx);
}

/** Newest first. */
export function sortHistoryDesc(history: MonthlyBillingRecord[]): MonthlyBillingRecord[] {
  return [...history].sort((a, b) => monthSortKey(b.month) - monthSortKey(a.month));
}

/** Oldest first — the order debt was actually incurred. */
export function sortHistoryAsc(history: MonthlyBillingRecord[]): MonthlyBillingRecord[] {
  return [...history].sort((a, b) => monthSortKey(a.month) - monthSortKey(b.month));
}

export type PaymentStatus = "PAID" | "PARTIAL" | "UNPAID";

export function paymentStatus(pesoAmount: number, amountPaid: number): PaymentStatus {
  // Order matters: a zero-peso bill is settled, not unpaid, so the
  // "covers the full amount" test has to run before the "nothing paid" one.
  if (amountPaid >= pesoAmount) return "PAID";
  if (amountPaid <= 0) return "UNPAID";
  return "PARTIAL";
}

export const PAYMENT_STATUS_STYLES: Record<PaymentStatus, string> = {
  PAID: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PARTIAL: "bg-amber-50 text-amber-700 border-amber-200",
  UNPAID: "bg-red-50 text-red-700 border-red-200",
};

// ── Month strings ───────────────────────────────────────────────────────────

/**
 * e.g. "AUG 2026" — the format `billingHistory[].month` and
 * `assignedForReading` both use, and the exact format the mobile app produces
 * with `SimpleDateFormat("MMM yyyy", Locale.US)`.
 *
 * Deliberately built from MONTH_ORDER rather than `toLocaleString`: the
 * latter follows the browser's locale, and several locales abbreviate
 * September as "Sept". A reader's phone would then query for "SEP 2026"
 * against an assignment written as "SEPT 2026" and find nothing, with no
 * error on either side.
 */
export function currentMonthStr(now: Date = new Date()): string {
  return `${MONTH_ORDER[now.getMonth()]} ${now.getFullYear()}`;
}

/**
 * The months a bill may be issued for, newest first: this month and the ones
 * before it.
 *
 * Offered as a list rather than typed in. The month string is parsed into the
 * bill's key and its sort order, so "SEPT 2026" or "Sep-2026" would file a
 * bill under a month nothing else recognises — and the phone, which writes the
 * same key from the field, would never match it. Going back a year covers
 * billing late and correcting an earlier month, which this page allows.
 */
export function billableMonths(count = 12, now: Date = new Date()): string[] {
  return Array.from({ length: Math.max(1, count) }, (_, i) => {
    const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${MONTH_ORDER[month.getMonth()]} ${month.getFullYear()}`;
  });
}

/**
 * Firestore document ID for a month's bill: "AUG 2026" → "2026-08".
 *
 * Sortable, so a bill sub-collection's own key order is chronological and the
 * most recent bills can be read without an index. Stable, so a corrected
 * reading overwrites that month's bill rather than appending a second one.
 * Mirrored by `BillingMonth.documentKey` in the field app.
 */
export function monthKeyFor(monthStr: string): string {
  const [mon, year] = (monthStr ?? "").trim().split(/\s+/);
  const idx = MONTH_ORDER.indexOf((mon || "").toUpperCase());
  if (idx === -1 || !year || !/^\d+$/.test(year)) {
    // Mapping every malformed month onto one ID would have them silently
    // overwrite each other.
    return `invalid-${(monthStr ?? "unknown").replace(/[^A-Za-z0-9]/g, "-")}`;
  }
  return `${year.padStart(4, "0")}-${String(idx + 1).padStart(2, "0")}`;
}

// ── Grace period / surcharge / disconnection policy ──────────────────────────
//
//   Day 0–15  after the account went delinquent: on-time, no surcharge.
//   Day 16+   : 3% surcharge added to the water bill.
//   Any point past the grace period: a flat ₱10 extension fee (once per
//     delinquency, not per bill) applies for pursuing the debt.
//   Day 20+   : eligible for disconnection (a staff decision — this app only
//     flags it, it never disconnects automatically).

export const GRACE_PERIOD_DAYS = 15;
export const DISCONNECTION_ELIGIBLE_DAYS = 20;
export const EXTENSION_FEE = 10;
export const OVERDUE_SURCHARGE_RATE = 0.03;

/**
 * Charged once to put a disconnected line back in service. Collected at the
 * counter before the crew is sent out, not billed to the account — the office
 * takes the cash and writes the receipt while the request is being made.
 */
export const RECONNECTION_FEE = 200;

/**
 * An account that has never been connected, as opposed to one that was cut off.
 *
 * A new concessionaire is created as DISCONNECTED with the reason "NO
 * CONNECTION YET", because there is no third status for "opened, waiting for a
 * connection" — so status alone cannot tell the two apart. It matters because
 * there is nothing to reconnect and no reconnection fee to charge: what such
 * an account needs is its connection setting up in the Connections module.
 */
export function isAwaitingFirstConnection(c: {
  status?: string;
  disconnectedReason?: string;
  connectionFeeDetails?: unknown;
  billingSummary?: { monthsBilled?: number } | null;
  billingHistory?: unknown[];
}): boolean {
  if (c.status === "CONNECTED") return false;
  if (c.disconnectedReason === "NO CONNECTION YET") return true;
  const billed = c.billingSummary?.monthsBilled ?? c.billingHistory?.length ?? 0;
  return !c.connectionFeeDetails && billed === 0;
}

/** Only a line that was actually in service can be put back into service. */
export function canRequestReconnection(c: {
  status?: string;
  disconnectedReason?: string;
  connectionFeeDetails?: unknown;
  billingSummary?: { monthsBilled?: number } | null;
  billingHistory?: unknown[];
}): boolean {
  return c.status === "DISCONNECTED" && !isAwaitingFirstConnection(c);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Days elapsed since `isoDate`, or null if the date is missing/invalid
 * (e.g. a record written before the field was tracked).
 */
export function daysOverdue(isoDate: string | undefined, now: number = Date.now()): number | null {
  if (!isoDate) return null;
  const startedAt = new Date(isoDate).getTime();
  if (Number.isNaN(startedAt)) return null;
  return Math.floor((now - startedAt) / MS_PER_DAY);
}

export function isPastGracePeriod(days: number | null): boolean {
  return days !== null && days > GRACE_PERIOD_DAYS;
}

export function isDisconnectionEligible(days: number | null): boolean {
  return days !== null && days >= DISCONNECTION_ELIGIBLE_DAYS;
}

// ── When did this account go delinquent? ────────────────────────────────────

/** The subset of a concessionaire the delinquency helpers actually need. */
export interface DelinquencyInput {
  billingBalance?: number;
  totalBalance?: number;
  billingHistory?: MonthlyBillingRecord[];
  delinquentSince?: string;
}

/**
 * ISO date the account's water bill balance last went from zero to owing, or
 * null if it currently owes nothing.
 *
 * `delinquentSince` is maintained on the document itself — set when a bill
 * lands on a cleared account, cleared when a payment brings the balance to
 * zero (see payments.ts, and the mobile app's uploadReading). It is the only
 * measure that survives the two ways the obvious alternatives break:
 *
 *  - Ageing the *newest* bill resets the clock every billing cycle, so an
 *    account unpaid for two years reads as three days overdue and never
 *    reaches the 20-day disconnection threshold.
 *  - Ageing the oldest row where `amountPaid < pesoAmount` lets a
 *    concessionaire reset the clock by paying just enough to clear that one
 *    row — a few hundred pesos against a multi-year debt — because payments
 *    are applied oldest-cycle-first.
 *
 * Documents written before this field existed fall back to the oldest unpaid
 * record, which is the best available approximation for them.
 */
export function delinquencyStart(c: DelinquencyInput): string | null {
  const balance = c.billingBalance ?? c.totalBalance ?? 0;
  if (balance <= 0) return null;
  if (c.delinquentSince) return c.delinquentSince;

  const oldestUnpaid = sortHistoryAsc(c.billingHistory ?? []).find(
    (r) => (r.amountPaid ?? 0) < r.pesoAmount
  );
  return oldestUnpaid?.billingDate ?? null;
}

/** Days this account has been carrying a balance, or null if it owes nothing. */
export function concessionaireDaysOverdue(c: DelinquencyInput, now: number = Date.now()): number | null {
  return daysOverdue(delinquencyStart(c) ?? undefined, now);
}

/** Overridable `now` so a test can fix the clock rather than drift with the calendar. */

/**
 * True if `c` has an outstanding balance that has been outstanding for 20+
 * days. Shared by the Reports delinquency tab, the Billing page and the top
 * nav so all three agree on what "eligible" means.
 */
export function isConcessionaireDisconnectionEligible(
  c: DelinquencyInput,
  now: number = Date.now()
): boolean {
  return isDisconnectionEligible(concessionaireDaysOverdue(c, now));
}

// ── What was actually sold ──────────────────────────────────────────────────

/**
 * The water actually sold in one billing cycle, in pesos.
 *
 * NOT the same as `pesoAmount`: each bill's total folds in the prior unpaid
 * balance plus surcharge and extension fee, so summing `pesoAmount` across
 * history counts the same debt once per month it went unpaid. Any "billed"
 * or "revenue" total must use this instead.
 *
 * Records written before the itemized breakdown existed don't carry
 * `minimumCharge`/`commodityCharge`; for those the best available figure is
 * the total minus whatever carried over, floored at zero.
 */
export function waterChargeOf(record: MonthlyBillingRecord): number {
  if (record.minimumCharge !== undefined || record.commodityCharge !== undefined) {
    return (record.minimumCharge ?? 0) + (record.commodityCharge ?? 0);
  }
  const carried =
    (record.overdueBalance ?? 0) + (record.overdueSurcharge ?? 0) + (record.extensionFee ?? 0);
  return Math.max(0, record.pesoAmount - carried);
}

/** Total water sold across a set of billing records. */
export function totalWaterCharge(history: MonthlyBillingRecord[]): number {
  return history.reduce((sum, r) => sum + waterChargeOf(r), 0);
}

// ── Mobile sync ─────────────────────────────────────────────────────────────

/**
 * True if `c` was assigned to a field reader for `monthStr` but hasn't been
 * billed for that month yet — i.e. still "in flight" waiting to sync back
 * from the mobile app. Same logic the Mobile Sync page uses per Barangay.
 */
export function isPendingSync(
  c: {
    status: string;
    assignedForReading?: string;
    billingHistory?: MonthlyBillingRecord[];
    billingSummary?: { latestBill: MonthlyBillingRecord | null } | null;
  },
  monthStr: string
): boolean {
  if (c.status !== "CONNECTED") return false;
  if (c.assignedForReading !== monthStr) return false;
  // Bills live in a sub-collection now, so accounts imported or migrated since
  // carry no `billingHistory` array — this used to throw `undefined.some`, and
  // it runs inside the top bar on every page. The summary's latest bill is the
  // authoritative answer for those.
  if (c.billingSummary?.latestBill?.month === monthStr) return false;
  return !(c.billingHistory ?? []).some((h) => h.month === monthStr);
}

/**
 * True if an admin has confirmed this account, or it predates approval.
 *
 * Staff can create concessionaire accounts, but only as a request: until an
 * admin approves one it isn't a customer yet, so it must stay out of reading
 * assignments, billing, payments and every report. Absent means approved —
 * that covers every account created before approval existed, and everything an
 * admin creates or imports.
 */
export function isAccountApproved(c: { approvalStatus?: string | null }): boolean {
  return c.approvalStatus === undefined || c.approvalStatus === null || c.approvalStatus === "APPROVED";
}

// ── Applying a payment to billing history ────────────────────────────────
//
// `billingBalance` (on the concessionaire doc) is the single running total
// the mobile app rolls into the next bill's overdue balance — each new bill's
// `pesoAmount` already folds in whatever was unpaid before, so it is NOT the
// sum of every billingHistory entry's own unpaid amount. A payment therefore
// always reduces `billingBalance` directly by the full payment amount.
//
// Separately, `billingHistory[].amountPaid` exists purely so each cycle's
// row can show an accurate PAID/PARTIAL/UNPAID badge for audits. That
// per-record ledger is updated here, oldest-cycle-first — the same order the
// debt was incurred. Note this allocation no longer drives the grace period:
// that comes from `delinquentSince` (see `delinquencyStart`), precisely so a
// token payment against the oldest row can't reset the delinquency clock.

/** Result of applying a payment across a concessionaire's billing history. */
export interface PaymentAllocation {
  updatedHistory: MonthlyBillingRecord[];
  /** True if the payment fully cleared the outstanding balance. */
  fullyPaid: boolean;
}

export function applyPaymentToHistory(
  history: MonthlyBillingRecord[],
  amount: number,
  outstandingBalance: number
): PaymentAllocation {
  const sorted = sortHistoryAsc(history);

  if (amount >= outstandingBalance) {
    return {
      updatedHistory: sorted.map((r) => ({ ...r, amountPaid: r.pesoAmount })),
      fullyPaid: true,
    };
  }

  let remaining = amount;
  const updatedHistory = sorted.map((record) => {
    if (remaining <= 0) return record;
    const owed = record.pesoAmount - record.amountPaid;
    if (owed <= 0) return record;
    const applied = Math.min(remaining, owed);
    remaining -= applied;
    return { ...record, amountPaid: record.amountPaid + applied };
  });

  return { updatedHistory, fullyPaid: false };
}

/**
 * Reverses a previously applied payment across the history ledger, so a
 * voided payment leaves the per-cycle PAID/PARTIAL/UNPAID badges telling the
 * truth again. Unwinds newest-cycle-first — the mirror image of how
 * `applyPaymentToHistory` fills them oldest-first.
 */
export function reversePaymentInHistory(
  history: MonthlyBillingRecord[],
  amount: number
): MonthlyBillingRecord[] {
  const sorted = sortHistoryDesc(history);
  let remaining = amount;

  const reversed = sorted.map((record) => {
    if (remaining <= 0) return record;
    const paid = record.amountPaid ?? 0;
    if (paid <= 0) return record;
    const removed = Math.min(remaining, paid);
    remaining -= removed;
    return { ...record, amountPaid: paid - removed };
  });

  return sortHistoryAsc(reversed);
}

/** Convenience for callers holding a full Concessionaire. */
export type ConcessionaireLike = Pick<Concessionaire, "billingBalance" | "billingHistory"> &
  Partial<Pick<Concessionaire, "totalBalance" | "delinquentSince">>;
