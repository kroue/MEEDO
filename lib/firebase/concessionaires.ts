/**
 * lib/firebase/concessionaires.ts
 *
 * Pure Firestore service functions for the `concessionaires` collection.
 * No React, no hooks — just data access. Import these into hooks or
 * Server Actions as needed.
 */

import { userMessage } from "../userMessage";
import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  writeBatch,
  runTransaction,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  deleteField,
  type QuerySnapshot,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { logAuditEvent } from "./auditLog";
import { monthKeyFor, ownerFieldsOf } from "./bills";
import { sortHistoryDesc, waterChargeOf } from "../billing";
import { DuplicateOrNumberError, requireOrNumber } from "../receipts";
import { reserveAccountNumber, reserveAccountNumbers } from "./accountNumbers";
import { getFullName } from "../utils";
import type { Concessionaire, NewConcessionaireInput } from "./types";

// ── Collection reference ───────────────────────────────────────────────────

const CONCESSIONAIRES_COLLECTION = "concessionaires";

const concessionairesRef = () => collection(db, CONCESSIONAIRES_COLLECTION);

// ── Helpers ────────────────────────────────────────────────────────────────

function mapSnapshot(snapshot: QuerySnapshot<DocumentData>): Concessionaire[] {
  return snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Concessionaire, "id">),
  }));
}

// ── READ ───────────────────────────────────────────────────────────────────

import { getDoc } from "firebase/firestore";

export async function fetchConcessionaireById(
  id: string
): Promise<Concessionaire | null> {
  const docRef = doc(concessionairesRef(), id);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...snapshot.data() } as Concessionaire;
}

export function subscribeToConcessionaireById(
  id: string,
  onData: (concessionaire: Concessionaire | null) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const docRef = doc(concessionairesRef(), id);
  return onSnapshot(
    docRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onData(null);
      } else {
        onData({ id: snapshot.id, ...snapshot.data() } as Concessionaire);
      }
    },
    (err) => onError(err)
  );
}

/**
 * One-time fetch: get all concessionaires for a given barangay.
 * Results are ordered by concessionaire firstName.
 */
export async function fetchConcessionairesByBarangay(
  barangay: string
): Promise<Concessionaire[]> {
  const q = barangay === "all"
    ? query(concessionairesRef(), orderBy("firstName", "asc"))
    : query(concessionairesRef(), where("barangay", "==", barangay), orderBy("firstName", "asc"));
  const snapshot = await getDocs(q);
  return mapSnapshot(snapshot);
}

/**
 * Real-time listener: fires callback whenever concessionaires in the
 * given barangay change. Returns an unsubscribe function.
 *
 * `fromServer` is false while the data is only what this browser had cached —
 * the first answer on a fresh load, or everything while offline — and true
 * once the server has confirmed it.
 */
export function subscribeToConcessionairesByBarangay(
  barangay: string,
  onData: (concessionaires: Concessionaire[], fromServer: boolean) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const q = barangay === "all"
    ? query(concessionairesRef(), orderBy("firstName", "asc"))
    : query(concessionairesRef(), where("barangay", "==", barangay), orderBy("firstName", "asc"));
  return onSnapshot(
    q,
    // Metadata changes included so the switch from cached to confirmed is
    // delivered even when the server's answer matches the cache exactly.
    { includeMetadataChanges: true },
    (snapshot) => onData(mapSnapshot(snapshot), !snapshot.metadata.fromCache),
    (err) => onError(err)
  );
}

// ── CREATE ─────────────────────────────────────────────────────────────────

export class DuplicateMeterNumberError extends Error {
  constructor(meterNumber: string) {
    super(`Meter number ${meterNumber} is already assigned to another concessionaire.`);
    this.name = "DuplicateMeterNumberError";
  }
}

/**
 * Where the live account list (concessionairesStore.ts) offers its copy for
 * duplicate checks, or returns null when it has none the server has confirmed.
 * Registered from that side rather than imported here: it already imports this
 * module, and the other direction would make a cycle.
 */
let confirmedAccounts: (() => Concessionaire[] | null) | null = null;

export function provideConfirmedAccounts(source: () => Concessionaire[] | null): void {
  confirmedAccounts = source;
}

/**
 * True if `meterNumber` already belongs to a concessionaire other than
 * `exceptId`. Meter number is the key the XLSX importer joins billing history
 * and connection payments on, and what Collections searches by — a duplicate
 * silently attaches one concessionaire's history to another.
 *
 * Stored values aren't normalized, so the comparison is on meterKeyOf rather
 * than an equality query that would miss a difference in case or spacing.
 *
 * It used to download every account to compare against, on every save. When
 * the console already holds the live, server-confirmed list it checks that
 * instead, plus one small exact-match query as a backstop for any account the
 * list leaves out (it is ordered by first name, which skips a record with no
 * first-name field at all). Without a confirmed list — offline, or in the
 * first moment after loading — it reads everything, as before.
 */
export async function isMeterNumberTaken(
  meterNumber: string,
  exceptId?: string
): Promise<boolean> {
  const key = meterKeyOf(meterNumber);
  if (!key) return false;

  const belongsToAnother = (id: string, data: { approvalStatus?: string; meterNumber?: string }) =>
    id !== exceptId &&
    // A rejected request never became an account, so it mustn't block the
    // corrected one that follows it.
    data.approvalStatus !== "REJECTED" &&
    meterKeyOf(data.meterNumber) === key;

  const live = confirmedAccounts?.() ?? null;
  if (live) {
    if (live.some((c) => belongsToAnother(c.id, c))) return true;
    const spellings = [...new Set([meterNumber, meterNumber.trim(), key, key.toLowerCase()])].filter(
      Boolean
    );
    const exact = await getDocs(
      query(concessionairesRef(), where("meterNumber", "in", spellings))
    );
    return exact.docs.some((d) => belongsToAnother(d.id, d.data()));
  }

  const snapshot = await getDocs(concessionairesRef());
  return snapshot.docs.some((d) => belongsToAnother(d.id, d.data()));
}

/**
 * Add a new concessionaire document to Firestore.
 * Returns the new document ID.
 *
 * An admin's account is live immediately. A staff member's is created as a
 * PENDING request that an admin has to approve before the account can be
 * assigned for reading, billed, or take payments. The Firestore rules enforce
 * the same thing, so this can't be bypassed from outside the console.
 *
 * Rejects a meter number already in use — see [isMeterNumberTaken].
 *
 * The account number is assigned here, not typed in: it identifies the
 * account rather than the hardware, so it is the system's to hand out.
 */
export async function addConcessionaire(
  data: NewConcessionaireInput,
  actorEmail: string,
  actorRole: "admin" | "staff"
): Promise<string> {
  if (await isMeterNumberTaken(data.meterNumber)) {
    throw new DuplicateMeterNumberError(data.meterNumber);
  }

  // New accounts start in the sub-collection shape: no legacy billingHistory
  // array, and an empty summary. A staff request can't arrive already on a
  // reading route either.
  const { billingHistory: _legacyHistory, assignedForReading: _route, ...rest } = data;
  void _legacyHistory;
  void _route;

  const accountNumber = data.accountNumber?.trim() || (await reserveAccountNumber());

  const now = new Date().toISOString();
  const approval =
    actorRole === "admin"
      ? {
          approvalStatus: "APPROVED" as const,
          approvalRequestedBy: actorEmail,
          approvalRequestedAt: now,
          approvalReviewedBy: actorEmail,
          approvalReviewedAt: now,
        }
      : {
          approvalStatus: "PENDING" as const,
          approvalRequestedBy: actorEmail,
          approvalRequestedAt: now,
        };

  const docRef = await addDoc(concessionairesRef(), {
    ...rest,
    accountNumber,
    ...(actorRole === "admin" && data.assignedForReading
      ? { assignedForReading: data.assignedForReading }
      : {}),
    ...approval,
    meterPayments: data.meterPayments ?? [],
    billingSummary: {
      monthsBilled: 0,
      totalWaterCharged: 0,
      totalCollected: 0,
      latestBill: null,
      previousBill: null,
    },
    createdBy: actorEmail,
    updatedBy: actorEmail,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  logAuditEvent(
    "Account Update",
    actorRole === "admin"
      ? `Created concessionaire ${getFullName(data)}, account ${accountNumber} (${data.meterNumber || "no meter #"}) in ${data.barangay}.`
      : `Requested a new concessionaire account for ${getFullName(data)}, account ${accountNumber} (${data.meterNumber || "no meter #"}) in ${data.barangay} — awaiting admin approval.`,
    actorEmail
  );
  return docRef.id;
}

export class ApprovalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalStateError";
  }
}

/**
 * Concessionaires awaiting a decision, and recent refusals — the approval
 * queue on the Concessionaires page and the count in the sidebar.
 */
export function subscribeToApprovalQueue(
  onData: (accounts: Concessionaire[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(concessionairesRef(), where("approvalStatus", "in", ["PENDING", "REJECTED"])),
    (snapshot) => onData(mapSnapshot(snapshot)),
    (err) => onError(err)
  );
}

/**
 * Every account one staff member has submitted, whatever became of it — how
 * the notifications menu tells them a request was approved or turned down.
 */
export function subscribeToMyApprovalRequests(
  requestedBy: string,
  onData: (accounts: Concessionaire[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(concessionairesRef(), where("approvalRequestedBy", "==", requestedBy)),
    (snapshot) => onData(mapSnapshot(snapshot)),
    (err) => onError(err)
  );
}

/** Approves a pending account. Admin only — the rules refuse anyone else. */
export async function approveConcessionaire(
  concessionaireId: string,
  actorEmail: string
): Promise<void> {
  const docRef = doc(db, CONCESSIONAIRES_COLLECTION, concessionaireId);
  const name = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(docRef);
    if (!snapshot.exists()) throw new ApprovalStateError("That account no longer exists.");
    const data = snapshot.data() as Concessionaire;
    if (data.approvalStatus !== "PENDING") {
      throw new ApprovalStateError("This account isn't waiting for approval any more.");
    }
    transaction.update(docRef, {
      approvalStatus: "APPROVED",
      approvalReviewedBy: actorEmail,
      approvalReviewedAt: new Date().toISOString(),
      approvalRejectionReason: deleteField(),
      updatedBy: actorEmail,
      updatedAt: serverTimestamp(),
    });
    return getFullName(data);
  });

  logAuditEvent(
    "Account Update",
    `Approved the new concessionaire account for ${name || concessionaireId}.`,
    actorEmail
  );
}

/**
 * Rejects a pending account, with a reason the requester will see. The record
 * is kept rather than deleted so the request stays on the audit trail; its
 * meter number is freed for a corrected request.
 */
export async function rejectConcessionaire(
  concessionaireId: string,
  reason: string,
  actorEmail: string
): Promise<void> {
  const trimmed = reason.trim();
  if (!trimmed) throw new ApprovalStateError("Give a reason so the staff member knows what to fix.");

  const docRef = doc(db, CONCESSIONAIRES_COLLECTION, concessionaireId);
  const name = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(docRef);
    if (!snapshot.exists()) throw new ApprovalStateError("That account no longer exists.");
    const data = snapshot.data() as Concessionaire;
    if (data.approvalStatus !== "PENDING") {
      throw new ApprovalStateError("This account isn't waiting for approval any more.");
    }
    transaction.update(docRef, {
      approvalStatus: "REJECTED",
      approvalReviewedBy: actorEmail,
      approvalReviewedAt: new Date().toISOString(),
      approvalRejectionReason: trimmed,
      updatedBy: actorEmail,
      updatedAt: serverTimestamp(),
    });
    return getFullName(data);
  });

  logAuditEvent(
    "Account Update",
    `Rejected the new concessionaire account for ${name || concessionaireId}. Reason: ${trimmed}`,
    actorEmail
  );
}

// ── UPDATE — Status & Details (New for Editing) ────────────────────────────

/**
 * Puts a rejected account back in front of an admin, once whoever asked for it
 * has fixed what the rejection named. The rejection reason and who gave it are
 * cleared, so the queue shows a fresh request rather than an old verdict.
 *
 * Open to the staff member who asked for the account and to any admin.
 */
export async function resubmitConcessionaire(
  concessionaireId: string,
  actorEmail: string
): Promise<void> {
  const docRef = doc(db, CONCESSIONAIRES_COLLECTION, concessionaireId);
  const name = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(docRef);
    if (!snapshot.exists()) throw new ApprovalStateError("That account no longer exists.");
    const data = snapshot.data() as Concessionaire;
    if (data.approvalStatus !== "REJECTED") {
      throw new ApprovalStateError(
        data.approvalStatus === "PENDING"
          ? "This account is already waiting for an admin."
          : "This account has already been approved."
      );
    }
    transaction.update(docRef, {
      approvalStatus: "PENDING",
      approvalRequestedBy: actorEmail,
      approvalRequestedAt: new Date().toISOString(),
      approvalRejectionReason: deleteField(),
      approvalReviewedBy: deleteField(),
      approvalReviewedAt: deleteField(),
    });
    return getFullName(data);
  });

  logAuditEvent(
    "Account Update",
    `Re-submitted ${name || concessionaireId} for approval.`,
    actorEmail
  );
}

export async function updateConcessionaireDetails(
  concessionaireId: string,
  updates: Partial<Omit<Concessionaire, "id" | "createdAt" | "updatedAt">>,
  actorEmail: string
): Promise<void> {
  // An account still waiting on an admin isn't an account yet: nothing should
  // be done to it but approve or reject it. A rejected one can still be
  // corrected — that is the whole point of re-submitting it.
  const current = await fetchConcessionaireById(concessionaireId);
  if (current && current.approvalStatus === "PENDING") {
    throw new ApprovalStateError(
      "This account is waiting for an admin's approval. It can't be changed until then."
    );
  }

  if (updates.meterNumber && (await isMeterNumberTaken(updates.meterNumber, concessionaireId))) {
    throw new DuplicateMeterNumberError(updates.meterNumber);
  }
  const docRef = doc(db, CONCESSIONAIRES_COLLECTION, concessionaireId);
  await updateDoc(docRef, { ...updates, updatedBy: actorEmail, updatedAt: serverTimestamp() });
  logAuditEvent(
    "Account Update",
    `Updated concessionaire ${getFullName(updates)} details.`,
    actorEmail
  );
}

export async function addRemark(concessionaireId: string, remark: import("./types").Remark): Promise<void> {
  const docRef = doc(db, CONCESSIONAIRES_COLLECTION, concessionaireId);
  await updateDoc(docRef, {
    remarks: arrayUnion(remark),
    updatedAt: serverTimestamp(),
  });
  logAuditEvent(
    "Account Update",
    `Added remark to concessionaire ${concessionaireId}: "${remark.text}"`,
    remark.author ?? "unknown"
  );
}

// ── UPDATE — Connections ───────────────────────────────────────────────────

/**
 * Sets up (or revises) an account's connection fee and puts the line in
 * service.
 *
 * The balances are worked out here, inside a transaction, from what the
 * account actually holds. They used to be passed in by the caller, which was
 * fine on the Connections page — it had the account on screen — but wrong
 * everywhere else: approving a staff member's setup request from the queue
 * had no billing balance to hand, so it wrote the fee as the whole of
 * `totalBalance` and quietly erased whatever the household owed on water.
 *
 * Applying the same setup twice lands on the same numbers rather than adding
 * the fee again, so two admins working the approval queue can't double it.
 */
export async function updateConnectionFeeDetails(
  concessionaireId: string,
  connectionFeeDetails: import("./types").ConnectionFeeDetails,
  actorEmail: string,
  newRemark?: import("./types").Remark
): Promise<{ waterMeterBalance: number; totalBalance: number }> {
  const docRef = doc(db, CONCESSIONAIRES_COLLECTION, concessionaireId);

  const result = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(docRef);
    if (!snapshot.exists()) throw new Error("Concessionaire not found.");

    const data = snapshot.data() as Concessionaire;
    const paidSoFar = (data.meterPayments ?? []).reduce(
      (sum, p) => (p.voided ? sum : sum + p.amount),
      0
    );
    // What is still owed on the connection, net of installments already taken.
    const waterMeterBalance = Math.max(0, toCentavos(connectionFeeDetails.total - paidSoFar));
    const totalBalance = toCentavos((data.billingBalance ?? 0) + waterMeterBalance);

    transaction.update(docRef, {
      connectionFeeDetails: { ...connectionFeeDetails, updatedBy: actorEmail },
      waterMeterBalance,
      totalBalance,
      status: "CONNECTED",
      disconnectedReason: deleteField(),
      ...(newRemark ? { remarks: arrayUnion(newRemark) } : {}),
      updatedBy: actorEmail,
      updatedAt: serverTimestamp(),
    });

    return { waterMeterBalance, totalBalance };
  });

  logAuditEvent(
    "Account Update",
    `Set up connection fee (${connectionFeeDetails.total}) for concessionaire ${concessionaireId}.`,
    actorEmail
  );
  return result;
}

export class InvalidMeterPaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMeterPaymentError";
  }
}

/** Rounds to centavos — float arithmetic on money otherwise leaves 0.30000000000000004 in Firestore. */
function toCentavos(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Records a connection-fee installment and reduces `waterMeterBalance` by it.
 *
 * Runs as a transaction, reading the balance from the server rather than
 * trusting the snapshot the page happened to be holding. The previous
 * version computed the new balance on the client and wrote it with a plain
 * update, so two cashiers recording installments seconds apart produced two
 * payment rows but only one balance reduction — the classic lost update.
 *
 * Throws [InvalidMeterPaymentError] rather than silently clamping when the
 * amount exceeds what's actually owed on the meter.
 */
export async function addMeterPayment(
  concessionaireId: string,
  payment: import("./types").MeterPayment,
  actorEmail: string,
  options: { approvedBy?: string } = {}
): Promise<{ newWaterMeterBalance: number; newTotalBalance: number }> {
  const amount = toCentavos(payment.amount);
  if (!(amount > 0) || !Number.isFinite(amount)) {
    throw new InvalidMeterPaymentError("Payment amount must be greater than zero.");
  }
  const orNumber = requireOrNumber(payment.orNumber);

  const docRef = doc(db, CONCESSIONAIRES_COLLECTION, concessionaireId);

  const result = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(docRef);
    if (!snapshot.exists()) throw new Error("Concessionaire not found.");

    const data = snapshot.data();
    const waterMeterBalance: number = data.waterMeterBalance ?? 0;
    const billingBalance: number = data.billingBalance ?? 0;
    const meterPayments = (data.meterPayments ?? []) as import("./types").MeterPayment[];

    if (amount > waterMeterBalance) {
      throw new InvalidMeterPaymentError(
        `Amount exceeds the remaining connection fee balance of ₱${waterMeterBalance.toFixed(2)}.`
      );
    }
    if (meterPayments.some((p) => p.slot === payment.slot && !p.voided)) {
      throw new InvalidMeterPaymentError(
        `A ${payment.slot} payment has already been recorded for this connection.`
      );
    }
    // The receipt number comes off a paper receipt, so the same one twice
    // means a mistyped entry — or the same payment being recorded again.
    if (meterPayments.some((p) => p.orNumber === orNumber)) {
      throw new DuplicateOrNumberError(orNumber);
    }

    const newWaterMeterBalance = toCentavos(waterMeterBalance - amount);
    const newTotalBalance = toCentavos(billingBalance + newWaterMeterBalance);

    transaction.update(docRef, {
      meterPayments: [
        ...meterPayments,
        {
          ...payment,
          amount,
          orNumber,
          recordedBy: actorEmail,
          ...(options.approvedBy ? { approvedBy: options.approvedBy } : {}),
        },
      ],
      waterMeterBalance: newWaterMeterBalance,
      totalBalance: newTotalBalance,
      updatedBy: actorEmail,
      updatedAt: serverTimestamp(),
    });

    return { newWaterMeterBalance, newTotalBalance };
  });

  logAuditEvent(
    "Payment",
    `Recorded connection fee payment of ₱${amount.toFixed(2)} (${payment.slot}) for concessionaire ${concessionaireId}. OR ${orNumber}.`,
    actorEmail
  );

  return result;
}

/**
 * Reverses a connection-fee installment, restoring the meter balance and
 * marking the row voided rather than removing it — same rule as water bill
 * payments: an issued receipt stays in the ledger.
 */
export async function voidMeterPayment(
  concessionaireId: string,
  orNumber: string,
  reason: string,
  actorEmail: string
): Promise<void> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new InvalidMeterPaymentError("A reason is required to void a payment.");
  }

  const docRef = doc(db, CONCESSIONAIRES_COLLECTION, concessionaireId);
  const now = new Date();

  const amount = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(docRef);
    if (!snapshot.exists()) throw new Error("Concessionaire not found.");

    const data = snapshot.data();
    const meterPayments = (data.meterPayments ?? []) as import("./types").MeterPayment[];
    const target = meterPayments.find((p) => p.orNumber === orNumber);
    if (!target) throw new InvalidMeterPaymentError(`No connection payment found with OR ${orNumber}.`);
    if (target.voided) throw new InvalidMeterPaymentError(`Payment ${orNumber} has already been voided.`);

    const waterMeterBalance: number = data.waterMeterBalance ?? 0;
    const billingBalance: number = data.billingBalance ?? 0;
    const restoredMeterBalance = toCentavos(waterMeterBalance + target.amount);

    transaction.update(docRef, {
      meterPayments: meterPayments.map((p) =>
        p.orNumber === orNumber
          ? { ...p, voided: true, voidedAt: now.toISOString(), voidedBy: actorEmail, voidReason: trimmedReason }
          : p
      ),
      waterMeterBalance: restoredMeterBalance,
      totalBalance: toCentavos(billingBalance + restoredMeterBalance),
      updatedBy: actorEmail,
      updatedAt: serverTimestamp(),
    });

    return target.amount;
  });

  logAuditEvent(
    "Payment",
    `VOIDED connection fee payment ${orNumber} (₱${amount.toFixed(2)}) for concessionaire ${concessionaireId}. Reason: ${trimmedReason}`,
    actorEmail
  );
}

// ── BATCH IMPORT ───────────────────────────────────────────────────────────

/** Normalized meter number — the key concessionaires are matched on across imports. */
export function meterKeyOf(meterNumber: string | undefined): string {
  return (meterNumber ?? "").trim().toUpperCase();
}

/**
 * Every meter number currently in use, mapped to its document ID. Used both
 * to make imports idempotent and to keep the new-concessionaire dialog from
 * creating a second account on an existing meter.
 */
export async function fetchMeterNumberIndex(): Promise<Map<string, string>> {
  const snapshot = await getDocs(concessionairesRef());
  const index = new Map<string, string>();
  snapshot.docs.forEach((d) => {
    const key = meterKeyOf(d.data().meterNumber as string | undefined);
    if (key) index.set(key, d.id);
  });
  return index;
}

export type DuplicateStrategy = "update" | "skip";

export interface ImportResult {
  /** New documents created. */
  imported: number;
  /** Existing documents matched by meter number and overwritten. */
  updated: number;
  /** Existing documents left alone (strategy "skip"). */
  skipped: number;
  errors: string[];
  /**
   * Account numbers given to the accounts this import created — the workbook
   * never carries them. Absent when nothing new was created.
   */
  accountNumbers?: { first: string; last: string };
}

/**
 * Write concessionaires to Firestore in batches of 499 (Firestore's limit is
 * 500 ops per batch).
 *
 * Rows are matched against existing documents by normalized meter number, so
 * re-running the same workbook updates in place instead of creating a second
 * copy of every account. Before this, each row minted a fresh document ID
 * unconditionally: importing twice left every concessionaire duplicated with
 * separate balances, the mobile app downloading both, and no way to tell the
 * copies apart.
 *
 * Rows with no meter number can't be matched on anything, so they are always
 * created and reported as such by the caller's own pre-flight check.
 *
 * `strategy` decides what happens on a match — "update" overwrites the
 * existing document's imported fields, "skip" leaves it untouched.
 */
export async function batchImportConcessionaires(
  concessionaires: NewConcessionaireInput[],
  actorEmail: string,
  options: {
    strategy?: DuplicateStrategy;
    onProgress?: (processed: number, total: number) => void;
  } = {}
): Promise<ImportResult> {
  const { strategy = "update", onProgress } = options;
  // Firestore allows 500 operations per batch; counted per operation below.
  const BATCH_SIZE = 490;
  const errors: string[] = [];
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  const existingByMeter = await fetchMeterNumberIndex();

  // Deduplicate within the workbook itself too — the same meter appearing on
  // two rows would otherwise race inside a single batch, where last-write-wins
  // is silent.
  const seenInSheet = new Set<string>();
  const writable: { row: NewConcessionaireInput; existingId: string | null }[] = [];

  for (const row of concessionaires) {
    const key = meterKeyOf(row.meterNumber);
    if (key && seenInSheet.has(key)) {
      errors.push(`Meter ${row.meterNumber} appears more than once in the workbook — only the first row was used.`);
      continue;
    }
    if (key) seenInSheet.add(key);

    const existingId = key ? existingByMeter.get(key) ?? null : null;
    if (existingId && strategy === "skip") {
      skipped++;
      continue;
    }
    writable.push({ row, existingId });
  }

  let processed = skipped;

  // Accounts new to this workbook need account numbers. Reserved in one go:
  // the counter is shared, and taking it once per row would serialise the
  // whole import behind it. Rows already in the system keep the number they
  // were given when they were opened.
  const newAccountCount = writable.filter(({ existingId }) => !existingId).length;
  const reservedNumbers = await reserveAccountNumbers(newAccountCount);
  let nextReserved = 0;
  const assignedNumbers =
    reservedNumbers.length > 0
      ? { first: reservedNumbers[0], last: reservedNumbers[reservedNumbers.length - 1] }
      : undefined;

  // Batches are chunked by OPERATION, not by row: each account costs one write
  // for the parent plus one per bill, so an account with years of history can
  // exceed Firestore's 500-op limit on its own.
  let batch = writeBatch(db);
  let opsInBatch = 0;
  let pendingRows: { existingId: string | null }[] = [];
  let batchNumber = 1;

  const commitBatch = async () => {
    if (opsInBatch === 0) return;
    try {
      await batch.commit();
      pendingRows.forEach(({ existingId }) => (existingId ? updated++ : imported++));
      processed += pendingRows.length;
      onProgress?.(processed, concessionaires.length);
    } catch (err) {
      const msg = userMessage(err, "Couldn't save this batch.");
      errors.push(`Batch ${batchNumber}: ${msg}`);
    }
    batch = writeBatch(db);
    opsInBatch = 0;
    pendingRows = [];
    batchNumber += 1;
  };

  for (const { row, existingId } of writable) {
    const { billingHistory = [], ...parentFields } = row;

    // Bills go straight into the sub-collection rather than an array on the
    // parent, so a freshly imported account is already in the current shape and
    // never needs the storage migration run over it afterwards.
    const ordered = sortHistoryDesc(billingHistory);
    const billCost = ordered.length;

    // Start a fresh batch if this account wouldn't fit in the current one.
    if (opsInBatch > 0 && opsInBatch + billCost + 1 > BATCH_SIZE) {
      await commitBatch();
    }

    const ref = existingId ? doc(concessionairesRef(), existingId) : doc(concessionairesRef());
    const ownerFields = ownerFieldsOf(ref.id, row);

    const summary = {
      monthsBilled: ordered.length,
      totalWaterCharged:
        Math.round(ordered.reduce((sum, b) => sum + waterChargeOf(b), 0) * 100) / 100,
      // The workbook has no water-bill payment rows — only connection-fee
      // installments, which stay on the parent — so nothing has been collected
      // against these bills as far as this import knows.
      totalCollected: 0,
      latestBill: ordered[0] ?? null,
      previousBill: ordered[1] ?? null,
    };

    ordered.forEach((bill) => {
      batch.set(
        doc(collection(ref, "bills"), monthKeyFor(bill.month)),
        { ...bill, ...ownerFields, monthKey: monthKeyFor(bill.month) },
        { merge: true }
      );
      opsInBatch += 1;
    });

    const parentPayload = {
      ...parentFields,
      billingSummary: summary,
      approvalStatus: "APPROVED",
      ...(existingId ? {} : { accountNumber: reservedNumbers[nextReserved++] }),
    };

    if (existingId) {
      // Merge rather than replace: an existing account may carry payments,
      // remarks and connection details the workbook doesn't know about.
      batch.set(
        ref,
        { ...parentPayload, updatedBy: actorEmail, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } else {
      batch.set(ref, {
        ...parentPayload,
        createdBy: actorEmail,
        updatedBy: actorEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    opsInBatch += 1;
    pendingRows.push({ existingId });
  }

  await commitBatch();

  logAuditEvent(
    "Data Sync",
    `XLSX import: ${imported} created, ${updated} updated, ${skipped} skipped` +
      `${errors.length > 0 ? ` (${errors.length} problem(s))` : ""}.`,
    actorEmail
  );

  return { imported, updated, skipped, errors, accountNumbers: assignedNumbers };
}

// ── BATCH ASSIGN FOR READING ───────────────────────────────────────────────

/**
 * Assigns a batch of concessionaires for mobile reading for a specific month.
 */
export async function batchAssignConcessionairesForReading(
  concessionaireIds: string[],
  monthStr: string,
  actorEmail: string
): Promise<void> {
  const BATCH_SIZE = 499;
  for (let i = 0; i < concessionaireIds.length; i += BATCH_SIZE) {
    const chunk = concessionaireIds.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);

    chunk.forEach((id) => {
      const ref = doc(concessionairesRef(), id);
      batch.update(ref, {
        assignedForReading: monthStr,
        updatedAt: serverTimestamp(),
      });
    });

    await batch.commit();
  }

  logAuditEvent(
    "Data Sync",
    `Assigned ${concessionaireIds.length} concessionaire(s) for reading in ${monthStr}.`,
    actorEmail
  );
}
