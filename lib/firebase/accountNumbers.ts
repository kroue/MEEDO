/**
 * lib/firebase/accountNumbers.ts
 *
 * Hands out account numbers from a single shared counter.
 *
 * Two people opening an account at the same time have to get different
 * numbers, so the counter moves inside a transaction rather than by reading
 * it and writing it back. An import asks for a whole block at once — one
 * transaction for the batch instead of one per row.
 *
 * The sequence starts again each year; see lib/accountNumber.ts for the shape.
 */

import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { logAuditEvent } from "./auditLog";
import { accountNumberBlock } from "../accountNumber";
import type { DocumentData } from "firebase/firestore";
import type { Concessionaire } from "./types";

const COUNTER_DOC = "accountNumberCounter";

/**
 * Reserves `count` account numbers and returns them in order.
 *
 * Reserved, not issued: if whatever is being created then fails, the numbers
 * are simply never used. A gap in the sequence is harmless — reusing a number
 * on a second account would not be.
 */
export async function reserveAccountNumbers(count: number): Promise<string[]> {
  if (count <= 0) return [];

  const counterRef = doc(db, "settings", COUNTER_DOC);
  const year = new Date().getFullYear();

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(counterRef);
    const storedYear = snapshot.exists() ? snapshot.data().year : null;
    const lastNumber = snapshot.exists() ? (snapshot.data().lastNumber ?? 0) : 0;

    // A new year restarts the sequence, matching the year in the number itself.
    const from = storedYear === year ? lastNumber : 0;
    const numbers = accountNumberBlock(year, from, count);

    transaction.set(counterRef, { year, lastNumber: from + count });
    return numbers;
  });
}

/** Reserves a single account number, for opening one account. */
export async function reserveAccountNumber(): Promise<string> {
  const [number] = await reserveAccountNumbers(1);
  return number;
}

// ── Accounts opened before numbering existed ────────────────────────────────

const CONCESSIONAIRES = "concessionaires";
/** Firestore caps a batch at 500 writes. */
const BATCH_SIZE = 450;

export interface AccountNumberSurvey {
  total: number;
  numbered: number;
  missing: number;
}

/**
 * When an account was opened, as a number for sorting.
 *
 * `createdAt` is a server timestamp on records written by the console, an ISO
 * string on some imported ones, and missing on the oldest. Comparing them as
 * text put "Timestamp(seconds=...)" in an order of its own, so the backfill
 * numbered accounts in a sequence that had nothing to do with their age.
 */
function openedAt(data: DocumentData): number {
  const createdAt = (data as Concessionaire).createdAt as unknown;
  if (createdAt && typeof createdAt === "object" && "seconds" in createdAt) {
    return Number((createdAt as { seconds: number }).seconds) * 1000;
  }
  const parsed = Date.parse(String(createdAt ?? ""));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Counts how many accounts still have no number. Changes nothing. */
export async function surveyAccountNumbers(): Promise<AccountNumberSurvey> {
  const snapshot = await getDocs(collection(db, CONCESSIONAIRES));
  let numbered = 0;
  snapshot.docs.forEach((d) => {
    const value = (d.data() as Concessionaire).accountNumber;
    if (typeof value === "string" && value.trim()) numbered += 1;
  });
  return { total: snapshot.size, numbered, missing: snapshot.size - numbered };
}

/**
 * Gives every account that has no number one, oldest first, so the sequence
 * roughly follows the order accounts were opened.
 *
 * Safe to run more than once: an account that already has a number is left
 * alone, and numbers are reserved from the same counter new accounts use, so
 * a backfill can never collide with an account opened while it runs.
 */
export async function assignMissingAccountNumbers(
  actorEmail: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ assigned: number; alreadyNumbered: number }> {
  const snapshot = await getDocs(query(collection(db, CONCESSIONAIRES), orderBy("__name__")));

  const missing = snapshot.docs
    .filter((d) => {
      const value = (d.data() as Concessionaire).accountNumber;
      return !(typeof value === "string" && value.trim());
    })
    .sort((a, b) => openedAt(a.data()) - openedAt(b.data()));

  const alreadyNumbered = snapshot.size - missing.length;
  if (missing.length === 0) return { assigned: 0, alreadyNumbered };

  const numbers = await reserveAccountNumbers(missing.length);

  let assigned = 0;
  for (let start = 0; start < missing.length; start += BATCH_SIZE) {
    const chunk = missing.slice(start, start + BATCH_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((docSnapshot, i) => {
      batch.update(doc(db, CONCESSIONAIRES, docSnapshot.id), {
        accountNumber: numbers[start + i],
        updatedBy: actorEmail,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
    assigned += chunk.length;
    onProgress?.(assigned, missing.length);
  }

  logAuditEvent(
    "Account Update",
    `Assigned account numbers to ${assigned} account(s) that had none.`,
    actorEmail
  );

  return { assigned, alreadyNumbered };
}
