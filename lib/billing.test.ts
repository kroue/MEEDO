/**
 * Tests for lib/billing.ts.
 *
 * These helpers decide what a concessionaire is told they owe and whether the
 * office is shown them as disconnectable, so the cases below are written as
 * scenarios the office would recognise. Several exist because the behaviour was
 * wrong in production — the revenue double-count, the delinquency clock, and
 * the zero-peso badge each produced a visible error.
 */

import { describe, expect, it } from "vitest";
import {
  applyPaymentToHistory,
  concessionaireDaysOverdue,
  currentMonthStr,
  delinquencyStart,
  isConcessionaireDisconnectionEligible,
  isDisconnectionEligible,
  isPastGracePeriod,
  isPendingSync,
  monthSortKey,
  paymentStatus,
  reversePaymentInHistory,
  sortHistoryAsc,
  totalWaterCharge,
  waterChargeOf,
} from "./billing";
import type { MonthlyBillingRecord } from "./firebase/types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-08T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

function record(over: Partial<MonthlyBillingRecord> = {}): MonthlyBillingRecord {
  return {
    month: "AUG 2026",
    reading: 120,
    previousReading: 100,
    pesoAmount: 208,
    orNumber: "OR-2026-000001",
    amountPaid: 0,
    minimumCharge: 100,
    commodityCharge: 108,
    overdueBalance: 0,
    overdueSurcharge: 0,
    extensionFee: 0,
    ...over,
  };
}

// ── Month strings ────────────────────────────────────────────────────────────

describe("currentMonthStr", () => {
  it("formats as three-letter uppercase month and four-digit year", () => {
    expect(currentMonthStr(new Date(2026, 7, 15))).toBe("AUG 2026");
    expect(currentMonthStr(new Date(2026, 0, 1))).toBe("JAN 2026");
    expect(currentMonthStr(new Date(2025, 11, 31))).toBe("DEC 2025");
  });

  it("renders September as SEP, never SEPT", () => {
    // The specific bug this guards: toLocaleString("default", …) follows the
    // browser's locale, and several locales abbreviate September as "Sept".
    // The phone always queries Locale.US ("SEP 2026"), so a mismatched
    // abbreviation silently handed the reader an empty route for one month a
    // year, with no error on either side.
    expect(currentMonthStr(new Date(2026, 8, 1))).toBe("SEP 2026");
  });
});

describe("monthSortKey", () => {
  it("orders chronologically across a year boundary", () => {
    expect(monthSortKey("DEC 2025")).toBeLessThan(monthSortKey("JAN 2026"));
    expect(monthSortKey("JAN 2026")).toBeLessThan(monthSortKey("FEB 2026"));
  });

  it("sorts a list oldest-first", () => {
    const sorted = sortHistoryAsc([
      record({ month: "SEP 2026" }),
      record({ month: "JUL 2026" }),
      record({ month: "AUG 2026" }),
    ]);
    expect(sorted.map((r) => r.month)).toEqual(["JUL 2026", "AUG 2026", "SEP 2026"]);
  });
});

// ── Payment status badges ────────────────────────────────────────────────────

describe("paymentStatus", () => {
  it("reports the obvious cases", () => {
    expect(paymentStatus(200, 0)).toBe("UNPAID");
    expect(paymentStatus(200, 50)).toBe("PARTIAL");
    expect(paymentStatus(200, 200)).toBe("PAID");
    expect(paymentStatus(200, 250)).toBe("PAID");
  });

  it("treats a zero-peso bill as settled, not unpaid", () => {
    // Previously the "nothing paid" test ran first, so a ₱0 bill carried a red
    // UNPAID badge forever. It happens on imported and corrected records.
    expect(paymentStatus(0, 0)).toBe("PAID");
  });
});

// ── What was actually sold ───────────────────────────────────────────────────

describe("waterChargeOf", () => {
  it("returns only the water sold, not the rolled-forward balance", () => {
    // The bug this guards: summing pesoAmount counted the same debt once per
    // month it went unpaid. ₱100 unpaid in June reappears inside July's ₱213
    // and again inside August's ₱330 — ₱643 "billed" against ₱300 of water.
    const august = record({
      pesoAmount: 330,
      minimumCharge: 100,
      commodityCharge: 0,
      overdueBalance: 213,
      overdueSurcharge: 6.39,
      extensionFee: 10,
    });
    expect(waterChargeOf(august)).toBe(100);
  });

  it("falls back to total-minus-carried for records with no itemised breakdown", () => {
    const legacy: MonthlyBillingRecord = {
      month: "JAN 2024",
      reading: 50,
      previousReading: 30,
      pesoAmount: 313,
      orNumber: "",
      amountPaid: 0,
      overdueBalance: 213,
    };
    expect(waterChargeOf(legacy)).toBe(100);
  });

  it("never returns a negative charge", () => {
    const odd: MonthlyBillingRecord = {
      month: "JAN 2024",
      reading: 50,
      previousReading: 30,
      pesoAmount: 50,
      orNumber: "",
      amountPaid: 0,
      overdueBalance: 200,
    };
    expect(waterChargeOf(odd)).toBe(0);
  });

  it("sums across a history", () => {
    expect(
      totalWaterCharge([
        record({ month: "JUL 2026", minimumCharge: 100, commodityCharge: 0 }),
        record({ month: "AUG 2026", minimumCharge: 100, commodityCharge: 54 }),
      ])
    ).toBe(254);
  });
});

// ── Delinquency ──────────────────────────────────────────────────────────────

describe("delinquencyStart", () => {
  it("is null when nothing is owed", () => {
    expect(delinquencyStart({ billingBalance: 0, delinquentSince: daysAgo(90) })).toBeNull();
  });

  it("uses delinquentSince when present", () => {
    const since = daysAgo(400);
    expect(delinquencyStart({ billingBalance: 2400, delinquentSince: since })).toBe(since);
  });

  it("falls back to the oldest unpaid bill for legacy documents", () => {
    const start = delinquencyStart({
      billingBalance: 500,
      billingHistory: [
        record({ month: "AUG 2026", billingDate: daysAgo(10), amountPaid: 0 }),
        record({ month: "JUN 2026", billingDate: daysAgo(70), amountPaid: 0 }),
        record({ month: "MAY 2026", billingDate: daysAgo(100), amountPaid: 208 }), // settled
      ],
    });
    expect(start).toBe(daysAgo(70));
  });
});

describe("disconnection eligibility", () => {
  it("does not reset when a new bill lands on an old debt", () => {
    // The bug this guards: ageing the NEWEST bill meant an account unpaid since
    // March 2025 read as three days overdue the moment September's bill was
    // issued, so the delinquency report hid exactly the worst accounts.
    const chronic = {
      billingBalance: 2400,
      totalBalance: 2400,
      delinquentSince: daysAgo(400),
      billingHistory: [record({ month: "SEP 2026", billingDate: daysAgo(1) })],
    };
    expect(concessionaireDaysOverdue(chronic, NOW)).toBe(400);
    expect(isConcessionaireDisconnectionEligible(chronic)).toBe(true);
  });

  it("is not eligible inside the grace period", () => {
    const recent = { billingBalance: 208, totalBalance: 208, delinquentSince: daysAgo(5) };
    expect(isPastGracePeriod(concessionaireDaysOverdue(recent, NOW))).toBe(false);
    expect(isConcessionaireDisconnectionEligible(recent)).toBe(false);
  });

  it("crosses the thresholds on the documented days", () => {
    expect(isPastGracePeriod(15)).toBe(false);
    expect(isPastGracePeriod(16)).toBe(true);
    expect(isDisconnectionEligible(19)).toBe(false);
    expect(isDisconnectionEligible(20)).toBe(true);
  });

  it("is never eligible when the account owes nothing", () => {
    expect(
      isConcessionaireDisconnectionEligible({
        billingBalance: 0,
        totalBalance: 0,
        delinquentSince: daysAgo(400),
      })
    ).toBe(false);
  });

  it("reports unknown rather than overdue when there is no date to age from", () => {
    expect(concessionaireDaysOverdue({ billingBalance: 500, billingHistory: [] }, NOW)).toBeNull();
    expect(isConcessionaireDisconnectionEligible({ billingBalance: 500, billingHistory: [] })).toBe(
      false
    );
  });
});

// ── Payment allocation ───────────────────────────────────────────────────────

describe("applyPaymentToHistory", () => {
  const history = [
    record({ month: "JUL 2026", pesoAmount: 100, amountPaid: 0 }),
    record({ month: "AUG 2026", pesoAmount: 213, amountPaid: 0 }),
  ];

  it("marks every cycle settled when the whole balance is cleared", () => {
    const { updatedHistory, fullyPaid } = applyPaymentToHistory(history, 213, 213);
    expect(fullyPaid).toBe(true);
    expect(updatedHistory.map((r) => r.amountPaid)).toEqual([100, 213]);
  });

  it("applies a partial payment oldest-cycle-first", () => {
    const { updatedHistory, fullyPaid } = applyPaymentToHistory(history, 120, 213);
    expect(fullyPaid).toBe(false);
    expect(updatedHistory.map((r) => r.amountPaid)).toEqual([100, 20]);
  });

  it("leaves later cycles untouched when the payment runs out", () => {
    const { updatedHistory } = applyPaymentToHistory(history, 40, 213);
    expect(updatedHistory.map((r) => r.amountPaid)).toEqual([40, 0]);
  });
});

describe("reversePaymentInHistory", () => {
  it("unwinds newest-cycle-first, mirroring how the payment was applied", () => {
    const settled = [
      record({ month: "JUL 2026", pesoAmount: 100, amountPaid: 100 }),
      record({ month: "AUG 2026", pesoAmount: 213, amountPaid: 213 }),
    ];
    const reversed = reversePaymentInHistory(settled, 213);
    expect(reversed.map((r) => [r.month, r.amountPaid])).toEqual([
      ["JUL 2026", 100],
      ["AUG 2026", 0],
    ]);
  });

  it("never drives a cycle's paid amount below zero", () => {
    const partly = [record({ month: "AUG 2026", pesoAmount: 213, amountPaid: 50 })];
    expect(reversePaymentInHistory(partly, 500)[0].amountPaid).toBe(0);
  });

  it("returns the history oldest-first so the ledger order stays stable", () => {
    const settled = [
      record({ month: "AUG 2026", amountPaid: 208 }),
      record({ month: "JUL 2026", amountPaid: 208 }),
    ];
    expect(reversePaymentInHistory(settled, 10).map((r) => r.month)).toEqual([
      "JUL 2026",
      "AUG 2026",
    ]);
  });
});

// ── Mobile sync ──────────────────────────────────────────────────────────────

describe("isPendingSync", () => {
  const assigned = {
    status: "CONNECTED",
    assignedForReading: "SEP 2026",
    billingHistory: [] as MonthlyBillingRecord[],
  };

  it("is pending when assigned for the month but not yet billed", () => {
    expect(isPendingSync(assigned, "SEP 2026")).toBe(true);
  });

  it("is no longer pending once the bill arrives", () => {
    expect(
      isPendingSync({ ...assigned, billingHistory: [record({ month: "SEP 2026" })] }, "SEP 2026")
    ).toBe(false);
  });

  it("ignores accounts that are not connected or not assigned", () => {
    expect(isPendingSync({ ...assigned, status: "DISCONNECTED" }, "SEP 2026")).toBe(false);
    expect(isPendingSync({ ...assigned, assignedForReading: "AUG 2026" }, "SEP 2026")).toBe(false);
  });
});
