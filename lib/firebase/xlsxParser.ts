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
 * Every value passes through lib/importCleaning.ts on the way in, and the
 * result lists each thing that was tidied, each guess that needs checking,
 * and each row left out — with the row number the office sees — so the
 * import page can show all of it before anything is written.
 *
 * Use `downloadImportTemplate()` to hand the office a blank, correctly
 * headered version of this workbook to fill in.
 */

import * as XLSX from "xlsx";
import type {
  Barangay,
  MonthlyBillingRecord,
  MeterPayment,
  NewConcessionaireInput,
} from "./types";
import {
  cleanBarangay,
  cleanClassification,
  cleanDisconnectedReason,
  cleanMeterNo,
  cleanMiddleName,
  cleanMoney,
  cleanMonth,
  cleanName,
  cleanPurok,
  cleanSlot,
  cleanStatus,
  isHeaderText,
  type Cleaned,
} from "../importCleaning";

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

/** Matches how batchImportConcessionaires keys meter numbers. */
function meterKey(meterNumber: string): string {
  return meterNumber.trim().toUpperCase();
}

function isBlankRow(row: unknown[]): boolean {
  return !row.some((v) => toStr(v));
}

// ── What the import did ──────────────────────────────────────────────────────

export type ImportIssueLevel = "fixed" | "check" | "skipped";

/**
 * One thing the import tidied, wants checked, or left out — listed on the
 * import page before anything is written.
 */
export interface ImportIssue {
  sheet: string;
  /** The row number as the office sees it in the spreadsheet. */
  row: number;
  /** The column it concerns, or "Whole row". */
  column: string;
  level: ImportIssueLevel;
  /** Short, stable label the import page groups issues by. */
  kind: string;
  note?: string;
}

/**
 * Collects the cleaning of one spreadsheet row. The first value that can't be
 * stored becomes the reason the row is left out; the changes made to the
 * others are only reported for a row that goes in.
 */
class RowCleaner {
  readonly changes: ImportIssue[] = [];
  refusal: ImportIssue | null = null;
  private readonly sheet: string;
  private readonly row: number;

  constructor(sheet: string, row: number) {
    this.sheet = sheet;
    this.row = row;
  }

  take<T>(column: string, cleaned: Cleaned<T>, fallback: T): T {
    if (!cleaned.ok) {
      this.refusal ??= this.issue(column, "skipped", cleaned.kind, `${cleaned.note} — row left out`);
      return fallback;
    }
    cleaned.changes.forEach((c) => this.changes.push(this.issue(column, c.level, c.kind, c.note)));
    return cleaned.value;
  }

  issue(column: string, level: ImportIssueLevel, kind: string, note?: string): ImportIssue {
    return { sheet: this.sheet, row: this.row, column, level, kind, ...(note ? { note } : {}) };
  }
}

// ── Sheet: Concessionaires ───────────────────────────────────────────────────

interface ConcessionaireRow {
  meterKey: string;
  data: NewConcessionaireInput;
}

const CONCESSIONAIRE_COLUMNS = {
  // "Account No" is last on purpose: the office's older sheets label the
  // meter column that way, so it is still accepted, but a sheet carrying both
  // headers takes the meter one. Account numbers themselves are never read
  // from a workbook — they are assigned when the account is created.
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
  issues: ImportIssue[];
} {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
  if (rows.length === 0) return { rows: [], skipped: 0, issues: [] };

  const headerIndex = buildHeaderIndex(rows[0] as unknown[]);
  const col = Object.fromEntries(
    Object.entries(CONCESSIONAIRE_COLUMNS).map(([field, aliases]) => [
      field,
      findColumn(headerIndex, aliases),
    ])
  ) as Record<keyof typeof CONCESSIONAIRE_COLUMNS, number>;

  const result: ConcessionaireRow[] = [];
  const issues: ImportIssue[] = [];
  // Meter number -> the row that used it first. A second row with the same
  // meter is left out here, where the office can see which row it was, and
  // batchImportConcessionaires still refuses one as a last line of defence.
  const firstRowFor = new Map<string, number>();
  let skipped = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    if (isBlankRow(row)) continue;

    const c = new RowCleaner(SHEET_CONCESSIONAIRES, r + 1);
    const leaveOut = (issue: ImportIssue) => {
      skipped++;
      issues.push(issue);
    };

    const rawMeter = cell(row, col.meterNo);
    const typedFirst = toStr(cell(row, col.firstName));
    const typedLast = toStr(cell(row, col.lastName));
    if (isHeaderText(rawMeter)) {
      leaveOut(c.issue("Whole row", "skipped", "Header row repeated in the data", "Column headings, not an account — row left out"));
      continue;
    }
    // A real row needs at least a meter number and a name.
    if (!toStr(rawMeter)) {
      leaveOut(c.issue("Meter No", "skipped", "No meter number", "A row needs a meter number — row left out"));
      continue;
    }
    if (!typedFirst && !typedLast) {
      leaveOut(c.issue("First Name, Last Name", "skipped", "No name", "A row needs a name — row left out"));
      continue;
    }

    const meterNumber = c.take("Meter No", cleanMeterNo(rawMeter), "");
    const barangay = c.take<Barangay | "">("Barangay", cleanBarangay(cell(row, col.barangay)), "");
    const purok = c.take("Purok", cleanPurok(cell(row, col.purok)), "");
    const firstName = c.take("First Name", cleanName(typedFirst, { first: true }), "");
    const middleName = c.take("Middle Name", cleanMiddleName(cell(row, col.middleName)), "");
    const lastName = c.take("Last Name", cleanName(typedLast), "");
    // A sheet without the column at all keeps the old default quietly; a
    // blank or unknown value in a column that is there gets flagged.
    const classification =
      col.classification >= 0
        ? c.take("Classification", cleanClassification(cell(row, col.classification)), "RESIDENTIAL")
        : "RESIDENTIAL";
    const status =
      col.status >= 0 ? c.take("Status", cleanStatus(cell(row, col.status)), "CONNECTED") : "CONNECTED";
    const disconnectedReason = c.take(
      "Disconnected Reason",
      cleanDisconnectedReason(cell(row, col.disconnectedReason)),
      ""
    );
    const billingBalance = c.take("Billing Balance", cleanMoney(cell(row, col.billingBalance)), 0);
    const waterMeterFee = c.take("Water Meter Fee", cleanMoney(cell(row, col.waterMeterFee)), 0);
    const applicationFee = c.take("Application Fee", cleanMoney(cell(row, col.applicationFee)), 0);
    const inspectionFee = c.take("Inspection Fee", cleanMoney(cell(row, col.inspectionFee)), 0);

    // "200 (pipes)" — the words say what the payable is for, which is exactly
    // what its description holds, so they are kept rather than dropped.
    let otherCleaned = cleanMoney(cell(row, col.otherPayables));
    let otherDescription = "Imported";
    if (otherCleaned.ok && otherCleaned.leftover) {
      otherDescription = otherCleaned.leftover;
      otherCleaned = {
        ...otherCleaned,
        changes: [
          ...otherCleaned.changes.filter((ch) => ch.kind !== "Words dropped from an amount"),
          {
            level: "fixed",
            kind: "Words in Other Payables kept as its description",
            note: `"${otherCleaned.leftover}"`,
          },
        ],
      };
    }
    const otherPayablesAmount = c.take("Other Payables", otherCleaned, 0);
    const remarksText = toStr(cell(row, col.remarks)).replace(/\s+/g, " ");

    if (c.refusal) {
      leaveOut(c.refusal);
      continue;
    }
    const key = meterKey(meterNumber);
    const earlier = firstRowFor.get(key);
    if (earlier !== undefined) {
      leaveOut(
        c.issue(
          "Meter No",
          "skipped",
          "Meter number already used on an earlier row",
          `${meterNumber} is on row ${earlier} — only that row is imported`
        )
      );
      continue;
    }
    firstRowFor.set(key, r + 1);
    issues.push(...c.changes);

    const connectionFeeTotal = waterMeterFee + applicationFee + inspectionFee + otherPayablesAmount;
    result.push({
      meterKey: key,
      data: {
        barangay: barangay as Barangay,
        purok,
        meterNumber,
        firstName,
        middleName,
        lastName,
        classification,
        status,
        // Firestore rejects fields with an explicit `undefined` value — these
        // two are only included at all when there's actually a value, rather
        // than set to `undefined` (which is NOT the same as omitting the key).
        ...(disconnectedReason ? { disconnectedReason } : {}),
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
                    ? [{ description: otherDescription, amount: otherPayablesAmount }]
                    : [],
                total: connectionFeeTotal,
              },
            }
          : {}),
      },
    });
  }

  return { rows: result, skipped, issues };
}

/**
 * A Billing History or Connection Payments line, kept with its row number and
 * the changes made to it until it's known whether its meter matched an
 * account — a line that never goes in shouldn't list its tidying.
 */
interface LinkedLine<T> {
  row: number;
  meterNumber: string;
  item: T;
  changes: ImportIssue[];
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

function parseBillingHistorySheet(ws: XLSX.WorkSheet): {
  byMeter: Map<string, LinkedLine<MonthlyBillingRecord>[]>;
  issues: ImportIssue[];
} {
  const byMeter = new Map<string, LinkedLine<MonthlyBillingRecord>[]>();
  const issues: ImportIssue[] = [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
  if (rows.length === 0) return { byMeter, issues };

  const headerIndex = buildHeaderIndex(rows[0] as unknown[]);
  const col = Object.fromEntries(
    Object.entries(BILLING_HISTORY_COLUMNS).map(([field, aliases]) => [
      field,
      findColumn(headerIndex, aliases),
    ])
  ) as Record<keyof typeof BILLING_HISTORY_COLUMNS, number>;

  // Meter + month -> the row that billed it first. A second bill for the same
  // month would overwrite the first: each bill is stored under its month.
  const firstRowFor = new Map<string, number>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    if (isBlankRow(row)) continue;
    const c = new RowCleaner(SHEET_BILLING_HISTORY, r + 1);
    const rawMeter = cell(row, col.meterNo);
    if (isHeaderText(rawMeter)) {
      issues.push(c.issue("Whole row", "skipped", "Header row repeated in the data", "Column headings, not a bill — row left out"));
      continue;
    }
    if (!toStr(rawMeter) || !toStr(cell(row, col.month))) {
      issues.push(c.issue("Meter No, Month", "skipped", "Bill with no meter number or month", "Row left out"));
      continue;
    }

    const meterNumber = c.take("Meter No", cleanMeterNo(rawMeter), "");
    const month = c.take("Month", cleanMonth(cell(row, col.month)), "");
    const previousReading = c.take("Previous Reading", cleanMoney(cell(row, col.previousReading)), 0);
    const reading = c.take("Current Reading", cleanMoney(cell(row, col.currentReading)), 0);
    const pesoAmount = c.take("Peso Amount", cleanMoney(cell(row, col.pesoAmount)), 0);
    const amountPaid = c.take("Amount Paid", cleanMoney(cell(row, col.amountPaid)), 0);
    if (c.refusal) {
      issues.push(c.refusal);
      continue;
    }
    const key = meterKey(meterNumber);
    const earlier = firstRowFor.get(`${key}|${month}`);
    if (earlier !== undefined) {
      issues.push(
        c.issue("Month", "skipped", "Month billed twice", `${meterNumber} already has ${month} on row ${earlier} — row left out`)
      );
      continue;
    }
    firstRowFor.set(`${key}|${month}`, r + 1);

    const billingDate = toIsoDate(cell(row, col.billingDate));
    const record: MonthlyBillingRecord = {
      month,
      reading,
      previousReading,
      pesoAmount,
      orNumber: toStr(cell(row, col.orNumber)),
      amountPaid,
      // Omit entirely rather than set to `undefined` — Firestore rejects that.
      ...(billingDate ? { billingDate } : {}),
    };
    const list = byMeter.get(key) ?? [];
    list.push({ row: r + 1, meterNumber, item: record, changes: c.changes });
    byMeter.set(key, list);
  }

  return { byMeter, issues };
}

// ── Sheet: Connection Payments ───────────────────────────────────────────────

const CONNECTION_PAYMENTS_COLUMNS = {
  meterNo: ["Meter No", "Meter Number", "Meter #", "Account No"],
  slot: ["Slot"],
  amount: ["Amount"],
  orNumber: ["OR Number", "OR No", "OR #"],
  date: ["Date"],
};

function parseConnectionPaymentsSheet(ws: XLSX.WorkSheet): {
  byMeter: Map<string, LinkedLine<MeterPayment>[]>;
  issues: ImportIssue[];
} {
  const byMeter = new Map<string, LinkedLine<MeterPayment>[]>();
  const issues: ImportIssue[] = [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
  if (rows.length === 0) return { byMeter, issues };

  const headerIndex = buildHeaderIndex(rows[0] as unknown[]);
  const col = Object.fromEntries(
    Object.entries(CONNECTION_PAYMENTS_COLUMNS).map(([field, aliases]) => [
      field,
      findColumn(headerIndex, aliases),
    ])
  ) as Record<keyof typeof CONNECTION_PAYMENTS_COLUMNS, number>;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    if (isBlankRow(row)) continue;
    const c = new RowCleaner(SHEET_CONNECTION_PAYMENTS, r + 1);
    const rawMeter = cell(row, col.meterNo);
    if (isHeaderText(rawMeter)) {
      issues.push(c.issue("Whole row", "skipped", "Header row repeated in the data", "Column headings, not a payment — row left out"));
      continue;
    }
    const orNumber = toStr(cell(row, col.orNumber));
    if (!toStr(rawMeter) || (!toStr(cell(row, col.amount)) && !orNumber)) {
      issues.push(c.issue("Whole row", "skipped", "Payment with no meter number, amount or receipt", "Row left out"));
      continue;
    }

    const meterNumber = c.take("Meter No", cleanMeterNo(rawMeter), "");
    const slot = c.take("Slot", cleanSlot(cell(row, col.slot)), "Full");
    const amount = c.take("Amount", cleanMoney(cell(row, col.amount)), 0);
    if (c.refusal) {
      issues.push(c.refusal);
      continue;
    }

    const date = toIsoDate(cell(row, col.date));
    const payment: MeterPayment = {
      slot,
      amount,
      orNumber,
      // Omit entirely rather than set to `undefined` — Firestore rejects that.
      ...(date ? { date } : {}),
    };
    const key = meterKey(meterNumber);
    const list = byMeter.get(key) ?? [];
    list.push({ row: r + 1, meterNumber, item: payment, changes: c.changes });
    byMeter.set(key, list);
  }

  return { byMeter, issues };
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
  /** Everything tidied, flagged or left out, in spreadsheet order. */
  issues: ImportIssue[];
}

function findSheetCaseInsensitive(wb: XLSX.WorkBook, name: string): XLSX.WorkSheet | null {
  const match = wb.SheetNames.find((n) => n.trim().toLowerCase() === name.toLowerCase());
  return match ? wb.Sheets[match] : null;
}

const SHEET_ORDER = [SHEET_CONCESSIONAIRES, SHEET_BILLING_HISTORY, SHEET_CONNECTION_PAYMENTS];

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

  const { rows, skipped, issues } = parseConcessionairesSheet(concessionairesSheet);
  const known = new Set(rows.map((r) => r.meterKey));

  /**
   * Keeps the lines whose meter belongs to an imported account, reporting the
   * changes made to them, and lists the rest — which used to vanish silently.
   */
  function link<T>(
    sheet: string,
    byMeter: Map<string, LinkedLine<T>[]>,
    what: string
  ): Map<string, T[]> {
    const linked = new Map<string, T[]>();
    byMeter.forEach((lines, key) => {
      if (known.has(key)) {
        linked.set(key, lines.map((l) => l.item));
        lines.forEach((l) => issues.push(...l.changes));
      } else {
        lines.forEach((l) =>
          issues.push({
            sheet,
            row: l.row,
            column: "Meter No",
            level: "skipped",
            kind: `${what} for a meter with no account`,
            note: `${l.meterNumber} isn't an account being imported (not in the Concessionaires sheet, or its row was left out) — row left out`,
          })
        );
      }
    });
    return linked;
  }

  let billingHistoryByMeter = new Map<string, MonthlyBillingRecord[]>();
  const billingHistorySheet = findSheetCaseInsensitive(wb, SHEET_BILLING_HISTORY);
  if (billingHistorySheet) {
    const parsed = parseBillingHistorySheet(billingHistorySheet);
    issues.push(...parsed.issues);
    billingHistoryByMeter = link(SHEET_BILLING_HISTORY, parsed.byMeter, "Bill");
  }

  let connectionPaymentsByMeter = new Map<string, MeterPayment[]>();
  const connectionPaymentsSheet = findSheetCaseInsensitive(wb, SHEET_CONNECTION_PAYMENTS);
  if (connectionPaymentsSheet) {
    const parsed = parseConnectionPaymentsSheet(connectionPaymentsSheet);
    issues.push(...parsed.issues);
    connectionPaymentsByMeter = link(SHEET_CONNECTION_PAYMENTS, parsed.byMeter, "Payment");
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

  issues.sort(
    (a, b) => SHEET_ORDER.indexOf(a.sheet) - SHEET_ORDER.indexOf(b.sheet) || a.row - b.row
  );

  return {
    sheets,
    totalConcessionaires: rows.length,
    totalSkipped: skipped,
    issues,
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
 *
 * There is deliberately no account number column: the meter number is typed
 * in from the meter, while the account number is assigned when the account is
 * created — including by the import itself — so a workbook can neither set
 * one nor change one.
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
