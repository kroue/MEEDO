/**
 * lib/billingCalculator.ts
 *
 * The district's billing maths, in TypeScript.
 *
 * This is a deliberate port of `WaterBillingCalculator.kt` in the field app,
 * not a second opinion: the two must agree to the centavo, because a bill
 * issued from the office and a bill issued from a phone are the same bill. The
 * unit tests in billingCalculator.test.ts mirror the Kotlin ones case for case,
 * so a change to either rate card shows up as a failure on both sides.
 *
 * Rate schedule (Board-approved, ½" connection):
 *
 *   Classification          Minimum charge     Commodity charge
 *                           (first 10 m³)      (₱/m³ beyond that)
 *   ──────────────────────────────────────────────────────────────
 *   RESIDENTIAL / GOV'T.    ₱100.00            ₱10.80
 *   COMMERCIAL A            ₱125.00            ₱10.80
 *   COMMERCIAL B            ₱150.00            ₱10.80
 *
 * Late payment: once an unpaid balance is past its due date, every bill it is
 * carried into adds a flat ₱10 penalty — ₱10 for each month it stays unpaid.
 * The due date is the one the unpaid bill was given (lib/dueDates.ts), counted
 * from `delinquentSince`, when the balance went from zero to owing — see
 * delinquencyStart() in billing.ts for why it is neither the newest bill's date
 * nor the oldest unpaid row's. (This replaced a 3% surcharge plus a one-time
 * ₱10 extension fee; bills from before keep what they were charged.)
 *
 * Whole pesos: the commodity charge is rounded to the nearest peso (half a
 * peso up), so with whole-peso minimum charges and penalty every line on a
 * bill, and its total, is a whole peso. Nothing on a bill says it was rounded.
 * A balance carried in with centavos, from bills issued before this, is
 * rounded off in the total; that difference is kept, unshown, as
 * `roundingAdjustment` so a correction backs the bill out exactly.
 */

import { dueDateFor } from "./dueDates";
import type { ConcessionaireClassification } from "./firebase/types";

export interface WaterRateConfig {
  /** Cubic metres covered by the minimum charge. */
  minChargeThreshold: number;
  /** ₱ per m³ beyond the threshold. */
  commodityRate: number;
  /**
   * The flat charge for the first `minChargeThreshold` m³, by classification.
   * With the two above, this is the part of the rate card an admin can change
   * in Settings (lib/rates.ts); the rest are fixed.
   */
  minimumCharges: Record<ConcessionaireClassification, number>;
  /**
   * Days after billing a bill falls due, for a barangay without a set due
   * day (lib/dueDates.ts).
   */
  gracePeriodDays: number;
  /** ₱ added to each bill while an unpaid balance is past its due date. */
  latePenalty: number;
  /** Highest reading a 5-digit mechanical register shows before wrapping to zero. */
  meterMaxReading: number;
}

export const DEFAULT_RATE_CONFIG: WaterRateConfig = {
  minChargeThreshold: 10,
  commodityRate: 10.8,
  minimumCharges: {
    RESIDENTIAL: 100,
    GOVERNMENT: 100,
    "COMMERCIAL A": 125,
    "COMMERCIAL B": 150,
  },
  gracePeriodDays: 15,
  latePenalty: 10,
  meterMaxReading: 99999,
};

/**
 * Consumption above this in one cycle is treated as a keying mistake rather
 * than a reading — roughly twenty times a heavy household month.
 */
export const IMPLAUSIBLE_CONSUMPTION_M3 = 1000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface BillingResult {
  consumption: number;

  minimumCharge: number;
  commodityCharge: number;
  totalWaterCharge: number;

  overdueBalance: number;
  daysOverdue: number | null;
  /** The carried balance is unpaid past its due date, so this bill carries a penalty. */
  pastDue: boolean;
  /** No longer charged — always 0. Kept so older bills that carried one still read. */
  overdueSurcharge: number;
  /**
   * The ₱10 late payment penalty. Stored under this name because older bills
   * used it for the one-time extension fee that the penalty replaced.
   */
  extensionFee: number;

  creditApplied: number;
  creditRemaining: number;

  /**
   * What rounding the total to a whole peso added or took off — only ever
   * non-zero when a carried balance or credit has centavos. Stored for the
   * books, never shown on a bill.
   */
  roundingAdjustment: number;
  /** What the concessionaire pays now, in whole pesos. Never negative. */
  totalAmountDue: number;

  dueDateMillis: number;
  /** What totalAmountDue becomes if this bill isn't paid by dueDateMillis. */
  projectedOverdueTotal: number;

  meterRolledOver: boolean;

  /**
   * What this bill adds to the running balance, excluding anything carried in.
   * Subtracting it recovers the pre-bill balance, which is how a corrected
   * reading avoids compounding the previous attempt.
   */
  chargesAdded: number;
}

export type ReadingProblem =
  | { kind: "below-previous"; previousReading: number }
  | { kind: "not-a-number" }
  | { kind: "negative" }
  | { kind: "implausibly-high"; consumption: number };

/** Rounds to centavos, so float noise never reaches Firestore or a receipt. */
function toCentavos(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Flat minimum charge per the rate card. Unrecognised values bill as residential. */
export function minimumChargeFor(
  classification: string,
  config: WaterRateConfig = DEFAULT_RATE_CONFIG
): number {
  const key = (classification ?? "").trim().toUpperCase() as ConcessionaireClassification;
  return config.minimumCharges[key] ?? config.minimumCharges.RESIDENTIAL;
}

/**
 * Consumption for a cycle, accounting for a meter that wrapped past its
 * maximum back to zero.
 *
 * A register reading 99,890 last month and 120 this month consumed 230 m³, not
 * minus ninety-nine thousand.
 */
export function consumptionFor(
  previousReading: number,
  currentReading: number,
  config: WaterRateConfig = DEFAULT_RATE_CONFIG
): { consumption: number; rolledOver: boolean } {
  if (currentReading >= previousReading) {
    return { consumption: currentReading - previousReading, rolledOver: false };
  }
  return {
    consumption: config.meterMaxReading - previousReading + currentReading + 1,
    rolledOver: true,
  };
}

/**
 * Validates a reading before it is billed, so the caller can explain the
 * problem rather than producing a nonsense bill.
 *
 * A reading below the previous one counts as a rollover only when the implied
 * consumption is plausible; a small backwards step is far likelier to be a typo
 * than a wrap of a 5-digit register.
 */
export function validateReading(
  previousReading: number,
  currentReading: number,
  config: WaterRateConfig = DEFAULT_RATE_CONFIG
): ReadingProblem | null {
  if (!Number.isFinite(currentReading)) return { kind: "not-a-number" };
  if (currentReading < 0) return { kind: "negative" };

  const { consumption, rolledOver } = consumptionFor(previousReading, currentReading, config);
  if (rolledOver && consumption > IMPLAUSIBLE_CONSUMPTION_M3) {
    return { kind: "below-previous", previousReading };
  }
  if (consumption > IMPLAUSIBLE_CONSUMPTION_M3) {
    return { kind: "implausibly-high", consumption };
  }
  return null;
}

/** Human-readable form of a [ReadingProblem], for the office-side bill dialog. */
export function describeReadingProblem(problem: ReadingProblem): string {
  switch (problem.kind) {
    case "not-a-number":
      return "Enter a valid meter reading.";
    case "negative":
      return "A meter reading can't be negative.";
    case "below-previous":
      return `That's below the previous reading of ${problem.previousReading} m³. Check the digits — if the meter was replaced, record that before billing.`;
    case "implausibly-high":
      return `That would be ${Math.round(problem.consumption)} m³ this cycle, which looks like a typo. Check the reading.`;
  }
}

export interface CalculateBillInput {
  previousReading: number;
  currentReading: number;
  classification: string;
  /**
   * Balance carried in from earlier cycles. Must NOT include anything this
   * bill itself adds — see [BillingResult.chargesAdded].
   */
  overdueBalance?: number;
  /** When the balance last went from zero to owing (epoch millis), if known. */
  delinquentSinceMillis?: number | null;
  /** Advance payment held on the account, drawn down against this bill. */
  creditBalance?: number;
  /**
   * The account's barangay, which fixes the day its bills fall due — see
   * lib/dueDates.ts. Without one, the bill is due fifteen days after billing.
   */
  barangay?: string | null;
  /** Overridable for testing. */
  now?: number;
  config?: WaterRateConfig;
}

export function calculateBill(input: CalculateBillInput): BillingResult {
  const {
    previousReading,
    currentReading,
    classification,
    overdueBalance = 0,
    delinquentSinceMillis = null,
    creditBalance = 0,
    barangay = null,
    now = Date.now(),
    config = DEFAULT_RATE_CONFIG,
  } = input;

  const { consumption, rolledOver } = consumptionFor(previousReading, currentReading, config);

  const minimumCharge = minimumChargeFor(classification, config);
  // Billed in whole pesos like every other line: 7.8 m³ at ₱10.80 is ₱84.
  const commodityCharge = Math.round(
    toCentavos(Math.max(0, consumption - config.minChargeThreshold) * config.commodityRate)
  );
  const totalWaterCharge = toCentavos(minimumCharge + commodityCharge);

  const carried = Math.max(0, overdueBalance);
  const owingSince =
    delinquentSinceMillis !== null && delinquentSinceMillis !== undefined && carried > 0
      ? delinquentSinceMillis
      : null;

  const daysOverdue = owingSince !== null ? Math.floor((now - owingSince) / MS_PER_DAY) : null;

  // Past due once today is after the due date the unpaid bill was given —
  // the barangay's day, or fifteen days after billing where it has none.
  const pastDue = owingSince !== null && now > dueDateFor(barangay, owingSince, config.gracePeriodDays);
  const latePenalty = pastDue ? config.latePenalty : 0;

  const grossDue = toCentavos(totalWaterCharge + carried + latePenalty);

  // Credit left on older accounts settles the bill before any cash does.
  const creditApplied = toCentavos(Math.min(Math.max(0, creditBalance), grossDue));
  const creditRemaining = toCentavos(Math.max(0, creditBalance) - creditApplied);
  const exactDue = toCentavos(grossDue - creditApplied);

  // Whole pesos already, unless a balance from before carried centavos in.
  const totalAmountDue = Math.round(exactDue);
  const roundingAdjustment = toCentavos(totalAmountDue - exactDue);

  const dueDateMillis = dueDateFor(barangay, now, config.gracePeriodDays);
  // Unpaid by then, the next bill carries this one plus a month's penalty.
  const projectedOverdueTotal = totalAmountDue + config.latePenalty;

  return {
    consumption,
    minimumCharge,
    commodityCharge,
    totalWaterCharge,
    overdueBalance: carried,
    daysOverdue,
    pastDue,
    overdueSurcharge: 0,
    extensionFee: latePenalty,
    creditApplied,
    creditRemaining,
    roundingAdjustment,
    totalAmountDue,
    dueDateMillis,
    projectedOverdueTotal,
    meterRolledOver: rolledOver,
    chargesAdded: toCentavos(totalWaterCharge + latePenalty + roundingAdjustment),
  };
}
