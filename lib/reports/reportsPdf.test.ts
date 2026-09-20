import { describe, expect, it } from "vitest";
import {
  ALL_REPORT_SECTIONS,
  createReportsPdf,
  formatPdfPeso,
  reportsPdfFileName,
  type ReportsPdfData,
} from "./reportsPdf";

const RESIDENTIAL = "Residential / Gov't";
const COMMERCIAL = "Commercial A";

function sample(overrides: Partial<ReportsPdfData> = {}): ReportsPdfData {
  return {
    collectionSummary: [
      { category: RESIDENTIAL, accounts: 9, billed: 2269.52, collected: 300 },
      { category: COMMERCIAL, accounts: 1, billed: 1234.5, collected: 0 },
    ],
    monthlyCollections: [
      { month: "AUG 2026", [RESIDENTIAL]: 1500, [COMMERCIAL]: 900 },
      { month: "SEP 2026", [RESIDENTIAL]: 769.52, [COMMERCIAL]: 334.5 },
    ],
    tiers: [RESIDENTIAL, COMMERCIAL],
    tierColors: { [RESIDENTIAL]: "#3b82f6", [COMMERCIAL]: "#10b981" },
    consumptionBrackets: [
      { bracket: "0-10 m³", count: 6, percentage: 60 },
      { bracket: "11-20 m³", count: 4, percentage: 40 },
    ],
    totalAccounts: 10,
    delinquentAccounts: [
      {
        name: "Pedro Lim Abadilla",
        meterNumber: "MTR-1001",
        barangay: "BO-OT",
        tier: RESIDENTIAL,
        balance: 3312.5,
        overdueDays: 45,
        disconnectionEligible: true,
      },
      {
        name: "Maria Reyes",
        meterNumber: "MTR-1002",
        barangay: "BO-OT",
        tier: COMMERCIAL,
        balance: 120,
        overdueDays: null,
        disconnectionEligible: false,
      },
    ],
    delinquencySummary: { count: 2, rate: 20, outstanding: 3432.5, disconnectionEligible: 1 },
    ...overrides,
  };
}

const OPTIONS = { generatedAt: new Date(2026, 8, 15, 10, 42), generatedBy: "admin" };

async function render(sections = ALL_REPORT_SECTIONS, data = sample()) {
  const doc = await createReportsPdf(sections, data, OPTIONS);
  return { doc, raw: doc.output() };
}

describe("createReportsPdf", () => {
  it("puts all three reports in one file, each on its own page", async () => {
    const { doc, raw } = await render();
    expect(raw.startsWith("%PDF-")).toBe(true);
    expect(raw).toContain("Collection Summary");
    expect(raw).toContain("Consumption Analysis");
    expect(raw).toContain("Delinquency Report");
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(3);
  });

  it("includes only the report that was asked for", async () => {
    const { doc, raw } = await render(["delinquency"]);
    expect(raw).toContain("Delinquent Accounts");
    expect(raw).toContain("Pedro Lim Abadilla");
    expect(raw).toContain("MTR-1001");
    expect(raw).not.toContain("Monthly Water Sales by Tier");
    expect(raw).not.toContain("Consumption Distribution");
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it("writes amounts the built-in font can draw, never the peso sign", async () => {
    const { raw } = await render(["collections"]);
    expect(raw).toContain("PHP 1,234.50");
    expect(raw).not.toContain("₱");
  });

  it("still produces a readable report for a district with no data yet", async () => {
    const empty = sample({
      collectionSummary: [],
      monthlyCollections: [],
      tiers: [],
      consumptionBrackets: [{ bracket: "0-10 m³", count: 0, percentage: 0 }],
      totalAccounts: 0,
      delinquentAccounts: [],
      delinquencySummary: { count: 0, rate: 0, outstanding: 0, disconnectionEligible: 0 },
    });
    const { raw } = await render(ALL_REPORT_SECTIONS, empty);
    expect(raw).toContain("No billing history yet.");
    expect(raw).toContain("No readings yet.");
    expect(raw).toContain("No delinquent accounts.");
  });

  it("carries a long delinquency list across pages, numbered", async () => {
    const many = sample({
      delinquentAccounts: Array.from({ length: 150 }, (_, i) => ({
        name: `Account ${i + 1}`,
        meterNumber: `MTR-${2000 + i}`,
        barangay: "POBLACION",
        tier: RESIDENTIAL,
        balance: 1000 - i,
        overdueDays: i,
        disconnectionEligible: i >= 20,
      })),
    });
    const { doc, raw } = await render(["delinquency"], many);
    const pages = doc.getNumberOfPages();
    expect(pages).toBeGreaterThan(2);
    expect(raw).toContain("Account 150");
    expect(raw).toContain(`Page ${pages} of ${pages}`);
  });

  it("lists every month in the table even when the chart shows only the latest year", async () => {
    const months = Array.from({ length: 18 }, (_, i) => ({
      month: `M${String(i + 1).padStart(2, "0")}`,
      [RESIDENTIAL]: 100 + i,
    }));
    const { raw } = await render(["collections"], sample({ monthlyCollections: months, tiers: [RESIDENTIAL] }));
    expect(raw).toContain("the table lists all 18");
    expect(raw).toContain("M01");
  });

  it("never names the backend", async () => {
    const { raw } = await render();
    expect(raw).not.toMatch(/firestore|firebase/i);
  });

  it("refuses an empty selection instead of producing a blank file", async () => {
    await expect(createReportsPdf([], sample(), OPTIONS)).rejects.toThrow(/at least one/);
  });
});

describe("reportsPdfFileName", () => {
  const date = new Date(2026, 8, 5);

  it("names a single report after it", () => {
    expect(reportsPdfFileName(["consumption"], date)).toBe("MEEDO-Consumption-Analysis-2026-09-05.pdf");
  });

  it("calls the full set just Reports", () => {
    expect(reportsPdfFileName(ALL_REPORT_SECTIONS, date)).toBe("MEEDO-Reports-2026-09-05.pdf");
  });
});

describe("formatPdfPeso", () => {
  it("uses PHP with two decimals and thousands separators", () => {
    expect(formatPdfPeso(1234.5)).toBe("PHP 1,234.50");
    expect(formatPdfPeso(0)).toBe("PHP 0.00");
  });
});
