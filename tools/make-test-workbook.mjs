/**
 * tools/make-test-workbook.mjs
 *
 * Generates a test import workbook for the XLSX importer.
 *
 *   node tools/make-test-workbook.mjs [outputPath]
 *
 * Deliberately not a happy-path file. It exercises the things that actually
 * break importers: header spellings that differ from the template, rows that
 * should be skipped rather than imported as blanks, a duplicate meter number
 * inside one sheet, a balance that has to be derived rather than read, and a
 * delinquent account whose bills compound month over month the way the real
 * rolling-balance convention does.
 *
 * Every peso figure is computed from the Board-approved rate card rather than
 * typed in, so the file stays self-consistent if the rates are edited here.
 */

import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";

// ── Rate card (mirrors lib/billingCalculator.ts) ────────────────────────────
const MIN_CHARGE = { RESIDENTIAL: 100, GOVERNMENT: 100, "COMMERCIAL A": 125, "COMMERCIAL B": 150 };
const FREE_M3 = 10;
const COMMODITY_RATE = 10.8;
const SURCHARGE_RATE = 0.03;
const EXTENSION_FEE = 10;

const peso = (n) => Math.round(n * 100) / 100;

const waterCharge = (classification, prev, curr) =>
  peso(MIN_CHARGE[classification] + Math.max(0, curr - prev - FREE_M3) * COMMODITY_RATE);

/** ISO date for the Nth day of a month, so billingDate ordering is meaningful. */
const billingDate = (year, month, day = 5) =>
  new Date(Date.UTC(year, month - 1, day, 2, 0, 0)).toISOString();

// ── Concessionaires ─────────────────────────────────────────────────────────
//
// Header row uses the "Meter No." / "Water Bill Balance" spellings rather than
// the template's own, to prove the importer matches on normalised header text
// and not on position or exact wording.
const concessionaires = [
  [
    "Meter No.",
    "Barangay",
    "Purok",
    "First Name",
    "Middle Name",
    "Last Name",
    "Classification",
    "Status",
    "Disconnected Reason",
    "Water Bill Balance",
    "Water Meter Fee",
    "Application Fee",
    "Inspection Fee",
    "Other Payables",
    "Remarks",
  ],

  // 1. Fully paid residential with two months of history and a part-paid meter.
  ["MTR-1001", "BO-OT", "1", "Juan", "Santos", "Dela Cruz", "RESIDENTIAL", "CONNECTED", "", 0, 1500, 200, 100, 0, "Original 2019 connection"],

  // 2. Delinquent residential — no explicit balance, so the importer must
  //    derive it from the most recent bill. Its history compounds below.
  ["MTR-1002", "BO-OT", "2", "Maria", "Reyes", "Santos", "RESIDENTIAL", "CONNECTED", "", 0, 1500, 200, 100, 0, "Follow up on arrears"],

  // 3. Commercial A — higher minimum charge, heavier consumption.
  ["MTR-1003", "BO-OT", "3", "Ramon", "", "Bautista", "COMMERCIAL A", "CONNECTED", "", 0, 1800, 200, 100, 250, "Sari-sari store"],

  // 4. Commercial B in a different barangay — the import UI groups by barangay,
  //    so more than one is needed to see the grouping work.
  ["MTR-2001", "CG", "1", "Lourdes", "Cruz", "Mangubat", "COMMERCIAL B", "CONNECTED", "", 0, 1800, 200, 100, 0, "Carinderia"],

  // 5. Government account.
  ["MTR-2002", "CG", "2", "Barangay", "", "Health Station", "GOVERNMENT", "CONNECTED", "", 0, 1500, 200, 100, 0, ""],

  // 6. Disconnected with a reason — the reason column must survive.
  ["MTR-2003", "CG", "4", "Pedro", "Lim", "Abadilla", "DISCONNECTED", "DISCONNECTED", "NON-PAYMENT", 1240.5, 1500, 200, 100, 0, "Disconnected Mar 2026"],

  // 7. Brand-new connection: no history, no payments, balance is just the fee.
  ["MTR-3001", "KABATANGAN", "1", "Aisha", "Macapaar", "Alonto", "RESIDENTIAL", "CONNECTED", "", 0, 1500, 200, 100, 0, "New application Aug 2026"],

  // 8. Explicit balance that disagrees with the history — the explicit column
  //    must win, since that is the office's own figure.
  ["MTR-3002", "KABATANGAN", "2", "Norodin", "", "Guro", "RESIDENTIAL", "CONNECTED", "", 875.25, 1500, 200, 100, 0, "Balance reconciled manually"],

  // 9. An unrecognised classification — should fall back to RESIDENTIAL rather
  //    than failing the row.
  ["MTR-3003", "KABATANGAN", "3", "Fatima", "", "Sarip", "INDUSTRIAL", "CONNECTED", "", 0, 1500, 200, 100, 0, "Classification needs checking"],

  // ── Rows that must NOT import cleanly ────────────────────────────────────

  // 10. No meter number — unusable as a key, so skipped and counted.
  ["", "SALVACION", "1", "Unnamed", "", "Account", "RESIDENTIAL", "CONNECTED", "", 0, 0, 0, 0, 0, "Missing meter number"],

  // 11. Meter number but no name — also skipped.
  ["MTR-4001", "SALVACION", "2", "", "", "", "RESIDENTIAL", "CONNECTED", "", 0, 0, 0, 0, 0, "Missing name"],

  // 12. Entirely blank row — skipped silently, not counted as a problem.
  ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],

  // 13. Duplicate of MTR-1001 within this same sheet. The importer should
  //     report it and use only the first occurrence, rather than racing two
  //     writes to the same document inside one batch.
  ["MTR-1001", "BO-OT", "9", "Juan (duplicate row)", "", "Dela Cruz", "RESIDENTIAL", "CONNECTED", "", 999, 0, 0, 0, 0, "Duplicate — should be reported"],
];

// ── Billing History ─────────────────────────────────────────────────────────
//
// Header row uses "Prev Reading" / "Reading" / "Amount Billed" / "OR No" —
// all aliases, none of them the template's primary spelling.
const billingRows = [
  ["Meter No.", "Month", "Prev Reading", "Reading", "Amount Billed", "OR No", "Amount Paid", "Billing Date"],
];

/** MTR-1001 — settled every month. */
{
  const cls = "RESIDENTIAL";
  const months = [
    ["JUN 2026", 120, 138, 6],
    ["JUL 2026", 138, 151, 7],
    ["AUG 2026", 151, 166, 5],
  ];
  months.forEach(([month, prev, curr, day], i) => {
    const amount = waterCharge(cls, prev, curr);
    billingRows.push([
      "MTR-1001",
      month,
      prev,
      curr,
      amount,
      `OR-2026-10${String(i + 1).padStart(4, "0")}`,
      amount, // paid in full
      billingDate(2026, 6 + i, day),
    ]);
  });
}

/**
 * MTR-1002 — unpaid since June, so each bill carries the last one forward plus
 * the 3% surcharge, and June's carries the one-off ₱10 extension fee. This is
 * the shape the running-balance convention actually produces, and it is what
 * makes the Reports "water sold vs billed" distinction visible: three months of
 * water here total far less than the sum of the three bill amounts.
 */
{
  const cls = "RESIDENTIAL";
  const months = [
    ["JUN 2026", 88, 101, 6],
    ["JUL 2026", 101, 119, 7],
    ["AUG 2026", 119, 134, 5],
  ];
  let carried = 0;
  let feeCharged = false;
  months.forEach(([month, prev, curr, day], i) => {
    const water = waterCharge(cls, prev, curr);
    const surcharge = carried > 0 ? peso(carried * SURCHARGE_RATE) : 0;
    const fee = carried > 0 && !feeCharged ? EXTENSION_FEE : 0;
    if (fee) feeCharged = true;
    const total = peso(water + carried + surcharge + fee);
    billingRows.push([
      "MTR-1002",
      month,
      prev,
      curr,
      total,
      `OR-2026-20${String(i + 1).padStart(4, "0")}`,
      0, // never paid
      billingDate(2026, 6 + i, day),
    ]);
    carried = total;
  });
}

/** MTR-1003 — commercial, one partial payment. */
{
  const amount = waterCharge("COMMERCIAL A", 400, 462);
  billingRows.push([
    "MTR-1003",
    "AUG 2026",
    400,
    462,
    amount,
    "OR-2026-300001",
    peso(amount / 2), // half paid — should read PARTIAL
    billingDate(2026, 8, 5),
  ]);
}

/** MTR-2001 — commercial B, settled. */
{
  const amount = waterCharge("COMMERCIAL B", 900, 948);
  billingRows.push(["MTR-2001", "AUG 2026", 900, 948, amount, "OR-2026-400001", amount, billingDate(2026, 8, 6)]);
}

/** MTR-2002 — government, settled, low usage inside the free allowance. */
{
  const amount = waterCharge("GOVERNMENT", 60, 68);
  billingRows.push(["MTR-2002", "AUG 2026", 60, 68, amount, "OR-2026-400002", amount, billingDate(2026, 8, 6)]);
}

/** MTR-3002 — history exists, but the sheet's explicit balance should win. */
{
  const amount = waterCharge("RESIDENTIAL", 210, 229);
  billingRows.push(["MTR-3002", "AUG 2026", 210, 229, amount, "OR-2026-500001", 0, billingDate(2026, 8, 7)]);
}

/** A history row for a meter that isn't in the Concessionaires sheet — must be
 *  ignored rather than creating a phantom account. */
billingRows.push(["MTR-9999", "AUG 2026", 10, 20, 208, "OR-2026-999999", 0, billingDate(2026, 8, 5)]);

// ── Connection Payments ─────────────────────────────────────────────────────
const connectionRows = [
  ["Meter No.", "Slot", "Amount", "OR Number", "Date"],
  // MTR-1001: fee is 1800 total, two installments paid, so 900 should remain.
  ["MTR-1001", "1st", 450, "CF-2026-0001", new Date(Date.UTC(2026, 5, 10))],
  ["MTR-1001", "2nd", 450, "CF-2026-0002", new Date(Date.UTC(2026, 6, 12))],
  // MTR-1003: fee 2350 (1800 + 250 other + 200 + 100), paid in full.
  ["MTR-1003", "Full", 2350, "CF-2026-0003", new Date(Date.UTC(2026, 5, 20))],
  // MTR-2001: one installment against 2100.
  ["MTR-2001", "1st", 525, "CF-2026-0004", new Date(Date.UTC(2026, 6, 2))],
  // A payment for a meter not in the sheet — ignored.
  ["MTR-9999", "1st", 500, "CF-2026-9999", new Date(Date.UTC(2026, 6, 2))],
];

// ── Build ───────────────────────────────────────────────────────────────────
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(concessionaires), "Concessionaires");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(billingRows), "Billing History");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(connectionRows), "Connection Payments");

const out = process.argv[2] || "MEEDO-import-test.xlsx";
writeFileSync(out, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

console.log(`Wrote ${out}`);
console.log(`  Concessionaires   ${concessionaires.length - 1} rows (9 importable, 2 skipped, 1 blank, 1 duplicate)`);
console.log(`  Billing History   ${billingRows.length - 1} rows (1 for an unknown meter)`);
console.log(`  Connection Pymts  ${connectionRows.length - 1} rows (1 for an unknown meter)`);
