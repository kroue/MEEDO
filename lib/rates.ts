/**
 * lib/rates.ts
 *
 * What water costs, and from which billing month.
 *
 * An admin sets the rate card in Settings: the price per cubic metre, how
 * many cubic metres the minimum charge covers, and the minimum charge for
 * each classification. Every change names the billing month it starts from,
 * and the schedule of changes is kept — so each month is billed at one rate
 * card, a phone that was offline when the change was made still bills a month
 * correctly once it has synced before that month, and anyone can see what a
 * household was charged per m³ in any past month.
 *
 * Changes can't be dated in the past: those months' bills are already out at
 * the old rates. A change can start this month, in which case bills already
 * issued this month keep the old rates and each bill records the rates it was
 * worked out with.
 *
 * Nothing here talks to the database; lib/firebase/rates.ts does that, and
 * the field app mirrors these rules in RateSchedule.kt.
 */

import { DEFAULT_RATE_CONFIG, type WaterRateConfig } from "./billingCalculator";
import { CONCESSIONAIRE_CLASSIFICATIONS, type ConcessionaireClassification } from "./firebase/types";

export interface RateCard {
  /** Cubic metres covered by the minimum charge. */
  minChargeThreshold: number;
  /** ₱ per m³ beyond that. */
  commodityRate: number;
  /** The minimum charge, by classification. */
  minimumCharges: Record<ConcessionaireClassification, number>;
}

export interface ScheduledRateCard extends RateCard {
  /** The first billing month these rates apply to, as "2026-10". */
  effectiveMonth: string;
  /** Who set it, and when (ISO). */
  setBy: string;
  setAt: string;
}

/** The rates before any change was made in Settings. */
export const BASE_RATE_CARD: RateCard = {
  minChargeThreshold: DEFAULT_RATE_CONFIG.minChargeThreshold,
  commodityRate: DEFAULT_RATE_CONFIG.commodityRate,
  minimumCharges: { ...DEFAULT_RATE_CONFIG.minimumCharges },
};

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonthKey(v: unknown): v is string {
  return typeof v === "string" && MONTH_KEY.test(v);
}

/** "2026-12" moved `n` months: +1 is "2027-01". */
export function addMonths(monthKey: string, n: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** "2026-10" as "OCT 2026", the way months are written everywhere else. */
export function monthLabel(monthKey: string): string {
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function byMonth(a: ScheduledRateCard, b: ScheduledRateCard) {
  return a.effectiveMonth.localeCompare(b.effectiveMonth);
}

/** The rate card a bill for `monthKey` is worked out with. */
export function rateCardFor(schedule: readonly ScheduledRateCard[], monthKey: string): RateCard {
  let card: RateCard = BASE_RATE_CARD;
  for (const entry of [...schedule].sort(byMonth)) {
    if (entry.effectiveMonth <= monthKey) card = entry;
  }
  return card;
}

/** The entry in force for `monthKey`, or null when it is still the base rates. */
export function scheduledEntryFor(
  schedule: readonly ScheduledRateCard[],
  monthKey: string
): ScheduledRateCard | null {
  const inForce = [...schedule].sort(byMonth).filter((e) => e.effectiveMonth <= monthKey);
  return inForce.at(-1) ?? null;
}

/** Changes that haven't started yet, soonest first. */
export function upcomingChanges(schedule: readonly ScheduledRateCard[], currentMonth: string): ScheduledRateCard[] {
  return [...schedule].sort(byMonth).filter((e) => e.effectiveMonth > currentMonth);
}

/** Changes already in force or past, newest first — the rate history. */
export function pastChanges(schedule: readonly ScheduledRateCard[], currentMonth: string): ScheduledRateCard[] {
  return [...schedule].sort(byMonth).filter((e) => e.effectiveMonth <= currentMonth).reverse();
}

export function toCalculatorConfig(card: RateCard, base: WaterRateConfig = DEFAULT_RATE_CONFIG): WaterRateConfig {
  return {
    ...base,
    minChargeThreshold: card.minChargeThreshold,
    commodityRate: card.commodityRate,
    minimumCharges: { ...card.minimumCharges },
  };
}

const hasCentavosAtMost = (n: number) => Math.round(n * 100) / 100 === n;

/** Why a rate card can't be used, in words for the admin — or null if it can. */
export function rateCardProblem(card: RateCard): string | null {
  if (!Number.isFinite(card.commodityRate) || card.commodityRate <= 0) {
    return "The price per cubic metre has to be more than zero.";
  }
  if (card.commodityRate > 1000 || !hasCentavosAtMost(card.commodityRate)) {
    return "The price per cubic metre has to be in pesos and centavos, under ₱1,000.";
  }
  if (!Number.isInteger(card.minChargeThreshold) || card.minChargeThreshold < 0 || card.minChargeThreshold > 100) {
    return "The minimum charge has to cover a whole number of cubic metres, from 0 to 100.";
  }
  for (const classification of CONCESSIONAIRE_CLASSIFICATIONS) {
    const charge = card.minimumCharges[classification];
    // Whole pesos: a bill shows no centavos.
    if (!Number.isInteger(charge) || charge < 0 || charge > 100000) {
      return `The minimum charge for ${classification.toLowerCase()} has to be a whole peso amount.`;
    }
  }
  return null;
}

export class RateScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateScheduleError";
  }
}

/**
 * The schedule with `change` added. A change for a month that already has one
 * replaces it; a change dated before `currentMonth` is refused, because that
 * month's bills are already out.
 */
export function scheduleWithChange(
  schedule: readonly ScheduledRateCard[],
  change: ScheduledRateCard,
  currentMonth: string
): ScheduledRateCard[] {
  if (!isMonthKey(change.effectiveMonth)) throw new RateScheduleError("Pick the month the new rates start from.");
  if (change.effectiveMonth < currentMonth) {
    throw new RateScheduleError(
      `${monthLabel(change.effectiveMonth)} has already been billed. New rates can start this month at the earliest.`
    );
  }
  const problem = rateCardProblem(change);
  if (problem) throw new RateScheduleError(problem);
  return [...schedule.filter((e) => e.effectiveMonth !== change.effectiveMonth), change].sort(byMonth);
}

/** The schedule without the change starting `effectiveMonth` — only one that hasn't started. */
export function scheduleWithout(
  schedule: readonly ScheduledRateCard[],
  effectiveMonth: string,
  currentMonth: string
): ScheduledRateCard[] {
  if (effectiveMonth <= currentMonth) {
    throw new RateScheduleError(
      "Rates already in force can't be withdrawn — bills have gone out at them. Set new rates from next month instead."
    );
  }
  return schedule.filter((e) => e.effectiveMonth !== effectiveMonth);
}

/**
 * Reads a stored schedule, dropping anything malformed rather than failing:
 * a bad entry must not stop the office from billing at the others.
 */
export function parseSchedule(raw: unknown): ScheduledRateCard[] {
  if (!Array.isArray(raw)) return [];
  const entries: ScheduledRateCard[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const charges = (e.minimumCharges ?? {}) as Record<string, unknown>;
    const card: ScheduledRateCard = {
      effectiveMonth: String(e.effectiveMonth ?? ""),
      commodityRate: Number(e.commodityRate),
      minChargeThreshold: Number(e.minChargeThreshold),
      minimumCharges: Object.fromEntries(
        CONCESSIONAIRE_CLASSIFICATIONS.map((c) => [c, Number(charges[c])])
      ) as Record<ConcessionaireClassification, number>,
      setBy: String(e.setBy ?? ""),
      setAt: String(e.setAt ?? ""),
    };
    if (isMonthKey(card.effectiveMonth) && rateCardProblem(card) === null) entries.push(card);
  }
  return entries.sort(byMonth);
}

/** One sentence describing a rate card, for the audit log and the confirmation. */
export function describeRateCard(card: RateCard): string {
  const m = card.minimumCharges;
  return (
    `₱${card.commodityRate.toFixed(2)} per m³ beyond ${card.minChargeThreshold} m³; minimum ` +
    `₱${m.RESIDENTIAL} residential, ₱${m.GOVERNMENT} government, ` +
    `₱${m["COMMERCIAL A"]} commercial A, ₱${m["COMMERCIAL B"]} commercial B`
  );
}
