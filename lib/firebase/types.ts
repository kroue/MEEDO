/**
 * lib/firebase/types.ts
 *
 * TypeScript types for the Firestore `concessionaires` collection.
 * `cubicUsed` is derived — computed as (reading - previousReading)
 * at runtime; it is NOT stored in Firestore.
 */

// ── Barangays ──────────────────────────────────────────────────────────────

export const BARANGAYS = [
  "BO-OT",
  "CG",
  "KABATANGAN",
  "SALVACION",
  "AMOYONG",
  "KATUTUNGAN",
  "PAGALONGAN",
  "MILAYA",
  "DIOMIL",
] as const;

export type Barangay = (typeof BARANGAYS)[number];

// ── Monthly Billing Record ─────────────────────────────────────────────────

/**
 * One entry in the `billingHistory` array stored per concessionaire.
 * Example month string: "NOV 2023", "DEC 2023"
 *
 * `cubicUsed` is NOT stored — it is derived:  reading - previousReading
 */
export interface MonthlyBillingRecord {
  /** e.g. "NOV 2023" */
  month: string;
  /** Current meter reading (m³) */
  reading: number;
  /** Previous meter reading (m³) */
  previousReading: number;
  /** Billed amount in PHP */
  pesoAmount: number;
  /** Official Receipt number for the billing */
  orNumber: string;
  /** Amount actually paid this month */
  amountPaid: number;
  /**
   * ISO timestamp of the exact billing date (not just the month). Drives the
   * 15-day grace period / 3% surcharge / 20-day disconnection-eligibility
   * rules. Optional because records written before this field existed won't
   * have it — those are treated as unknown aging, not as overdue.
   */
  billingDate?: string;
  /**
   * True if this bill's amount included the ₱10 delinquency extension fee.
   * Used to derive whether the fee has already been charged for the current
   * unpaid streak, since it's a one-time fee per delinquency, not per bill.
   */
  extensionFeeCharged?: boolean;
  /**
   * Itemized breakdown behind `pesoAmount`, so any device — not only the one
   * that captured the reading — can reconstruct and display/print this exact
   * bill. Optional because older records were written before this existed.
   */
  minimumCharge?: number;
  commodityCharge?: number;
  overdueBalance?: number;
  overdueSurcharge?: number;
  extensionFee?: number;
  /** Advance payment applied against this bill. */
  creditApplied?: number;
  /** True when the reading wrapped past the meter's maximum back to zero. */
  meterRolledOver?: boolean;
  /**
   * Where this bill came from. Absent means a field reading, which is all
   * there was before the office could issue one.
   */
  source?: "field" | "office";
  /** True when the office billed an estimated reading rather than a real one. */
  estimated?: boolean;
  /** Set when the bill has been reversed; the record stays for the audit trail. */
  voided?: boolean;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  /** Epoch millis — pay on/before this to avoid the overdue surcharge. */
  dueDateMillis?: number;
  /** What `pesoAmount` becomes if this bill isn't paid by `dueDateMillis`. */
  projectedOverdueTotal?: number;
}

// ── Meter Payments ─────────────────────────────────────────────────────────

/**
 * Up to four installment payments for the water meter itself (not monthly bills).
 */
export interface MeterPayment {
  /** Payment slot label, e.g. "1st", "2nd", "3rd", "4th" */
  slot: "1st" | "2nd" | "3rd" | "4th" | "Full" | string;
  amount: number;
  /** Official Receipt number, typed from the booklet. Never generated. */
  orNumber: string;
  date?: string; // ISO string
  /** Email of whoever took the payment at the counter. */
  recordedBy?: string;
  /** Email of the admin who released it from the approval queue, if any. */
  approvedBy?: string;
  /** Set when reversed — the row stays so the OR number stays accounted for. */
  voided?: boolean;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
}

// ── Connection Fee Details ──────────────────────────────────────────────
export interface ConnectionFeeDetails {
  waterMeter: number;
  applicationFee: number;
  inspectionFee: number;
  otherPayables: { description: string; amount: number }[];
  total: number;
  /** Email of the admin who last set up/edited these fees. */
  updatedBy?: string;
}

// ── Water Bill Payments ─────────────────────────────────────────────────

/**
 * One payment transaction against a concessionaire's water bill balance —
 * distinct from [MeterPayment], which pays down the one-time connection fee.
 * Applied oldest-unpaid-cycle-first against `billingHistory` (see
 * lib/billing.ts `applyPaymentToHistory`), while `billingBalance` is reduced
 * directly since it — not the sum of billingHistory entries — is the single
 * running total the mobile app rolls into the next bill's overdue balance.
 */
export interface PaymentRecord {
  /**
   * The Official Receipt number, copied from the booklet the treasury issues
   * against the Business Tax listing. Typed in by whoever took the cash, never
   * generated, and unique: it is this payment's document id.
   */
  orNumber: string;
  amount: number;
  /** ISO timestamp of the transaction */
  date: string;
  /** Email of whoever took the payment at the counter. */
  recordedBy: string;
  /**
   * Email of the admin who released this payment from the approval queue.
   * Absent on payments an admin recorded directly.
   */
  approvedBy?: string;
  balanceBefore: number;
  balanceAfter: number;
  /**
   * How much of `amount` went against the outstanding bill. Equal to `amount`
   * on every payment recorded now; on older ones the remainder
   * (`amount - appliedToBalance`) was an advance that went to `creditBalance`.
   */
  appliedToBalance?: number;
  /**
   * Portion of `amount` held as advance credit. Only on payments recorded
   * before the office stopped taking advance payments — kept so voiding one
   * can take its credit back off the account.
   */
  creditedAmount?: number;
  /**
   * The cash handed over, when it was more than `amount`. Absent when the
   * exact amount was paid.
   */
  cashTendered?: number;
  /** Change given back: `cashTendered - amount`. Absent when there was none. */
  changeGiven?: number;
  /**
   * Set when this payment has been reversed. The record is never deleted —
   * a cash receipt that was issued stays in the ledger, marked void, so the
   * OR number is still accounted for.
   */
  voided?: boolean;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
}

// ── Billing summary (denormalised onto the parent document) ────────────────

/**
 * Everything about an account's billing that callers need without opening the
 * `bills` sub-collection. Deliberately fixed-size: two bill records and three
 * running totals, however many years of history sit underneath.
 */
export interface BillingSummary {
  /** Number of bills in the sub-collection. */
  monthsBilled: number;
  /** Lifetime water actually sold, excluding balances rolled forward. */
  totalWaterCharged: number;
  /** Lifetime cash received against water bills, excluding voided payments. */
  totalCollected: number;
  /** Most recent bill by month, or null if never billed. */
  latestBill: MonthlyBillingRecord | null;
  /** The bill before [latestBill] — the phone's "previous reading". */
  previousBill: MonthlyBillingRecord | null;
}

/**
 * Fields copied onto each bill and payment document so collection-group
 * queries can filter and display without reading every parent. Firestore has
 * no joins; this is the standard cost of querying across sub-collections.
 */
export interface DenormalisedOwner {
  concessionaireId: string;
  concessionaireName: string;
  barangay: string;
  meterNumber: string;
  classification: string;
}

export type BillDocument = MonthlyBillingRecord &
  DenormalisedOwner & {
    /** Sortable month, e.g. "2026-08". Also the document ID. */
    monthKey: string;
  };

export type PaymentDocument = PaymentRecord & DenormalisedOwner;

// ── Classification ──────────────────────────────────────────────────────────

export const CONCESSIONAIRE_CLASSIFICATIONS = [
  "RESIDENTIAL",
  "COMMERCIAL A",
  "COMMERCIAL B",
  "GOVERNMENT",
] as const;

export type ConcessionaireClassification = (typeof CONCESSIONAIRE_CLASSIFICATIONS)[number];

// ── Status & Reasons ────────────────────────────────────────────────────────

export const CONCESSIONAIRE_STATUSES = [
  "CONNECTED",
  "DISCONNECTED",
  "DROPPED",
] as const;

export type ConcessionaireStatus = (typeof CONCESSIONAIRE_STATUSES)[number];

export const DISCONNECTED_REASONS = [
  "NON-PAYMENT",
  "VOLUNTARY DISCONNECTION",
  "ILLEGAL CONNECTIONS",
  "NO CONNECTION YET",
] as const;

export type DisconnectedReason = (typeof DISCONNECTED_REASONS)[number];

// ── Approval ────────────────────────────────────────────────────────────────

/**
 * Whether an admin has confirmed a concessionaire account. Staff may create
 * accounts, but only as PENDING requests; see `isAccountApproved` in
 * lib/billing.ts for what that shuts an account out of until it's approved.
 */
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

// ── Remarks ───────────────────────────────────────────────────────────────

export interface Remark {
  text: string;
  date: string; // ISO string
  /** Email of the admin who wrote this remark. */
  author?: string;
}

// ── Concessionaire (root Firestore document) ────────────────────────────────────

/**
 * Matches a document in the `concessionaires` Firestore collection.
 * `id` is the Firestore document ID (not stored as a field in Firestore).
 */
export interface Concessionaire {
  /** Firestore document ID — injected client-side after fetch */
  id: string;

  // ── Identifiers ──
  barangay: string;
  purok: string;
  /**
   * The account's own number, e.g. "2026-000042" — assigned by the system when
   * the account is opened and never edited. Separate from the meter number on
   * purpose: a meter can be replaced or swapped between households, while the
   * account it serves carries on. Absent on accounts opened before numbering
   * existed; see lib/accountNumber.ts.
   */
  accountNumber?: string;
  /** Stamped on the meter itself, typed in by hand. */
  meterNumber: string;
  firstName: string;
  middleName: string;
  lastName: string;
  classification: ConcessionaireClassification;

  // ── Status ──
  status: ConcessionaireStatus;
  disconnectedReason?: DisconnectedReason; // Only set if status === "DISCONNECTED"

  // ── Balances ──
  billingBalance: number;
  waterMeterBalance: number;
  /** Derived: billingBalance + waterMeterBalance */
  totalBalance: number;
  /**
   * Advance payment held on account, in PHP — money received beyond what was
   * owed at the time. Nothing creates it any more: overpayment is now given
   * back as change. What remains on older accounts is still honoured — the
   * mobile app draws it down against the next bill it issues. Always >= 0.
   */
  creditBalance?: number;

  /**
   * ISO timestamp of when this account's water bill balance last went from
   * zero to owing. Set when a bill lands on a cleared account, cleared when a
   * payment brings the balance back to zero.
   *
   * This — not the age of the newest bill, and not the oldest row still
   * showing an unpaid amount — is what the 15-day grace period, the 3%
   * surcharge and the 20-day disconnection flag are measured from. See
   * `delinquencyStart` in lib/billing.ts for why both alternatives are wrong.
   */
  delinquentSince?: string;

  // ── Requirements ──
  requirements?: {
    barangayClearance: boolean;
    cedula: boolean;
    picture2x2: boolean;
  };

  // ── Billing History ──
  /**
   * DEPRECATED as storage — bills live in the `bills` sub-collection now.
   *
   * Still read (never written) so accounts not yet migrated keep working; see
   * lib/firebase/bills.ts. Once every document has been migrated and the
   * cleanup pass has run, this is always empty and can be dropped.
   */
  billingHistory: MonthlyBillingRecord[];

  /**
   * Bounded, denormalised view of the `bills` sub-collection, rewritten on
   * every bill write.
   *
   * It exists so the two hot paths never have to read the sub-collection:
   * the mobile app needs only the latest two bills (this cycle's, if any, and
   * the one before it for the previous reading), and Reports needs lifetime
   * totals per account. Without it the phone would need one extra query per
   * consumer on every route download — a few hundred round trips over a field
   * connection to fetch two documents each.
   */
  billingSummary?: BillingSummary;

  // ── Meter Payments ──
  meterPayments: MeterPayment[];

  // ── Water Bill Payments ──
  /**
   * DEPRECATED as storage — payments live in the `payments` sub-collection
   * now. Still read for unmigrated accounts; see lib/firebase/bills.ts.
   */
  payments?: PaymentRecord[];

  // ── Remarks ──
  remarks: Remark[];

  // ── Connection Fees ──
  connectionFeeDetails?: ConnectionFeeDetails;

  // ── Approval ──
  /**
   * Absent means approved: every account created before approval existed, and
   * everything an admin creates or imports. A staff-created account starts
   * PENDING and stays out of reading assignments, billing and payments until an
   * admin approves it. The Firestore rules — not just the console — stop staff
   * from setting this to anything but PENDING, or changing it afterwards.
   */
  approvalStatus?: ApprovalStatus;
  /** Email of whoever created the request. */
  approvalRequestedBy?: string;
  approvalRequestedAt?: string;
  /** Email of the admin who approved or rejected it. */
  approvalReviewedBy?: string;
  approvalReviewedAt?: string;
  /** Why an admin rejected it — shown back to the staff member who asked. */
  approvalRejectionReason?: string;

  // ── Sync ──
  assignedForReading?: string; // e.g. "AUG 2026"

  // ── Timestamps ──
  createdAt?: string; // ISO string
  updatedAt?: string; // ISO string

  // ── Audit ──
  /** Email of the admin who created this record. */
  createdBy?: string;
  /** Email of the admin who last edited this record's details. */
  updatedBy?: string;
}

/**
 * Input type for creating a new concessionaire (no `id` yet, dates optional).
 */
export type NewConcessionaireInput = Omit<Concessionaire, "id" | "createdAt" | "updatedAt">;

/**
 * Derive cubicUsed from a MonthlyBillingRecord.
 */
/** Takes anything holding the two readings — a history row or a bill document. */
export function getCubicUsed(record: { reading: number; previousReading: number }): number {
  return Math.max(0, record.reading - record.previousReading);
}

// ── Staff requests waiting on an admin ──────────────────────────────────────

/**
 * What a staff member asked to do. Money and service changes are the admin's
 * call, so staff submit the intent and an admin applies it — nothing reaches
 * an account's balance, fees or status until then.
 */
export type ServiceRequestKind =
  /** A payment against the water bill, taken at the counter. */
  | "WATER_PAYMENT"
  /** A connection fee installment. */
  | "CONNECTION_PAYMENT"
  /** Setting up (or revising) an account's connection fee breakdown. */
  | "CONNECTION_SETUP"
  /** Putting a disconnected line back in service. */
  | "RECONNECTION";

/**
 * PENDING   — waiting for an admin.
 * APPROVED  — reconnection only: the fee is in, the crew is going out. The
 *             line is not back in service yet.
 * COMPLETED — applied to the account: payment posted, fees set up, or the
 *             admin confirmed the line is live again.
 * REJECTED  — refused, with a reason. Nothing was applied.
 */
export type ServiceRequestStatus = "PENDING" | "APPROVED" | "COMPLETED" | "REJECTED";

export interface ServiceRequest {
  /** Firestore document ID — injected client-side after fetch. */
  id: string;
  kind: ServiceRequestKind;
  status: ServiceRequestStatus;

  // Who it is about. Copied at submission so the queue lists itself without
  // reading every account.
  concessionaireId: string;
  concessionaireName: string;
  barangay: string;
  meterNumber: string;

  /** Amount involved, for the kinds that move money. */
  amount?: number;
  /**
   * For a water payment: the cash handed over, when it was more than
   * `amount`. The difference was given back as change at the counter.
   */
  cashTendered?: number;
  /** Receipt number, typed from the booklet. Never generated. */
  orNumber?: string;
  /** Connection fee installment slot ("1st", "Full", …). */
  slot?: string;
  /** The fee breakdown proposed by a connection setup request. */
  connectionFeeDetails?: ConnectionFeeDetails;
  /** Anything the requester wanted the admin to know. */
  note?: string;

  requestedBy: string;
  requestedAt: string;
  /** Admin who approved, rejected, or dispatched the crew. */
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  /** Admin who applied it — posted the payment, or confirmed the line is live. */
  completedBy?: string;
  completedAt?: string;
  /** Plain sentence of what applying it did, kept for the audit trail. */
  outcome?: string;
}

export type NewServiceRequest = Omit<ServiceRequest, "id">;
