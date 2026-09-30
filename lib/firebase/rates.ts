/**
 * lib/firebase/rates.ts
 *
 * The water rate schedule, stored as one document — settings/waterRates —
 * that every console page and every field phone reads. Only an admin may
 * write it (firestore.rules). The rules for what a schedule may contain are
 * in lib/rates.ts; this file only reads and writes it.
 *
 * Writes go through a transaction, so two admins changing rates at once
 * can't each overwrite the other's change with a stale copy of the schedule.
 */

import { doc, getDoc, onSnapshot, runTransaction, type Unsubscribe } from "firebase/firestore";
import { db } from "./firebase";
import { logAuditEvent } from "./auditLog";
import { monthKeyFor, currentMonthStr } from "../billing";
import {
  describeRateCard,
  monthLabel,
  parseSchedule,
  scheduleWithChange,
  scheduleWithout,
  type RateCard,
  type ScheduledRateCard,
} from "../rates";

const ratesRef = () => doc(db, "settings", "waterRates");

/** This billing month as a month key — the earliest a change may start. */
export function currentMonthKey(now: Date = new Date()): string {
  return monthKeyFor(currentMonthStr(now));
}

export function subscribeToRateSchedule(
  onData: (schedule: ScheduledRateCard[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return onSnapshot(ratesRef(), (snapshot) => onData(parseSchedule(snapshot.data()?.schedule)), onError);
}

export async function fetchRateSchedule(): Promise<ScheduledRateCard[]> {
  const snapshot = await getDoc(ratesRef());
  return parseSchedule(snapshot.data()?.schedule);
}

/** Sets new rates starting `effectiveMonth` ("2026-10"). */
export async function scheduleRateChange(
  card: RateCard,
  effectiveMonth: string,
  actorEmail: string
): Promise<void> {
  const currentMonth = currentMonthKey();
  const entry: ScheduledRateCard = {
    effectiveMonth,
    commodityRate: card.commodityRate,
    minChargeThreshold: card.minChargeThreshold,
    minimumCharges: { ...card.minimumCharges },
    setBy: actorEmail,
    setAt: new Date().toISOString(),
  };
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ratesRef());
    const schedule = scheduleWithChange(parseSchedule(snapshot.data()?.schedule), entry, currentMonth);
    transaction.set(ratesRef(), { schedule, updatedBy: actorEmail, updatedAt: entry.setAt });
  });
  logAuditEvent("System", `Set water rates from ${monthLabel(effectiveMonth)}: ${describeRateCard(card)}.`, actorEmail);
}

/** Withdraws a change that hasn't started yet. */
export async function cancelRateChange(effectiveMonth: string, actorEmail: string): Promise<void> {
  const currentMonth = currentMonthKey();
  const updatedAt = new Date().toISOString();
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ratesRef());
    const schedule = scheduleWithout(parseSchedule(snapshot.data()?.schedule), effectiveMonth, currentMonth);
    transaction.set(ratesRef(), { schedule, updatedBy: actorEmail, updatedAt });
  });
  logAuditEvent("System", `Withdrew the water rate change due to start ${monthLabel(effectiveMonth)}.`, actorEmail);
}
