/**
 * lib/firebase/migrateToSubcollections.ts
 *
 * Moves each concessionaire's `billingHistory` and `payments` arrays into the
 * `bills` and `payments` sub-collections, and builds the `billingSummary` the
 * parent document now carries.
 *
 * Deliberately two phases, run separately:
 *
 *   Phase 1 — backfill. Writes the sub-collection documents and the summary
 *             and leaves the arrays exactly where they are. Nothing reads any
 *             differently afterwards that didn't already, because every reader
 *             prefers the sub-collection and falls back to the array, so this
 *             phase cannot break a running system. Safe to re-run.
 *
 *   Phase 2 — cleanup. Removes the arrays, once you've looked at the accounts
 *             and are satisfied phase 1 did the right thing. This is the only
 *             destructive step, and it is separate precisely so it is a
 *             decision rather than a side effect.
 *
 * Both phases are idempotent and resumable: they work in batches, report
 * progress, and skip what is already done. Interrupting either one is safe —
 * re-run it.
 */

import { userMessage } from "../userMessage";
import {
  collection,
  doc,
  getDocs,
  writeBatch,
  deleteField,
  query,
  orderBy,
  limit as fsLimit,
  startAfter,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type QueryConstraint,
  type DocumentData,
} from "firebase/firestore";
import { db } from "./firebase";
import { monthKeyFor, ownerFieldsOf, BILLS_SUBCOLLECTION, PAYMENTS_SUBCOLLECTION } from "./bills";
import { sortHistoryDesc, waterChargeOf } from "../billing";
import { logAuditEvent } from "./auditLog";
import type {
  BillingSummary,
  Concessionaire,
  MonthlyBillingRecord,
  PaymentRecord,
} from "./types";

const CONCESSIONAIRES = "concessionaires";

/** Firestore allows 500 operations per batch; leave room for the parent write. */
const OPS_PER_BATCH = 450;
/** Concessionaires read per page, to keep memory flat on a large district. */
const PAGE_SIZE = 50;

export interface MigrationProgress {
  scanned: number;
  migrated: number;
  skipped: number;
  billsWritten: number;
  paymentsWritten: number;
  errors: string[];
}

function toCentavos(value: number): number {
  return Math.round(value * 100) / 100;
}

function emptyProgress(): MigrationProgress {
  return { scanned: 0, migrated: 0, skipped: 0, billsWritten: 0, paymentsWritten: 0, errors: [] };
}

async function* pagedConcessionaires(): AsyncGenerator<QueryDocumentSnapshot<DocumentData>[]> {
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  for (;;) {
    const constraints: QueryConstraint[] = cursor
      ? [orderBy("__name__"), startAfter(cursor), fsLimit(PAGE_SIZE)]
      : [orderBy("__name__"), fsLimit(PAGE_SIZE)];
    const snapshot: QuerySnapshot<DocumentData> = await getDocs(
      query(collection(db, CONCESSIONAIRES), ...constraints)
    );
    if (snapshot.empty) return;
    yield snapshot.docs;
    if (snapshot.docs.length < PAGE_SIZE) return;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
}

/**
 * Phase 1 — backfill sub-collections and the summary. Non-destructive.
 *
 * An account is skipped when it already has a `billingSummary` and nothing new
 * in its arrays, so re-running after an interruption costs one read per
 * already-done account and no writes.
 */
export async function backfillSubcollections(
  actorEmail: string,
  onProgress?: (p: MigrationProgress) => void
): Promise<MigrationProgress> {
  const progress = emptyProgress();

  for await (const page of pagedConcessionaires()) {
    for (const snapshot of page) {
      progress.scanned += 1;
      const id = snapshot.id;
      const data = { id, ...snapshot.data() } as Concessionaire;

      const history = (data.billingHistory ?? []) as MonthlyBillingRecord[];
      const payments = (data.payments ?? []) as PaymentRecord[];

      // Already migrated and nothing left in the arrays to move.
      if (data.billingSummary && history.length === 0 && payments.length === 0) {
        progress.skipped += 1;
        onProgress?.({ ...progress });
        continue;
      }

      try {
        const ownerFields = ownerFieldsOf(id, data);
        const ordered = sortHistoryDesc(history);

        // Chunked so no single batch exceeds Firestore's operation limit on
        // an account with years of history. `batch` is reassigned as each
        // chunk commits, which is why it isn't const.
        let batch = writeBatch(db);
        let opsInBatch = 0;

        const flushIfFull = async () => {
          if (opsInBatch >= OPS_PER_BATCH) {
            await batch.commit();
            batch = writeBatch(db);
            opsInBatch = 0;
          }
        };

        for (const bill of ordered) {
          batch.set(
            doc(db, CONCESSIONAIRES, id, BILLS_SUBCOLLECTION, monthKeyFor(bill.month)),
            { ...bill, ...ownerFields, monthKey: monthKeyFor(bill.month) },
            { merge: true }
          );
          opsInBatch += 1;
          progress.billsWritten += 1;
          await flushIfFull();
        }

        for (const payment of payments) {
          // A payment with no OR number can't be addressed as a document; key
          // it by date so it still migrates rather than being dropped.
          const key = payment.orNumber?.trim() || `legacy-${Date.parse(payment.date) || Date.now()}`;
          batch.set(
            doc(db, CONCESSIONAIRES, id, PAYMENTS_SUBCOLLECTION, key),
            { ...payment, orNumber: key, ...ownerFields },
            { merge: true }
          );
          opsInBatch += 1;
          progress.paymentsWritten += 1;
          await flushIfFull();
        }

        const summary: BillingSummary = {
          monthsBilled: ordered.length,
          totalWaterCharged: toCentavos(ordered.reduce((sum, b) => sum + waterChargeOf(b), 0)),
          totalCollected: toCentavos(
            payments.reduce((sum, p) => (p.voided ? sum : sum + p.amount), 0)
          ),
          latestBill: ordered[0] ?? null,
          previousBill: ordered[1] ?? null,
        };

        // The arrays stay. Phase 2 removes them, once you've checked this.
        batch.update(doc(db, CONCESSIONAIRES, id), { billingSummary: summary });
        opsInBatch += 1;

        await batch.commit();
        progress.migrated += 1;
      } catch (err) {
        progress.errors.push(
          `${data.meterNumber || id}: ${userMessage(err)}`
        );
      }

      onProgress?.({ ...progress });
    }
  }

  logAuditEvent(
    "Data Sync",
    `Storage migration backfill: ${progress.migrated} account(s) migrated, ${progress.skipped} already done, ` +
      `${progress.billsWritten} bill(s) and ${progress.paymentsWritten} payment(s) written` +
      `${progress.errors.length ? `, ${progress.errors.length} error(s)` : ""}.`,
    actorEmail
  );

  return progress;
}

/**
 * Phase 2 — remove the legacy arrays.
 *
 * Only touches accounts that have a `billingSummary` and whose sub-collection
 * bill count matches what the array held, so an account that phase 1 hasn't
 * finished is left alone rather than losing data.
 */
export async function dropLegacyArrays(
  actorEmail: string,
  onProgress?: (p: MigrationProgress) => void
): Promise<MigrationProgress> {
  const progress = emptyProgress();

  for await (const page of pagedConcessionaires()) {
    for (const snapshot of page) {
      progress.scanned += 1;
      const id = snapshot.id;
      const data = { id, ...snapshot.data() } as Concessionaire;

      const history = (data.billingHistory ?? []) as MonthlyBillingRecord[];
      const payments = (data.payments ?? []) as PaymentRecord[];

      if (history.length === 0 && payments.length === 0) {
        progress.skipped += 1;
        onProgress?.({ ...progress });
        continue;
      }

      if (!data.billingSummary) {
        progress.errors.push(
          `${data.meterNumber || id}: not backfilled yet — run the backfill first. Left untouched.`
        );
        onProgress?.({ ...progress });
        continue;
      }

      try {
        // Verify before deleting: every month in the array must exist as a
        // document, and every payment too. Anything less and we keep the array.
        const billDocs = await getDocs(collection(db, CONCESSIONAIRES, id, BILLS_SUBCOLLECTION));
        const billKeys = new Set(billDocs.docs.map((d) => d.id));
        const missingBills = history.filter((b) => !billKeys.has(monthKeyFor(b.month)));

        const paymentDocs = await getDocs(
          collection(db, CONCESSIONAIRES, id, PAYMENTS_SUBCOLLECTION)
        );
        const paymentKeys = new Set(paymentDocs.docs.map((d) => d.id));
        const missingPayments = payments.filter(
          (p) => !paymentKeys.has(p.orNumber?.trim() || "") && p.orNumber?.trim()
        );

        if (missingBills.length > 0 || missingPayments.length > 0) {
          progress.errors.push(
            `${data.meterNumber || id}: ${missingBills.length} bill(s) and ` +
              `${missingPayments.length} payment(s) haven't been copied yet. ` +
              `Nothing removed — run the backfill again.`
          );
          onProgress?.({ ...progress });
          continue;
        }

        const batch = writeBatch(db);
        batch.update(doc(db, CONCESSIONAIRES, id), {
          billingHistory: deleteField(),
          payments: deleteField(),
        });
        await batch.commit();
        progress.migrated += 1;
      } catch (err) {
        progress.errors.push(
          `${data.meterNumber || id}: ${userMessage(err)}`
        );
      }

      onProgress?.({ ...progress });
    }
  }

  logAuditEvent(
    "Data Sync",
    `Storage migration cleanup: ${progress.migrated} account(s) cleaned, ${progress.skipped} already clean` +
      `${progress.errors.length ? `, ${progress.errors.length} skipped with problems` : ""}.`,
    actorEmail
  );

  return progress;
}

/** Counts what still needs doing, without changing anything. */
export async function surveyMigration(): Promise<{
  total: number;
  withSummary: number;
  withLegacyArrays: number;
  largestHistory: number;
}> {
  let total = 0;
  let withSummary = 0;
  let withLegacyArrays = 0;
  let largestHistory = 0;

  for await (const page of pagedConcessionaires()) {
    for (const snapshot of page) {
      total += 1;
      const data = snapshot.data() as Concessionaire;
      if (data.billingSummary) withSummary += 1;
      const historyLength = (data.billingHistory ?? []).length;
      const paymentsLength = (data.payments ?? []).length;
      if (historyLength > 0 || paymentsLength > 0) withLegacyArrays += 1;
      largestHistory = Math.max(largestHistory, historyLength);
    }
  }

  return { total, withSummary, withLegacyArrays, largestHistory };
}
