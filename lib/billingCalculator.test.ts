/**
 * Mirrors WaterBillingCalculatorTest.kt case for case.
 *
 * A bill issued from the office and a bill issued from a phone are the same
 * bill, so these two suites have to agree. If you change one rate card, the
 * other side's tests should fail — that's the point.
 */

import { describe, expect, it } from "vitest";
import {
  calculateBill,
  consumptionFor,
  minimumChargeFor,
  validateReading,
  type CalculateBillInput,
} from "./billingCalculator";

const DAY = 86_400_000;
const NOW = 1_757_000_000_000;

const bill = (over: Partial<CalculateBillInput> = {}) =>
  calculateBill({
    previousReading: 100,
    currentReading: 110,
    classification: "RESIDENTIAL",
    now: NOW,
    ...over,
  });

describe("rate card", () => {
  it("charges only the minimum within the 10 m³ allowance", () => {
    const r = bill({ previousReading: 100, currentReading: 108 });
    expect(r.consumption).toBe(8);
    expect(r.minimumCharge).toBe(100);
    expect(r.commodityCharge).toBe(0);
    expect(r.totalAmountDue).toBe(100);
  });

  it("adds commodity charge beyond ten cubic metres", () => {
    // 25 m³ used, 15 above the allowance at ₱10.80
    const r = bill({ previousReading: 100, currentReading: 125 });
    expect(r.commodityCharge).toBe(162);
    expect(r.totalAmountDue).toBe(262);
  });

  it("uses each classification's own minimum charge", () => {
    expect(minimumChargeFor("RESIDENTIAL")).toBe(100);
    expect(minimumChargeFor("GOVERNMENT")).toBe(100);
    expect(minimumChargeFor("COMMERCIAL A")).toBe(125);
    expect(minimumChargeFor("COMMERCIAL B")).toBe(150);
    expect(minimumChargeFor("  commercial a  ")).toBe(125);
    expect(minimumChargeFor(" Commercial B ")).toBe(150);
    // Imported data has carried odd classification strings before.
    expect(minimumChargeFor("INDUSTRIAL")).toBe(100);
    expect(minimumChargeFor("")).toBe(100);
  });
});

describe("grace period, surcharge and extension fee", () => {
  it("charges nothing extra inside the fifteen-day grace period", () => {
    const r = bill({ overdueBalance: 500, delinquentSinceMillis: NOW - 15 * DAY });
    expect(r.pastGracePeriod).toBe(false);
    expect(r.overdueSurcharge).toBe(0);
    expect(r.extensionFee).toBe(0);
    expect(r.totalAmountDue).toBe(600);
  });

  it("applies surcharge and extension fee from day sixteen", () => {
    const r = bill({ overdueBalance: 500, delinquentSinceMillis: NOW - 16 * DAY });
    expect(r.pastGracePeriod).toBe(true);
    expect(r.overdueSurcharge).toBe(15); // 3% of 500
    expect(r.extensionFee).toBe(10);
    expect(r.totalAmountDue).toBe(625);
  });

  it("charges the extension fee once per delinquency, not once per bill", () => {
    const r = bill({
      overdueBalance: 500,
      delinquentSinceMillis: NOW - 60 * DAY,
      extensionFeeAlreadyCharged: true,
    });
    expect(r.extensionFee).toBe(0);
    expect(r.overdueSurcharge).toBe(15); // surcharge still recurs
  });

  it("invents no penalty when the delinquency start is unknown", () => {
    const r = bill({ overdueBalance: 500, delinquentSinceMillis: null });
    expect(r.daysOverdue).toBeNull();
    expect(r.overdueSurcharge).toBe(0);
    expect(r.totalAmountDue).toBe(600);
  });

  it("keeps ageing a long-standing debt rather than resetting each cycle", () => {
    const r = bill({ overdueBalance: 2400, delinquentSinceMillis: NOW - 400 * DAY });
    expect(r.daysOverdue).toBe(400);
    expect(r.pastGracePeriod).toBe(true);
  });

  it("charges nothing extra when nothing is owed, even with a stale date", () => {
    const r = bill({ overdueBalance: 0, delinquentSinceMillis: NOW - 90 * DAY });
    expect(r.daysOverdue).toBeNull();
    expect(r.overdueSurcharge).toBe(0);
    expect(r.extensionFee).toBe(0);
  });
});

describe("advance credit", () => {
  it("draws credit down against the bill", () => {
    const r = bill({ creditBalance: 40 });
    expect(r.creditApplied).toBe(40);
    expect(r.creditRemaining).toBe(0);
    expect(r.totalAmountDue).toBe(60);
  });

  it("leaves the remainder on account and never goes negative", () => {
    const r = bill({ creditBalance: 250 });
    expect(r.creditApplied).toBe(100);
    expect(r.creditRemaining).toBe(150);
    expect(r.totalAmountDue).toBe(0);
  });
});

describe("meter rollover", () => {
  it("bills the real consumption when a register wraps past its maximum", () => {
    const r = bill({ previousReading: 99_890, currentReading: 120 });
    expect(r.meterRolledOver).toBe(true);
    expect(r.consumption).toBe(230);
    expect(r.totalAmountDue).toBeCloseTo(100 + 220 * 10.8, 2);
  });

  it("rejects a small backwards step as a typo rather than a rollover", () => {
    expect(validateReading(500, 480)).toEqual({ kind: "below-previous", previousReading: 500 });
  });

  it("rejects an implausibly large consumption", () => {
    expect(validateReading(100, 90_000)?.kind).toBe("implausibly-high");
  });

  it("accepts an ordinary reading", () => {
    expect(validateReading(100, 132)).toBeNull();
  });

  it("computes wrap consumption inclusively", () => {
    expect(consumptionFor(99_999, 0).consumption).toBe(1);
    expect(consumptionFor(99_999, 0).rolledOver).toBe(true);
  });
});

describe("what the receipt projects", () => {
  it("matches what the next bill would carry forward", () => {
    const r = bill();
    expect(r.projectedOverdueTotal).toBe(113); // 100 + 3% + ₱10
    expect(r.dueDateMillis).toBe(NOW + 15 * DAY);
  });

  it("does not project the extension fee twice", () => {
    const r = bill({ overdueBalance: 500, delinquentSinceMillis: NOW - 16 * DAY });
    expect(r.projectedOverdueTotal).toBeCloseTo(625 * 1.03, 2);
  });
});

describe("correction safety", () => {
  it("excludes the carried balance from chargesAdded", () => {
    // The upload/issue transaction subtracts this to recover the pre-bill
    // balance. If it included the carried balance, correcting a reading would
    // wipe the concessionaire's existing debt.
    const r = bill({
      previousReading: 100,
      currentReading: 125,
      overdueBalance: 500,
      delinquentSinceMillis: NOW - 16 * DAY,
    });
    expect(r.chargesAdded).toBe(262 + 15 + 10);
  });

  it("rounds money to centavos", () => {
    const r = bill({ previousReading: 0, currentReading: 13 });
    expect(r.commodityCharge).toBe(32.4);
    expect(r.totalAmountDue).toBe(132.4);
  });
});
