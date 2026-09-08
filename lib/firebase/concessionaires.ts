/**
 * lib/firebase/concessionaires.ts
 *
 * Pure Firestore service functions for the `concessionaires` collection.
 * No React, no hooks — just data access. Import these into hooks or
 * Server Actions as needed.
 */

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
import { getFullName } from "../utils";
import type {
  Concessionaire,
  NewConcessionaireInput,
  MonthlyBillingRecord,
} from "./types";

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
 */
export function subscribeToConcessionairesByBarangay(
  barangay: string,
  onData: (concessionaires: Concessionaire[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const q = barangay === "all"
    ? query(concessionairesRef(), orderBy("firstName", "asc"))
    : query(concessionairesRef(), where("barangay", "==", barangay), orderBy("firstName", "asc"));
  return onSnapshot(
    q,
    (snapshot) => onData(mapSnapshot(snapshot)),
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
 * True if `meterNumber` already belongs to a concessionaire other than
 * `exceptId`. Meter number is the key the XLSX importer joins billing history
 * and connection payments on, and what Collections searches by — a duplicate
 * silently attaches one concessionaire's history to another.
 */
export async function isMeterNumberTaken(
  meterNumber: string,
  exceptId?: string
): Promise<boolean> {
  const key = meterKeyOf(meterNumber);
  if (!key) return false;
  // Stored values aren't normalized, so compare on a small candidate set
  // rather than an equality query that would miss a case difference.
  const snapshot = await getDocs(concessionairesRef());
  return snapshot.docs.some(
    (d) => d.id !== exceptId && meterKeyOf(d.data().meterNumber as string | undefined) === key
  );
}

/**
 * Add a new concessionaire document to Firestore.
 * Returns the new document ID.
 *
 * Rejects a meter number already in use — see [isMeterNumberTaken].
 */
export async function addConcessionaire(
  data: NewConcessionaireInput,
  actorEmail: string
): Promise<string> {
  if (await isMeterNumberTaken(data.meterNumber)) {
    throw new DuplicateMeterNumberError(data.meterNumber);
  }
  const docRef = await addDoc(concessionairesRef(), {
    ...data,
    billingHistory: data.billingHistory ?? [],
    meterPayments: data.meterPayments ?? [],
    createdBy: actorEmail,
    updatedBy: actorEmail,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  logAuditEvent(
    "Account Update",
    `Created concessionaire ${getFullName(data)} (${data.meterNumber || "no meter #"}) in ${data.barangay}.`,
    actorEmail
  );
  return docRef.id;
}

// ── UPDATE — Monthly Billing ───────────────────────────────────────────────

/**
 * Append or update a monthly billing record for a concessionaire.
 *
 * Strategy: if a record for the given month already exists in the array,
 * it replaces it entirely (via a full array rewrite). If it doesn't exist,
 * it appends using arrayUnion.
 *
 * For simplicity & correctness we pass the full updated array when merging.
 */
export async function upsertMonthlyBilling(
  concessionaireId: string,
  updatedHistory: MonthlyBillingRecord[]
): Promise<void> {
  const docRef = doc(db, CONCESSIONAIRES_COLLECTION, concessionaireId);
  await updateDoc(docRef, {
    billingHistory: updatedHistory,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Append a brand-new monthly record (for a month that doesn't exist yet).
 * Uses arrayUnion to avoid overwriting existing months.
 */
export async function addMonthlyBillingRecord(
  concessionaireId: string,
  record: MonthlyBillingRecord
): Promise<void> {
  const docRef = doc(db, CONCESSIONAIRES_COLLECTION, concessionaireId);
  await updateDoc(docRef, {
    billingHistory: arrayUnion(record),
    updatedAt: serverTimestamp(),
  });
}

// ── UPDATE — Balances ──────────────────────────────────────────────────────

/**
 * Update billing/water meter balances.
 * `totalBalance` is recalculated automatically here.
 */
export async function updateConcessionaireBalances(
  concessionaireId: string,
  billingBalance: number,
  waterMeterBalance: number
): Promise<void> {
  const docRef = doc(db, CONCESSIONAIRES_COLLECTION, concessionaireId);
  await updateDoc(docRef, {
    billingBalance,
    waterMeterBalance,
    totalBalance: billingBalance + waterMeterBalance,
    updatedAt: serverTimestamp(),
  });
}

// ── UPDATE — Status & Details (New for Editing) ────────────────────────────

export async function updateConcessionaireDetails(
  concessionaireId: string,
  updates: Partial<Omit<Concessionaire, "id" | "createdAt" | "updatedAt">>,
  actorEmail: string
): Promise<void> {
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

export async function updateConnectionFeeDetails(
  concessionaireId: string,
  connectionFeeDetails: import("./types").ConnectionFeeDetails,
  waterMeterBalance: number,
  totalBalance: number,
  actorEmail: string,
  newRemark?: import("./types").Remark
): Promise<void> {
  const docRef = doc(db, CONCESSIONAIRES_COLLECTION, concessionaireId);
  const updates: any = {
    connectionFeeDetails: { ...connectionFeeDetails, updatedBy: actorEmail },
    waterMeterBalance,
    totalBalance,
    status: "CONNECTED",
    disconnectedReason: deleteField(),
    updatedBy: actorEmail,
    updatedAt: serverTimestamp(),
  };

  if (newRemark) {
    updates.remarks = arrayUnion(newRemark);
  }

  await updateDoc(docRef, updates);
  logAuditEvent(
    "Account Update",
    `Set up connection fee (${connectionFeeDetails.total}) for concessionaire ${concessionaireId}.`,
    actorEmail
  );
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
  actorEmail: string
): Promise<{ newWaterMeterBalance: number; newTotalBalance: number }> {
  const amount = toCentavos(payment.amount);
  if (!(amount > 0) || !Number.isFinite(amount)) {
    throw new InvalidMeterPaymentError("Payment amount must be greater than zero.");
  }

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

    const newWaterMeterBalance = toCentavos(waterMeterBalance - amount);
    const newTotalBalance = toCentavos(billingBalance + newWaterMeterBalance);

    transaction.update(docRef, {
      meterPayments: [...meterPayments, { ...payment, amount, recordedBy: actorEmail }],
      waterMeterBalance: newWaterMeterBalance,
      totalBalance: newTotalBalance,
      updatedBy: actorEmail,
      updatedAt: serverTimestamp(),
    });

    return { newWaterMeterBalance, newTotalBalance };
  });

  logAuditEvent(
    "Payment",
    `Recorded connection fee payment of ₱${amount.toFixed(2)} (${payment.slot}) for concessionaire ${concessionaireId}. OR ${payment.orNumber}.`,
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
  const BATCH_SIZE = 499;
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

  for (let i = 0; i < writable.length; i += BATCH_SIZE) {
    const chunk = writable.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);

    chunk.forEach(({ row, existingId }) => {
      const ref = existingId ? doc(concessionairesRef(), existingId) : doc(concessionairesRef());
      if (existingId) {
        // Merge rather than replace: an existing account may carry payments,
        // remarks and billing history the workbook doesn't know about.
        batch.set(
          ref,
          { ...row, updatedBy: actorEmail, updatedAt: serverTimestamp() },
          { merge: true }
        );
      } else {
        batch.set(ref, {
          ...row,
          createdBy: actorEmail,
          updatedBy: actorEmail,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });

    try {
      await batch.commit();
      chunk.forEach(({ existingId }) => (existingId ? updated++ : imported++));
      processed += chunk.length;
      onProgress?.(processed, concessionaires.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${msg}`);
    }
  }

  logAuditEvent(
    "Data Sync",
    `XLSX import: ${imported} created, ${updated} updated, ${skipped} skipped` +
      `${errors.length > 0 ? ` (${errors.length} problem(s))` : ""}.`,
    actorEmail
  );

  return { imported, updated, skipped, errors };
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
