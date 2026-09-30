import { describe, expect, it } from "vitest";
import { calculateBill } from "./billingCalculator";
import {
  BASE_RATE_CARD,
  addMonths,
  describeRateCard,
  monthLabel,
  parseSchedule,
  pastChanges,
  rateCardFor,
  rateCardProblem,
  scheduleWithChange,
  scheduleWithout,
  toCalculatorConfig,
  upcomingChanges,
  type ScheduledRateCard,
} from "./rates";

const change = (effectiveMonth: string, commodityRate: number, extra: Partial<ScheduledRateCard> = {}): ScheduledRateCard => ({
  ...BASE_RATE_CARD,
  minimumCharges: { ...BASE_RATE_CARD.minimumCharges },
  commodityRate,
  effectiveMonth,
  setBy: "admin@meedo.com",
  setAt: "2026-09-20T00:00:00.000Z",
  ...extra,
});

describe("which rates a month is billed at", () => {
  const schedule = [change("2026-10", 12), change("2027-01", 13.5)];

  it("uses the base rates before any change", () => {
    expect(rateCardFor([], "2026-09")).toBe(BASE_RATE_CARD);
    expect(rateCardFor(schedule, "2026-09").commodityRate).toBe(10.8);
  });

  it("uses a change from its first month on, until the next one", () => {
    expect(rateCardFor(schedule, "2026-10").commodityRate).toBe(12);
    expect(rateCardFor(schedule, "2026-12").commodityRate).toBe(12);
    expect(rateCardFor(schedule, "2027-01").commodityRate).toBe(13.5);
    expect(rateCardFor(schedule, "2030-05").commodityRate).toBe(13.5);
  });

  it("doesn't depend on the order the schedule was stored in", () => {
    expect(rateCardFor([...schedule].reverse(), "2026-11").commodityRate).toBe(12);
  });

  it("splits the schedule into history and what's coming", () => {
    expect(upcomingChanges(schedule, "2026-10").map((e) => e.effectiveMonth)).toEqual(["2027-01"]);
    expect(pastChanges(schedule, "2026-10").map((e) => e.effectiveMonth)).toEqual(["2026-10"]);
  });
});

describe("a new rate card on a bill", () => {
  it("prices cubic metres at the new rate and the minimum at the new minimum", () => {
    const card = change("2026-10", 12, {
      minChargeThreshold: 8,
      minimumCharges: { RESIDENTIAL: 110, GOVERNMENT: 105, "COMMERCIAL A": 130, "COMMERCIAL B": 160 },
    });
    const bill = calculateBill({
      previousReading: 100,
      currentReading: 120,
      classification: "COMMERCIAL B",
      config: toCalculatorConfig(card),
    });
    // 20 m³: 8 covered by the ₱160 minimum, 12 at ₱12.00.
    expect(bill.minimumCharge).toBe(160);
    expect(bill.commodityCharge).toBe(144);
    expect(bill.totalWaterCharge).toBe(304);
  });

  it("bills exactly as before under the base rates", () => {
    const bill = calculateBill({ previousReading: 100, currentReading: 120, classification: "RESIDENTIAL" });
    expect(bill.totalWaterCharge).toBe(208);
  });
});

describe("changing the schedule", () => {
  it("adds a change, and replaces one for the same month", () => {
    const one = scheduleWithChange([], change("2026-10", 12), "2026-09");
    const two = scheduleWithChange(one, change("2026-10", 12.5), "2026-09");
    expect(two).toHaveLength(1);
    expect(two[0].commodityRate).toBe(12.5);
  });

  it("allows this month but refuses a month already billed", () => {
    expect(scheduleWithChange([], change("2026-09", 12), "2026-09")).toHaveLength(1);
    expect(() => scheduleWithChange([], change("2026-08", 12), "2026-09")).toThrow(/already been billed/);
  });

  it("refuses rates that make no sense", () => {
    expect(() => scheduleWithChange([], change("2026-10", 0), "2026-09")).toThrow(/more than zero/);
    expect(() => scheduleWithChange([], change("2026-10", 12.345), "2026-09")).toThrow(/centavos/);
    expect(rateCardProblem({ ...BASE_RATE_CARD, minChargeThreshold: 2.5 })).toMatch(/whole number/);
    expect(
      rateCardProblem({ ...BASE_RATE_CARD, minimumCharges: { ...BASE_RATE_CARD.minimumCharges, GOVERNMENT: -1 } })
    ).toMatch(/government/);
    expect(
      rateCardProblem({ ...BASE_RATE_CARD, minimumCharges: { ...BASE_RATE_CARD.minimumCharges, RESIDENTIAL: 100.5 } })
    ).toMatch(/whole peso/);
    expect(rateCardProblem(BASE_RATE_CARD)).toBeNull();
  });

  it("withdraws only a change that hasn't started", () => {
    const schedule = [change("2026-09", 12), change("2026-11", 13)];
    expect(scheduleWithout(schedule, "2026-11", "2026-09")).toHaveLength(1);
    expect(() => scheduleWithout(schedule, "2026-09", "2026-09")).toThrow(/already in force/);
  });
});

describe("reading a stored schedule", () => {
  it("keeps good entries and drops malformed ones", () => {
    const parsed = parseSchedule([
      change("2026-11", 13),
      { effectiveMonth: "not a month", commodityRate: 12 },
      { ...change("2026-10", 12), commodityRate: "nope" },
      change("2026-10", 12),
      null,
    ]);
    expect(parsed.map((e) => e.effectiveMonth)).toEqual(["2026-10", "2026-11"]);
    expect(parseSchedule(undefined)).toEqual([]);
  });
});

describe("months", () => {
  it("counts across a year", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-09", 12)).toBe("2027-09");
  });

  it("writes a month the way the rest of the system does", () => {
    expect(monthLabel("2026-10")).toBe("OCT 2026");
  });

  it("describes a card in one line", () => {
    expect(describeRateCard(BASE_RATE_CARD)).toContain("₱10.80 per m³ beyond 10 m³");
  });
});
