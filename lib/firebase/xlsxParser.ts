/**
 * lib/firebase/xlsxParser.ts
 *
 * Parses a water-district import workbook into Concessionaire objects ready
 * for Firestore. Replaces the old format, which packed 33 fixed-width month
 * blocks (5 columns each) into one wide sheet at hardcoded column offsets —
 * accurate only for one specific legacy spreadsheet and unreadable/unfillable
 * by hand. This format instead uses three named, header-based sheets (order
 * and column order don't matter — only the header text does), one row per
 * fact rather than one wide row per concessionaire:
 *
 *   1. "Concessionaires" (required) — one row per concessionaire: identity,
 *      classification, status, and current balances.
 *   2. "Billing History" (optional) — one row per past bill, linked to a
 *      concessionaire by Meter No.
 *   3. "Connection Payments" (optional) — one row per connection-fee
 *      installment, linked the same way.
 *
 * Use `downloadImportTemplate()` to hand the office a blank, correctly
 * headered version of this workbook to fill in.
 */

import * as XLSX from "xlsx";
import type {
  ConcessionaireClassification,
  ConcessionaireStatus,
  DisconnectedReason,
  MonthlyBillingRecord,
  MeterPayment,
  NewConcessionaireInput,
} from "./types";
import { CONCESSIONAIRE_CLASSIFICATIONS, CONCESSIONAIRE_STATUSES } from "./types";

// ── Sheet names ──────────────────────────────────────────────────────────────

const SHEET_CONCESSIONAIRES = "Concessionaires";
const SHEET_BILLING_HISTORY = "Billing History";
const SHEET_CONNECTION_PAYMENTS = "Connection Payments";

// ── Header matching ────────────────────────────────────────────────────────
//
// Headers are matched by normalized text (lowercased, punctuation/spacing
// stripped), not by position — "Meter No", "Meter No.", and "meter number"
// all resolve to the same column. Each logical field lists every header
// spelling it accepts.

function normaliseHeader(raw: unknown): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Maps normalized header text -> column index, from a sheet's first row. */
function buildHeaderIndex(headerRow: unknown[]): Map<string, number> {
  const index = new Map<string, number>();
  headerRow.forEach((cell, i) => {
    const key = normaliseHeader(cell);
    if (key) index.set(key, i);
  });
  return index;
}

/** First matching column index for any of `aliases`, or -1 if none are present. */
function findColumn(headerIndex: Map<string, number>, aliases: string[]): number {
  for (const alias of aliases) {
    const col = headerIndex.get(normaliseHeader(alias));
    if (col !== undefined) return col;
  }
  return -1;
}

function cell(row: unknown[], col: number): unknown {
  return col >= 0 ? row[col] : undefined;
}

// ── Value coercion ─────────────────────────────────────────────────────────

function toNum(v: unknown): number {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** Excel date serials are auto-converted to JS Date (see `cellDates: true` below). */
function toIsoDate(v: unknown): string | undefined {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString();
  const s = toStr(v);
  if (!s) return undefined;
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/** Meter numbers are sometimes auto-formatted as dates/numbers by Excel — keep the raw text. */
function meterKey(v: unknown): string {
  return toStr(v).toUpperCase();
}

function normaliseClassification(v: unknown): ConcessionaireClassification {
  const s = toStr(v).toUpperCase();
  const match = CONCESSIONAIRE_CLASSIFICATIONS.find((c) => c === s);
  return match ?? "RESIDENTIAL";
}

function normaliseStatus(v: unknown): ConcessionaireStatus {
  const s = toStr(v).toUpperCase();
  const match = CONCESSIONAIRE_STATUSES.find((c) => c === s);
  return match ?? "CONNECTED";
}

// ── Sheet: Concessionaires ───────────────────────────────────────────────────

interface ConcessionaireRow {
  meterKey: string;
  data: NewConcessionaireInput;
}

const CONCESSIONAIRE_COLUMNS = {
  meterNo: ["Meter No", "Meter Number", "Meter #", "Account No"],
  barangay: ["Barangay"],
  purok: ["Purok"],
  firstName: ["First Name"],
  middleName: ["Middle Name"],
  lastName: ["Last Name"],
  classification: ["Classification"],
  status: ["Status"],
  disconnectedReason: ["Disconnected Reason"],
  billingBalance: ["Billing Balance", "Water Bill Balance"],
  waterMeterFee: ["Water Meter Fee"],
  applicationFee: ["Application Fee"],
  inspectionFee: ["Inspection Fee"],
  otherPayables: ["Other Payables"],
  remarks: ["Remarks"],
};

function parseConcessionairesSheet(ws: XLSX.WorkSheet): {
  rows: ConcessionaireRow[];
  skipped: number;
} {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
  if (rows.length === 0) return { rows: [], skipped: 0 };

  const headerIndex = buildHeaderIndex(rows[0] as unknown[]);
  const col = Object.fromEntries(
    Object.entries(CONCESSIONAIRE_COLUMNS).map(([field, aliases]) => [
      field,
      findColumn(headerIndex, aliases),
    ])
  ) as Record<keyof typeof CONCESSIONAIRE_COLUMNS, number>;

  const result: ConcessionaireRow[] = [];
  let skipped = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const meterNo = toStr(cell(row, col.meterNo));
    const lastName = toStr(cell(row, col.lastName));
    const firstName = toStr(cell(row, col.firstName));

    // Skip blank / total rows — a real row needs at least a meter no and a name.
    if (!meterNo || (!firstName && !lastName)) {
      if (row.some((v) => toStr(v))) skipped++; // non-empty but unusable row
      continue;
    }

    const waterMeterFee = col.waterMeterFee >= 0 ? toNum(cell(row, col.waterMeterFee)) : 0;
    const applicationFee = col.applicationFee >= 0 ? toNum(cell(row, col.applicationFee)) : 0;
    const inspectionFee = col.inspectionFee >= 0 ? toNum(cell(row, col.inspectionFee)) : 0;
    const otherPayablesAmount = toNum(cell(row, col.otherPayables));
    const connectionFeeTotal = waterMeterFee + applicationFee + inspectionFee + otherPayablesAmount;

    const billingBalance = toNum(cell(row, col.billingBalance));
    const remarksText = toStr(cell(row, col.remarks));
    const disconnectedReasonText = toStr(cell(row, col.disconnectedReason)).toUpperCase();

    result.push({
      meterKey: meterKey(meterNo),
      data: {
        barangay: toStr(cell(row, col.barangay)).toUpperCase(),
        purok: toStr(cell(row, col.purok)),
        meterNumber: meterNo,
        firstName,
        middleName: toStr(cell(row, col.middleName)),
        lastName,
        classification: normaliseClassification(cell(row, col.classification)),
        status: normaliseStatus(cell(row, col.status)),
        // Firestore rejects fields with an explicit `undefined` value — these
        // two are only included at all when there's actually a value, rather
        // than set to `undefined` (which is NOT the same as omitting the key).
        ...(disconnectedReasonText
          ? { disconnectedReason: disconnectedReasonText as DisconnectedReason }
          : {}),
        billingBalance,
        waterMeterBalance: 0, // filled in after Connection Payments are parsed
        totalBalance: billingBalance, // recomputed below
        billingHistory: [],
        meterPayments: [],
        remarks: remarksText ? [{ text: remarksText, date: new Date().toISOString() }] : [],
        ...(connectionFeeTotal > 0
          ? {
              connectionFeeDetails: {
                waterMeter: waterMeterFee,
                applicationFee,
                inspectionFee,
                otherPayables:
                  otherPayablesAmount > 0
                    ? [{ description: "Imported", amount: otherPayablesAmount }]
                    : [],
                total: connectionFeeTotal,
              },
            }
          : {}),
      },
    });
  }

  return { rows: result, skipped };
}

// ── Sheet: Billing History ───────────────────────────────────────────────────

const BILLING_HISTORY_COLUMNS = {
  meterNo: ["Meter No", "Meter Number", "Meter #", "Account No"],
  month: ["Month"],
  previousReading: ["Previous Reading", "Prev Reading", "Prev. Reading"],
  currentReading: ["Current Reading", "Reading"],
  pesoAmount: ["Peso Amount", "Amount Billed", "Amount"],
  orNumber: ["OR Number", "OR No", "OR #"],
  amountPaid: ["Amount Paid"],
  billingDate: ["Billing Date"],
};

function parseBillingHistorySheet(ws: XLSX.WorkSheet): Map<string, MonthlyBillingRecord[]> {
  const byMeter = new Map<string, MonthlyBillingRecord[]>();
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
  if (rows.length === 0) return byMeter;

  const headerIndex = buildHeaderIndex(rows[0] as unknown[]);
  const col = Object.fromEntries(
    Object.entries(BILLING_HISTORY_COLUMNS).map(([field, aliases]) => [
      field,
      findColumn(headerIndex, aliases),
    ])
  ) as Record<keyof typeof BILLING_HISTORY_COLUMNS, number>;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const meterNo = toStr(cell(row, col.meterNo));
    const month = toStr(cell(row, col.month));
    if (!meterNo || !month) continue;

    const billingDate = toIsoDate(cell(row, col.billingDate));
    const record: MonthlyBillingRecord = {
      month: month.toUpperCase(),
      reading: toNum(cell(row, col.currentReading)),
      previousReading: toNum(cell(row, col.previousReading)),
      pesoAmount: toNum(cell(row, col.pesoAmount)),
      orNumber: toStr(cell(row, col.orNumber)),
      amountPaid: toNum(cell(row, col.amountPaid)),
      // Omit entirely rather than set to `undefined` — Firestore rejects that.
      ...(billingDate ? { billingDate } : {}),
    };

    const key = meterKey(meterNo);
    const list = byMeter.get(key) ?? [];
    list.push(record);
    byMeter.set(key, list);
  }

  return byMeter;
}

// ── Sheet: Connection Payments ───────────────────────────────────────────────

const CONNECTION_PAYMENTS_COLUMNS = {
  meterNo: ["Meter No", "Meter Number", "Meter #", "Account No"],
  slot: ["Slot"],
  amount: ["Amount"],
  orNumber: ["OR Number", "OR No", "OR #"],
  date: ["Date"],
};

function parseConnectionPaymentsSheet(ws: XLSX.WorkSheet): Map<string, MeterPayment[]> {
  const byMeter = new Map<string, MeterPayment[]>();
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
  if (rows.length === 0) return byMeter;

  const headerIndex = buildHeaderIndex(rows[0] as unknown[]);
  const col = Object.fromEntries(
    Object.entries(CONNECTION_PAYMENTS_COLUMNS).map(([field, aliases]) => [
      field,
      findColumn(headerIndex, aliases),
    ])
  ) as Record<keyof typeof CONNECTION_PAYMENTS_COLUMNS, number>;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const meterNo = toStr(cell(row, col.meterNo));
    const amount = toNum(cell(row, col.amount));
    const orNumber = toStr(cell(row, col.orNumber));
    if (!meterNo || (!amount && !orNumber)) continue;

    const date = toIsoDate(cell(row, col.date));
    const payment: MeterPayment = {
      slot: toStr(cell(row, col.slot)) || "Full",
      amount,
      orNumber,
      // Omit entirely rather than set to `undefined` — Firestore rejects that.
      ...(date ? { date } : {}),
    };

    const key = meterKey(meterNo);
    const list = byMeter.get(key) ?? [];
    list.push(payment);
    byMeter.set(key, list);
  }

  return byMeter;
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface ParsedSheet {
  barangay: string;
  concessionaires: NewConcessionaireInput[];
  skipped: number;
}

export interface XlsxParseResult {
  sheets: ParsedSheet[];
  totalConcessionaires: number;
  totalSkipped: number;
}

function findSheetCaseInsensitive(wb: XLSX.WorkBook, name: string): XLSX.WorkSheet | null {
  const match = wb.SheetNames.find((n) => n.trim().toLowerCase() === name.toLowerCase());
  return match ? wb.Sheets[match] : null;
}

/**
 * Parse an XLSX File object (from a browser <input type="file">) built from
 * the "Concessionaires" / "Billing History" / "Connection Payments" template
 * (see `downloadImportTemplate`). Concessionaires are grouped by their
 * Barangay column value for the import UI's per-barangay preview/selection.
 */
export async function parseXlsxFile(file: File): Promise<XlsxParseResult> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });

  const concessionairesSheet = findSheetCaseInsensitive(wb, SHEET_CONCESSIONAIRES);
  if (!concessionairesSheet) {
    throw new Error(
      `Workbook is missing a "${SHEET_CONCESSIONAIRES}" sheet. Download the template to see the expected format.`
    );
  }

  const { rows, skipped } = parseConcessionairesSheet(concessionairesSheet);

  const billingHistoryByMeter = new Map<string, MonthlyBillingRecord[]>();
  const billingHistorySheet = findSheetCaseInsensitive(wb, SHEET_BILLING_HISTORY);
  if (billingHistorySheet) {
    parseBillingHistorySheet(billingHistorySheet).forEach((records, key) =>
      billingHistoryByMeter.set(key, records)
    );
  }

  const connectionPaymentsByMeter = new Map<string, MeterPayment[]>();
  const connectionPaymentsSheet = findSheetCaseInsensitive(wb, SHEET_CONNECTION_PAYMENTS);
  if (connectionPaymentsSheet) {
    parseConnectionPaymentsSheet(connectionPaymentsSheet).forEach((payments, key) =>
      connectionPaymentsByMeter.set(key, payments)
    );
  }

  // Attach billing history + connection payments, then derive balances.
  const byBarangay = new Map<string, NewConcessionaireInput[]>();

  rows.forEach(({ meterKey: key, data }) => {
    const billingHistory = (billingHistoryByMeter.get(key) ?? []).sort(
      (a, b) => (a.billingDate ?? "").localeCompare(b.billingDate ?? "")
    );
    const meterPayments = connectionPaymentsByMeter.get(key) ?? [];
    const waterMeterPaid = meterPayments.reduce((sum, p) => sum + p.amount, 0);

    // If no explicit Billing Balance was given, derive it from the most recent
    // bill — the same "running balance" convention the rest of the app uses,
    // where each bill's own amount already folds in prior debt.
    //
    // Net of what was paid against that bill, which matters: taking the gross
    // amount handed every fully-settled account an opening balance equal to its
    // last bill, so an office that left the balance column blank for its paid-up
    // accounts would have re-billed every one of them.
    const latestBill = billingHistory[billingHistory.length - 1];
    const billingBalance =
      data.billingBalance > 0
        ? data.billingBalance
        : latestBill
        ? Math.max(0, Math.round((latestBill.pesoAmount - latestBill.amountPaid) * 100) / 100)
        : 0;

    const connectionFeeTotal = data.connectionFeeDetails?.total ?? 0;
    const waterMeterBalance = Math.max(0, connectionFeeTotal - waterMeterPaid);

    const finalData: NewConcessionaireInput = {
      ...data,
      billingHistory,
      meterPayments,
      billingBalance,
      waterMeterBalance,
      totalBalance: billingBalance + waterMeterBalance,
    };

    const list = byBarangay.get(finalData.barangay) ?? [];
    list.push(finalData);
    byBarangay.set(finalData.barangay, list);
  });

  const sheets: ParsedSheet[] = Array.from(byBarangay.entries()).map(([barangay, list]) => ({
    barangay,
    concessionaires: list,
    skipped: 0,
  }));
  if (skipped > 0 && sheets.length > 0) sheets[0].skipped = skipped;

  return {
    sheets,
    totalConcessionaires: rows.length,
    totalSkipped: skipped,
  };
}

/**
 * Preview: parse and return first N rows per barangay group for UI display.
 */
export async function previewXlsxFile(
  file: File,
  maxPerSheet = 5
): Promise<XlsxParseResult> {
  const full = await parseXlsxFile(file);
  return {
    ...full,
    sheets: full.sheets.map((s) => ({
      ...s,
      concessionaires: s.concessionaires.slice(0, maxPerSheet),
    })),
  };
}

// ── Template generation ──────────────────────────────────────────────────────

/**
 * Builds and downloads a blank workbook with the three sheets above,
 * correctly headered plus one example row each, ready for the office to
 * fill in and re-upload via `parseXlsxFile`.
 */
export function downloadImportTemplate(): void {
  const wb = XLSX.utils.book_new();

  const concessionairesSheet = XLSX.utils.aoa_to_sheet([
    [
      "Meter No",
      "Barangay",
      "Purok",
      "First Name",
      "Middle Name",
      "Last Name",
      "Classification",
      "Status",
      "Disconnected Reason",
      "Billing Balance",
      "Water Meter Fee",
      "Application Fee",
      "Inspection Fee",
      "Other Payables",
      "Remarks",
    ],
    [
      "MTR-0001",
      "BO-OT",
      "1",
      "Juan",
      "",
      "Dela Cruz",
      "RESIDENTIAL",
      "CONNECTED",
      "",
      500,
      1600,
      150,
      50,
      0,
      "",
    ],
  ]);
  XLSX.utils.book_append_sheet(wb, concessionairesSheet, SHEET_CONCESSIONAIRES);

  const billingHistorySheet = XLSX.utils.aoa_to_sheet([
    [
      "Meter No",
      "Month",
      "Previous Reading",
      "Current Reading",
      "Peso Amount",
      "OR Number",
      "Amount Paid",
      "Billing Date",
    ],
    ["MTR-0001", "JUL 2026", 100, 112, 229.6, "OR-2026-000123", 0, "2026-07-05"],
  ]);
  XLSX.utils.book_append_sheet(wb, billingHistorySheet, SHEET_BILLING_HISTORY);

  const connectionPaymentsSheet = XLSX.utils.aoa_to_sheet([
    ["Meter No", "Slot", "Amount", "OR Number", "Date"],
    ["MTR-0001", "1st", 500, "OR-2026-000050", "2026-01-15"],
  ]);
  XLSX.utils.book_append_sheet(wb, connectionPaymentsSheet, SHEET_CONNECTION_PAYMENTS);

  XLSX.writeFile(wb, "concessionaire-import-template.xlsx");
}
