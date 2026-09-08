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

  it("parses a duplicate meter number as two rows, leaving it to the writer", async () => {
    // The parser sees rows; only batchImportConcessionaires sees the whole
    // sheet, so that is where the duplicate is reported and dropped. Pinned
    // here so the division of responsibility stays deliberate.
    const { all } = await load();
    expect(all.filter((c) => c.meterNumber === "MTR-1001").length).toBe(2);
  });

  it("imports only the usable rows", async () => {
    const { result, all } = await load();
    // 13 data rows: 9 importable, 2 unusable, 1 blank, 1 duplicate meter.
    // The duplicate parses here — batchImportConcessionaires is what rejects
    // it, since only the write path can see the whole sheet at once.
    expect(all.length).toBe(10);
    expect(result.totalSkipped).toBe(2); // no meter number; no name
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
    const { byMeter } = await load();
    expect(byMeter.get("MTR-3003")!.classification).toBe("RESIDENTIAL");
  });

  it("ignores history and payments for meters that aren't in the sheet", async () => {
    const { all } = await load();
    expect(all.some((c) => c.meterNumber === "MTR-9999")).toBe(false);
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
