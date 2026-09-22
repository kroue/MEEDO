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
 * Delinquency: day 0–15 after the account went delinquent is on time; day 16+
 * adds a 3% surcharge on the carried balance every cycle it stays unpaid, plus
 * a flat ₱10 extension fee charged once per delinquency. "When it went
 * delinquent" is `delinquentSince` — see delinquencyStart() in billing.ts for
 * why it is neither the newest bill's date nor the oldest unpaid row's.
 */

import { dueDateFor } from "./dueDates";

export interface WaterRateConfig {
  /** Cubic metres covered by the minimum charge. */
  minChargeThreshold: number;
  /** ₱ per m³ beyond the threshold. */
  commodityRate: number;
  /** Surcharge on the carried balance once past the grace period. */
  overdueSurchargeRate: number;
  /** Days after going delinquent before a surcharge applies. */
  gracePeriodDays: number;
  /** Flat fee for pursuing a delinquent account, once per delinquency. */
  extensionFee: number;
  /** Highest reading a 5-digit mechanical register shows before wrapping to zero. */
  meterMaxReading: number;
}

export const DEFAULT_RATE_CONFIG: WaterRateConfig = {
  minChargeThreshold: 10,
  commodityRate: 10.8,
  overdueSurchargeRate: 0.03,
  gracePeriodDays: 15,
  extensionFee: 10,
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
  pastGracePeriod: boolean;
  overdueSurcharge: number;
  extensionFee: number;

  creditApplied: number;
  creditRemaining: number;

  /** What the concessionaire pays now. Never negative. */
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
export function minimumChargeFor(classification: string): number {
  switch ((classification ?? "").trim().toUpperCase()) {
    case "COMMERCIAL A":
      return 125;
    case "COMMERCIAL B":
      return 150;
    default:
      return 100; // RESIDENTIAL / GOVERNMENT
  }
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
  /** True if the ₱10 fee was already charged within this unpaid streak. */
  extensionFeeAlreadyCharged?: boolean;
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
    extensionFeeAlreadyCharged = false,
    barangay = null,
    now = Date.now(),
    config = DEFAULT_RATE_CONFIG,
  } = input;

  const { consumption, rolledOver } = consumptionFor(previousReading, currentReading, config);

  const minimumCharge = minimumChargeFor(classification);
  const commodityCharge = toCentavos(
    Math.max(0, consumption - config.minChargeThreshold) * config.commodityRate
  );
  const totalWaterCharge = toCentavos(minimumCharge + commodityCharge);

  const carried = Math.max(0, overdueBalance);

  const daysOverdue =
    delinquentSinceMillis !== null && delinquentSinceMillis !== undefined && carried > 0
      ? Math.floor((now - delinquentSinceMillis) / MS_PER_DAY)
      : null;

  const pastGracePeriod = daysOverdue !== null && daysOverdue > config.gracePeriodDays;

  const overdueSurcharge = pastGracePeriod
    ? toCentavos(carried * config.overdueSurchargeRate)
    : 0;
  const extensionFee = pastGracePeriod && !extensionFeeAlreadyCharged ? config.extensionFee : 0;

  const grossDue = toCentavos(totalWaterCharge + carried + overdueSurcharge + extensionFee);

  // Advance payments settle the bill before any cash does.
  const creditApplied = toCentavos(Math.min(Math.max(0, creditBalance), grossDue));
  const creditRemaining = toCentavos(Math.max(0, creditBalance) - creditApplied);
  const totalAmountDue = toCentavos(grossDue - creditApplied);

  const dueDateMillis = dueDateFor(barangay, now, config.gracePeriodDays);
  const extensionFeeUsedForThisDebt = extensionFeeAlreadyCharged || extensionFee > 0;
  const projectedSurcharge = toCentavos(totalAmountDue * config.overdueSurchargeRate);
  const projectedExtensionFee = extensionFeeUsedForThisDebt ? 0 : config.extensionFee;
  const projectedOverdueTotal = toCentavos(
    totalAmountDue + projectedSurcharge + projectedExtensionFee
  );

  return {
    consumption,
    minimumCharge,
    commodityCharge,
    totalWaterCharge,
    overdueBalance: carried,
    daysOverdue,
    pastGracePeriod,
    overdueSurcharge,
    extensionFee,
    creditApplied,
    creditRemaining,
    totalAmountDue,
    dueDateMillis,
    projectedOverdueTotal,
    meterRolledOver: rolledOver,
    chargesAdded: toCentavos(totalWaterCharge + overdueSurcharge + extensionFee),
  };
}
