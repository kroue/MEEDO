/**
 * Parses the generated test workbook through the real importer.
 *
 * The workbook (tools/make-test-workbook.mjs) is built to exercise the things
 * that actually break importers — alias headers, rows that must be skipped, a
 * duplicate meter number, a balance that has to be derived, history rows for a
 * meter that doesn't exist. These assertions pin what the parser is supposed to
 * do with each of them, so the fixture and the parser can't drift apart
 * silently.
 *
 * Run `node tools/make-test-workbook.mjs` first; the test skips itself with a
 * clear message if the file isn't there.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { parseXlsxFile } from "./xlsxParser";
import type { NewConcessionaireInput } from "./types";

const FIXTURE = "MEEDO-import-test.xlsx";
const present = existsSync(FIXTURE);

/** parseXlsxFile takes a browser File; Node's File wraps the same bytes. */
function fixtureFile(): File {
  const bytes = readFileSync(FIXTURE);
  return new File([bytes], FIXTURE, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

const suite = present ? describe : describe.skip;
if (!present) {
  console.warn(`\n${FIXTURE} not found — run: node tools/make-test-workbook.mjs\n`);
}

suite("parseXlsxFile against the test workbook", () => {
  let all: NewConcessionaireInput[];
  let byMeter: Map<string, NewConcessionaireInput>;
  let result: Awaited<ReturnType<typeof parseXlsxFile>>;

  const load = async () => {
    if (!all) {
      result = await parseXlsxFile(fixtureFile());
      all = result.sheets.flatMap((s) => s.concessionaires);
      // FIRST occurrence wins, matching what batchImportConcessionaires does
      // with a meter number that appears twice in one workbook. Keying on the
      // last would silently hand every assertion the duplicate row.
      byMeter = new Map();
      all.forEach((c) => {
        if (!byMeter.has(c.meterNumber)) byMeter.set(c.meterNumber, c);
      });
    }
    return { result, all, byMeter };
  };

  it("groups concessionaires by barangay", async () => {
    const { result } = await load();
    const barangays = result.sheets.map((s) => s.barangay).sort();
    expect(barangays).toEqual(["BO-OT", "CG", "KABATANGAN"]);
  });

  it("leaves out a second row with the same meter number, naming the first", async () => {
    // Caught here rather than only when writing, so the office sees which row
    // it was before importing. batchImportConcessionaires still refuses a
    // duplicate too, as a last line of defence.
    const { all, result } = await load();
    expect(all.filter((c) => c.meterNumber === "MTR-1001").length).toBe(1);
    const duplicate = result.issues.find((i) => i.kind === "Meter number already used on an earlier row");
    expect(duplicate?.level).toBe("skipped");
    expect(duplicate?.note).toContain("row 2");
  });

  it("imports only the usable rows", async () => {
    const { result, all } = await load();
    // 13 data rows: 9 importable, 2 unusable, 1 blank, 1 duplicate meter.
    expect(all.length).toBe(9);
    expect(result.totalSkipped).toBe(3); // no meter number; no name; duplicate
  });

  it("matches header aliases rather than exact template wording", async () => {
    // The sheet says "Meter No." / "Water Bill Balance" / "Prev Reading" /
    // "Reading" / "Amount Billed" / "OR No" — none of them the primary spelling.
    const { byMeter } = await load();
    const juan = byMeter.get("MTR-1001")!;
    expect(juan.firstName).toBe("Juan");
    expect(juan.billingHistory.length).toBe(3);
    expect(juan.billingHistory[0].previousReading).toBe(120);
    expect(juan.billingHistory[0].orNumber).toBe("OR-2026-100001");
  });

  it("orders each account's billing history oldest-first", async () => {
    const { byMeter } = await load();
    const months = byMeter.get("MTR-1001")!.billingHistory.map((h) => h.month);
    expect(months).toEqual(["JUN 2026", "JUL 2026", "AUG 2026"]);
  });

  it("leaves a settled account with no opening balance", async () => {
    // MTR-1001 paid every bill in full and its Billing Balance column is blank.
    // Taking the newest bill's gross amount would have re-billed it — and would
    // have done that to every paid-up account in a workbook that left the
    // column empty.
    const { byMeter } = await load();
    const juan = byMeter.get("MTR-1001")!;
    const august = juan.billingHistory.at(-1)!;
    expect(august.amountPaid).toBe(august.pesoAmount);
    expect(juan.billingBalance).toBe(0);
  });

  it("carries only the unpaid part of a part-paid bill", async () => {
    const { byMeter } = await load();
    const ramon = byMeter.get("MTR-1003")!;
    const bill = ramon.billingHistory.at(-1)!;
    expect(ramon.billingBalance).toBeCloseTo(bill.pesoAmount - bill.amountPaid, 2);
  });

  it("derives the balance from the newest bill when none is given", async () => {
    // MTR-1002 has no explicit balance. Its August bill already carries June
    // and July forward, so that total IS the running balance.
    const { byMeter } = await load();
    const maria = byMeter.get("MTR-1002")!;
    const august = maria.billingHistory.at(-1)!;
    expect(august.month).toBe("AUG 2026");
    expect(maria.billingBalance).toBe(august.pesoAmount);

    // And the point of the rolling-balance convention: the running total is far
    // larger than the water actually sold, because each bill carries the last
    // one forward plus surcharge. This is exactly the gap that made Reports
    // over-count revenue before waterChargeOf existed.
    const waterSold = maria.billingHistory.reduce(
      (sum, h) => sum + (h.minimumCharge ?? 0) + (h.commodityCharge ?? 0),
      0
    );
    const billTotals = maria.billingHistory.reduce((sum, h) => sum + h.pesoAmount, 0);
    expect(maria.billingBalance).toBeGreaterThan(maria.billingHistory[0].pesoAmount);
    expect(billTotals).toBeGreaterThan(waterSold || maria.billingBalance);
  });

  it("lets an explicit balance override the history", async () => {
    // The office's own reconciled figure wins over anything derivable.
    const { byMeter } = await load();
    expect(byMeter.get("MTR-3002")!.billingBalance).toBe(875.25);
  });

  it("computes the connection fee balance from fees minus payments", async () => {
    const { byMeter } = await load();
    const juan = byMeter.get("MTR-1001")!;
    // 1500 + 200 + 100 = 1800 in fees, 450 + 450 paid.
    expect(juan.connectionFeeDetails?.total).toBe(1800);
    expect(juan.meterPayments.length).toBe(2);
    expect(juan.waterMeterBalance).toBe(900);

    const ramon = byMeter.get("MTR-1003")!;
    // 1800 + 200 + 100 + 250 other = 2350, paid in full.
    expect(ramon.connectionFeeDetails?.total).toBe(2350);
    expect(ramon.waterMeterBalance).toBe(0);
  });

  it("adds the connection fee to the total balance", async () => {
    const { byMeter } = await load();
    const juan = byMeter.get("MTR-1001")!;
    expect(juan.totalBalance).toBe(juan.billingBalance + juan.waterMeterBalance);
  });

  it("keeps a disconnected account's reason", async () => {
    const { byMeter } = await load();
    const pedro = byMeter.get("MTR-2003")!;
    expect(pedro.status).toBe("DISCONNECTED");
    expect(pedro.disconnectedReason).toBe("NON-PAYMENT");
    expect(pedro.billingBalance).toBe(1240.5);
  });

  it("falls back to RESIDENTIAL for an unrecognised classification", async () => {
    // Imported data has carried odd classification strings before; a row like
    // this should still import rather than failing the whole sheet.
    // It decides the rate, though, so it is flagged for checking — never
    // defaulted silently.
    const { byMeter, result } = await load();
    expect(byMeter.get("MTR-3003")!.classification).toBe("RESIDENTIAL");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ column: "Classification", level: "check", kind: "Unknown classification imported as RESIDENTIAL" })
    );
  });

  it("leaves out history and payments for meters that aren't in the sheet, and says so", async () => {
    const { all, result } = await load();
    expect(all.some((c) => c.meterNumber === "MTR-9999")).toBe(false);
    const orphans = result.issues.filter((i) => i.note?.startsWith("MTR-9999"));
    expect(orphans.map((i) => i.sheet).sort()).toEqual(["Billing History", "Connection Payments"]);
    expect(orphans.every((i) => i.level === "skipped")).toBe(true);
  });

  it("gives a brand-new connection no history and only the fee to pay", async () => {
    const { byMeter } = await load();
    const aisha = byMeter.get("MTR-3001")!;
    expect(aisha.billingHistory).toEqual([]);
    expect(aisha.billingBalance).toBe(0);
    expect(aisha.waterMeterBalance).toBe(1800);
  });

  it("carries an amountPaid through for a part-paid bill", async () => {
    const { byMeter } = await load();
    const bill = byMeter.get("MTR-1003")!.billingHistory[0];
    expect(bill.amountPaid).toBeGreaterThan(0);
    expect(bill.amountPaid).toBeLessThan(bill.pesoAmount);
  });

  it("never emits an undefined field — Firestore rejects those", async () => {
    // The parser omits optional keys rather than setting them undefined. A
    // regression here fails at write time, deep inside a batch, which is a far
    // worse place to find out.
    const { all } = await load();
    const undefinedValues = all.flatMap((c) =>
      Object.entries(c)
        .filter(([, v]) => v === undefined)
        .map(([k]) => `${c.meterNumber}.${k}`)
    );
    expect(undefinedValues).toEqual([]);
  });
});

/**
 * Built in memory rather than from the fixture, so these hold even before
 * anyone has run tools/make-test-workbook.mjs.
 */
describe("account numbers and the meter column", () => {
  async function parseSheet(rows: unknown[][]) {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Concessionaires");
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = new File([bytes], "sheet.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const parsed = await parseXlsxFile(file);
    return parsed.sheets.flatMap((s) => s.concessionaires);
  }

  it("never reads an account number from a workbook — the import assigns one", async () => {
    const [account] = await parseSheet([
      ["Meter No", "Barangay", "Purok", "First Name", "Last Name", "Account Number"],
      ["MTR-9001", "BO-OT", "1", "Juan", "Dela Cruz", "2026-000999"],
    ]);
    expect(account.meterNumber).toBe("MTR-9001");
    expect(account.accountNumber).toBeUndefined();
  });

  it("still accepts an older sheet that labels the meter column Account No", async () => {
    const [account] = await parseSheet([
      ["Account No", "Barangay", "Purok", "First Name", "Last Name"],
      ["MTR-9002", "BO-OT", "2", "Maria", "Reyes"],
    ]);
    expect(account.meterNumber).toBe("MTR-9002");
  });

  it("takes the meter column when a sheet carries both headers", async () => {
    const [account] = await parseSheet([
      ["Account No", "Meter No", "Barangay", "Purok", "First Name", "Last Name"],
      ["2026-000123", "MTR-9003", "BO-OT", "3", "Pedro", "Santos"],
    ]);
    expect(account.meterNumber).toBe("MTR-9003");
  });
});

/**
 * The cleaning, end to end through a workbook laid out like the template —
 * built in memory, so it holds without the fixture.
 */
describe("cleaning the office's own spellings", () => {
  const HEADERS = [
    "Meter No", "Barangay", "Purok", "First Name", "Middle Name", "Last Name", "Classification",
    "Status", "Disconnected Reason", "Billing Balance", "Water Meter Fee", "Application Fee",
    "Inspection Fee", "Other Payables", "Remarks",
  ];

  async function parse(concessionaires: unknown[][], billing?: unknown[][], payments?: unknown[][]) {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS, ...concessionaires]), "Concessionaires");
    if (billing) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(billing), "Billing History");
    if (payments) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(payments), "Connection Payments");
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const result = await parseXlsxFile(new File([bytes], "sheet.xlsx"));
    return { result, all: result.sheets.flatMap((s) => s.concessionaires) };
  }

  it("stores what the office meant, not what it typed", async () => {
    const { all } = await parse([
      ["mtr 710002", "BOOT", "Purok 3", "CHRISTIAN", "e", "BUSTAMANTE JR", "Comm A", "DISCO", "NON PAYMENT",
        "₱5,410.52", "1,600.00", "₱150", "50.00 ", "200 (pipes)", "  Meter  replaced 2025 "],
    ]);
    const [c] = all;
    expect(c).toMatchObject({
      meterNumber: "MTR-710002",
      barangay: "BO-OT",
      purok: "3",
      firstName: "Christian",
      middleName: "E.",
      lastName: "Bustamante Jr.",
      classification: "COMMERCIAL A",
      status: "DISCONNECTED",
      disconnectedReason: "NON-PAYMENT",
      billingBalance: 5410.52,
    });
    expect(c.connectionFeeDetails).toMatchObject({
      waterMeter: 1600,
      applicationFee: 150,
      inspectionFee: 50,
      otherPayables: [{ description: "pipes", amount: 200 }],
      total: 2000,
    });
    expect(c.remarks[0].text).toBe("Meter replaced 2025");
  });

  it("keeps every account in one of the nine barangays", async () => {
    const { result } = await parse([
      ["MTR-1", "Cebuano Group", "1", "Ana", "", "Cruz", "", "", "", 0, 0, 0, 0, 0, ""],
      ["MTR-2", "Katutongan", "1", "Ben", "", "Lim", "", "", "", 0, 0, 0, 0, 0, ""],
      ["MTR-3", "Poblacion", "1", "Cai", "", "Uy", "", "", "", 0, 0, 0, 0, 0, ""],
    ]);
    expect(result.sheets.map((s) => s.barangay).sort()).toEqual(["CG", "KATUTUNGAN"]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ row: 3, level: "check", kind: "Barangay spelling corrected" })
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ row: 4, level: "skipped", kind: "Unknown barangay" })
    );
  });

  it("catches a duplicate that differs only in how the meter number is written", async () => {
    // "MTR 710057" and "MTR-710057" used to get past the duplicate check and
    // become two accounts.
    const { all, result } = await parse([
      ["MTR-710057", "MILAYA", "1", "Rowena", "", "Dagoc", "", "", "", 0, 0, 0, 0, 0, ""],
      ["MTR 710057", "MILAYA", "1", "ROWENA", "", "DAGOC", "", "", "", 0, 0, 0, 0, 0, ""],
    ]);
    expect(all.length).toBe(1);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ row: 3, level: "skipped", kind: "Meter number already used on an earlier row" })
    );
  });

  it("leaves out a row it can't read rather than importing a wrong balance", async () => {
    const { all, result } = await parse([
      ["MTR-5", "MILAYA", "1", "Liza", "", "Ompad", "", "", "", "paid", 0, 0, 0, 0, ""],
    ]);
    expect(all.length).toBe(0);
    expect(result.totalSkipped).toBe(1);
    expect(result.issues[0]).toMatchObject({ column: "Billing Balance", level: "skipped" });
  });

  it("leaves out a header row pasted into the data", async () => {
    const { all, result } = await parse([HEADERS]);
    expect(all.length).toBe(0);
    expect(result.issues[0].kind).toBe("Header row repeated in the data");
  });

  it("links bills and payments whose meter is written differently", async () => {
    const { all } = await parse(
      [["MTR-710013", "DIOMIL", "2", "Joel", "", "Largo", "", "", "", 0, 1600, 150, 50, 0, ""]],
      [
        ["Meter No", "Month", "Previous Reading", "Current Reading", "Peso Amount", "OR Number", "Amount Paid", "Billing Date"],
        ["MTR 710013", "July 2026", 100, 112, "₱229.60", "", "229.60", "2026-07-05"],
      ],
      [
        ["Meter No", "Slot", "Amount", "OR Number", "Date"],
        ["mtr710013", "first", "₱500", "CF-1", "2026-01-15"],
      ]
    );
    const [c] = all;
    expect(c.billingHistory).toEqual([
      expect.objectContaining({ month: "JUL 2026", pesoAmount: 229.6, amountPaid: 229.6 }),
    ]);
    expect(c.meterPayments).toEqual([expect.objectContaining({ slot: "1st", amount: 500 })]);
    expect(c.waterMeterBalance).toBe(1300);
  });
});
