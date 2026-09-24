/**
 * lib/importCleaning.ts
 *
 * Turns what an office spreadsheet actually contains into what the system
 * stores, one field at a time, and says what it changed.
 *
 * The importer used to take values almost as typed: "₱1,250.00" became ₱0,
 * "Comm A" quietly became RESIDENTIAL, "DISCO" became CONNECTED, and "BOOT"
 * became a tenth barangay no route would ever download. Each cleaner here
 * returns the value to store along with every change it made, at one of two
 * levels:
 *
 *   fixed — a change there is no doubt about: capitals, a peso sign, "DISCO".
 *   check — a best guess the office should confirm: a misspelt barangay, a
 *           meter number typed without its MTR- prefix, a classification the
 *           system doesn't have.
 *
 * or, when nothing safe can be stored, a failure — the row is left out of the
 * import and listed, rather than going in wrong.
 *
 * Differences of case, spacing or punctuation alone in a coded field
 * ("Milaya", "Bo ot") are fixed without a note. They were always accepted,
 * and listing every row of an all-lowercase sheet would bury what matters.
 */

import {
  BARANGAYS,
  CONCESSIONAIRE_CLASSIFICATIONS,
  DISCONNECTED_REASONS,
  type Barangay,
  type ConcessionaireClassification,
  type ConcessionaireStatus,
  type DisconnectedReason,
} from "./firebase/types";

export type CleanLevel = "fixed" | "check";

export interface CleanChange {
  level: CleanLevel;
  /** Short, stable label the import page groups changes by. */
  kind: string;
  note?: string;
}

export type Cleaned<T> =
  | { ok: true; value: T; changes: CleanChange[]; leftover?: string }
  | { ok: false; kind: string; note: string };

const ok = <T>(value: T, changes: CleanChange[] = [], leftover?: string): Cleaned<T> =>
  leftover ? { ok: true, value, changes, leftover } : { ok: true, value, changes };
const fail = <T>(kind: string, note: string): Cleaned<T> => ({ ok: false, kind, note });

/** A cell as the office typed it, for notes. */
export function asText(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return String(raw);
}

/** Letters and digits only, in capitals — what two spellings of a code share. */
function codeKey(raw: unknown): string {
  return asText(raw).toUpperCase().replace(/[^A-Z0-9Ñ]/g, "");
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = current;
    }
  }
  return row[b.length];
}

// ── Names ──────────────────────────────────────────────────────────────────

const SUFFIXES: Record<string, string> = { JR: "Jr.", SR: "Sr.", II: "II", III: "III", IV: "IV" };
const SUFFIX_FORMS = new Set(Object.values(SUFFIXES));
const TITLES = new Set(["HADJI", "HADJA", "HAJI", "HAJJI", "BAI", "DATU"]);

function properCase(word: string): string {
  if (SUFFIX_FORMS.has(word)) return word;
  return word
    .split("-")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part))
    .join("-");
}

/**
 * A first or last name. Proper case is only applied to a name typed entirely
 * in capitals or entirely in lower case — a name in mixed case is taken to be
 * spelt the way its owner spells it.
 */
export function cleanName(raw: unknown, options: { first?: boolean } = {}): Cleaned<string> {
  const trimmed = asText(raw).trim();
  let value = trimmed.replace(/\s+/g, " ");
  const changes: CleanChange[] = [];
  if (value !== trimmed) changes.push({ level: "fixed", kind: "Extra spaces removed from a name" });

  const letters = value.replace(/[^\p{L}]/gu, "");
  if (letters.length > 1 && (letters === letters.toUpperCase() || letters === letters.toLowerCase())) {
    const proper = value.split(" ").map(properCase).join(" ");
    if (proper !== value) {
      changes.push({ level: "fixed", kind: "Name put in proper case", note: `"${value}" → "${proper}"` });
      value = proper;
    }
  }

  const suffix = value.match(/^(.*?)[\s,]+(jr|sr|ii|iii|iv)\.?$/i);
  if (suffix) {
    const rebuilt = `${suffix[1]} ${SUFFIXES[suffix[2].toUpperCase()]}`;
    if (rebuilt !== value) {
      changes.push({ level: "fixed", kind: "Name suffix written the standard way", note: `"${value}" → "${rebuilt}"` });
      value = rebuilt;
    }
  }

  const firstWord = value.split(" ")[0]?.toUpperCase() ?? "";
  if (options.first && TITLES.has(firstWord) && value.includes(" ")) {
    changes.push({
      level: "check",
      kind: "Title typed as part of a first name",
      note: `"${value.split(" ")[0]}" is a title, not a name — kept as typed; remove it if the office doesn't record titles`,
    });
  }
  return ok(value, changes);
}

/** A middle name, or a middle initial — which always carries its full stop. */
export function cleanMiddleName(raw: unknown): Cleaned<string> {
  const initial = asText(raw).trim().match(/^(\p{L})\.?$/u);
  if (initial) {
    const value = `${initial[1].toUpperCase()}.`;
    const typed = asText(raw).trim();
    return ok(
      value,
      value === typed ? [] : [{ level: "fixed", kind: "Middle initial written as a capital with a full stop", note: `"${typed}" → "${value}"` }]
    );
  }
  return cleanName(raw);
}

// ── Coded fields ─────────────────────────────────────────────────────────────

const BARANGAY_BY_KEY: Record<string, Barangay> = {
  ...Object.fromEntries(BARANGAYS.map((b) => [codeKey(b), b])),
  CEBUANOGROUP: "CG",
  CEBUANOGRP: "CG",
  CEBUANO: "CG",
};

export function cleanBarangay(raw: unknown): Cleaned<Barangay> {
  const typed = asText(raw).trim();
  const key = codeKey(typed);
  if (!key) return fail("No barangay", "The barangay is blank");

  const exact = BARANGAY_BY_KEY[key];
  if (exact) {
    return ok(
      exact,
      codeKey(exact) === key
        ? []
        : [{ level: "fixed", kind: "Barangay name changed to its code", note: `"${typed}" → ${exact}` }]
    );
  }

  // A misspelling one or two letters off. Short keys get no leeway: "CG" is
  // within two letters of almost anything.
  const leeway = key.length >= 8 ? 2 : key.length >= 5 ? 1 : 0;
  const ranked = Object.entries(BARANGAY_BY_KEY)
    .map(([k, b]) => ({ b, d: levenshtein(key, k) }))
    .sort((x, y) => x.d - y.d);
  const best = ranked[0];
  const tied = ranked.filter((r) => r.d === best.d && r.b !== best.b).length > 0;
  if (best.d <= leeway && !tied) {
    return ok(best.b, [
      { level: "check", kind: "Barangay spelling corrected", note: `Read "${typed}" as ${best.b} — check the spelling` },
    ]);
  }
  return fail("Unknown barangay", `"${typed}" isn't one of the nine barangays`);
}

const CLASSIFICATION_BY_KEY: Record<string, ConcessionaireClassification> = {
  ...Object.fromEntries(CONCESSIONAIRE_CLASSIFICATIONS.map((c) => [codeKey(c), c])),
  RES: "RESIDENTIAL",
  RESI: "RESIDENTIAL",
  RESIDENCE: "RESIDENTIAL",
  RESIDENTAL: "RESIDENTIAL",
  COMMA: "COMMERCIAL A",
  COMA: "COMMERCIAL A",
  COMMB: "COMMERCIAL B",
  COMB: "COMMERCIAL B",
  GOVT: "GOVERNMENT",
  GOV: "GOVERNMENT",
  GOVERMENT: "GOVERNMENT",
  GOVERNMENTOFFICE: "GOVERNMENT",
  GOVTOFFICE: "GOVERNMENT",
};

/**
 * An unrecognised classification still imports — as RESIDENTIAL, which is
 * what the office's older sheets relied on — but never silently: it decides
 * the rate the account is billed at.
 */
export function cleanClassification(raw: unknown): Cleaned<ConcessionaireClassification> {
  const typed = asText(raw).trim();
  const key = codeKey(typed);
  if (!key) {
    return ok("RESIDENTIAL", [
      { level: "check", kind: "Blank classification set to RESIDENTIAL", note: "Check the rate this account should pay" },
    ]);
  }
  const known = CLASSIFICATION_BY_KEY[key];
  if (known) {
    return ok(
      known,
      codeKey(known) === key
        ? []
        : [{ level: "fixed", kind: "Classification written differently", note: `"${typed}" → ${known}` }]
    );
  }
  return ok("RESIDENTIAL", [
    {
      level: "check",
      kind: "Unknown classification imported as RESIDENTIAL",
      note: `"${typed}" isn't a classification the system has — check the rate this account should pay`,
    },
  ]);
}

const STATUS_BY_KEY: Record<string, ConcessionaireStatus> = {
  CONNECTED: "CONNECTED",
  ACTIVE: "CONNECTED",
  CON: "CONNECTED",
  CONN: "CONNECTED",
  CONNECT: "CONNECTED",
  DISCONNECTED: "DISCONNECTED",
  DISCONNECT: "DISCONNECTED",
  DISCO: "DISCONNECTED",
  DISC: "DISCONNECTED",
  CUTOFF: "DISCONNECTED",
  CUT: "DISCONNECTED",
  DROPPED: "DROPPED",
  DROP: "DROPPED",
};

export function cleanStatus(raw: unknown): Cleaned<ConcessionaireStatus> {
  const typed = asText(raw).trim();
  const key = codeKey(typed);
  if (!key) {
    return ok("CONNECTED", [
      { level: "check", kind: "Blank status set to CONNECTED", note: "Check whether this line is actually connected" },
    ]);
  }
  // "DISCONNECTED - NP" and the like: a status with a note run on after it.
  const known = STATUS_BY_KEY[key] ?? (key.startsWith("DISCONNECTED") ? "DISCONNECTED" : undefined);
  if (known) {
    return ok(
      known,
      key === known ? [] : [{ level: "fixed", kind: "Status written differently", note: `"${typed}" → ${known}` }]
    );
  }
  return ok("CONNECTED", [
    {
      level: "check",
      kind: "Unknown status imported as CONNECTED",
      note: `"${typed}" isn't a status the system has — check whether this line is connected`,
    },
  ]);
}

const REASON_BY_KEY: Record<string, DisconnectedReason> = {
  ...Object.fromEntries(DISCONNECTED_REASONS.map((r) => [codeKey(r), r])),
  NONPAY: "NON-PAYMENT",
  UNPAID: "NON-PAYMENT",
  UNPAIDBILL: "NON-PAYMENT",
  UNPAIDBILLS: "NON-PAYMENT",
  NP: "NON-PAYMENT",
  VOLUNTARY: "VOLUNTARY DISCONNECTION",
  VOLUNTARYDISCO: "VOLUNTARY DISCONNECTION",
  ILLEGAL: "ILLEGAL CONNECTIONS",
  ILLEGALCONNECTION: "ILLEGAL CONNECTIONS",
  ILLEGALCONN: "ILLEGAL CONNECTIONS",
  NOCONNECTION: "NO CONNECTION YET",
  NOTYETCONNECTED: "NO CONNECTION YET",
};

/** Blank is a legitimate answer here — a connected line has no reason. */
export function cleanDisconnectedReason(raw: unknown): Cleaned<DisconnectedReason | ""> {
  const typed = asText(raw).trim();
  const key = codeKey(typed);
  if (!key) return ok("");
  const known = REASON_BY_KEY[key];
  if (known) {
    return ok(
      known,
      codeKey(known) === key
        ? []
        : [{ level: "fixed", kind: "Disconnection reason written differently", note: `"${typed}" → ${known}` }]
    );
  }
  return ok("", [
    {
      level: "check",
      kind: "Unknown disconnection reason left off",
      note: `"${typed}" isn't one of the four reasons — set the reason on the account after importing`,
    },
  ]);
}

// ── Purok and meter number ───────────────────────────────────────────────────

export function cleanPurok(raw: unknown): Cleaned<string> {
  const typed = asText(raw).trim().replace(/\s+/g, " ");
  const labelled =
    typed.match(/^(?:purok|prk)\.?\s*[-#:.]?\s*(.+)$/i) ?? typed.match(/^p\s*[-.#]?\s*(\d.*)$/i);
  if (labelled && labelled[1].trim()) {
    const value = labelled[1].trim();
    return ok(value, [{ level: "fixed", kind: "Purok label removed", note: `"${typed}" → ${value}` }]);
  }
  return ok(typed);
}

const HEADER_KEYS = new Set(["METERNO", "METERNUMBER", "METER", "ACCOUNTNO", "ACCOUNTNUMBER"]);

/** True for a Meter No cell that holds the column's own header — a header row pasted into the data. */
export function isHeaderText(raw: unknown): boolean {
  return typeof raw === "string" && HEADER_KEYS.has(codeKey(raw));
}

/**
 * Meter numbers are stored as MTR- and digits, the form the template and the
 * meters themselves use. Anything else is kept as typed, in capitals.
 */
export function cleanMeterNo(raw: unknown): Cleaned<string> {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw <= 0) return fail("Meter number that can't be read", `${raw} isn't a meter number`);
    const value = `MTR-${raw}`;
    return ok(value, [
      { level: "check", kind: "MTR- added to a meter typed as a bare number", note: `${raw} → ${value} — check it against the meter` },
    ]);
  }
  const typed = asText(raw).trim();
  if (!typed) return fail("No meter number", "The meter number is blank");
  const upper = typed.toUpperCase().replace(/\s+/g, " ");

  const mtr = upper.match(/^MTR[\s\-_.]*([0-9O]+)$/);
  if (mtr && /\d/.test(mtr[1])) {
    const value = `MTR-${mtr[1].replace(/O/g, "0")}`;
    if (mtr[1].includes("O")) {
      return ok(value, [
        { level: "check", kind: "Letter O read as zero in a meter number", note: `"${typed}" → ${value} — check it against the meter` },
      ]);
    }
    return ok(
      value,
      value === typed ? [] : [{ level: "fixed", kind: "Meter number written as MTR-000000", note: `"${typed}" → ${value}` }]
    );
  }
  if (/^\d+$/.test(upper)) {
    const value = `MTR-${upper}`;
    return ok(value, [
      { level: "check", kind: "MTR- added to a meter typed as a bare number", note: `${upper} → ${value} — check it against the meter` },
    ]);
  }
  return ok(upper, upper === typed ? [] : [{ level: "fixed", kind: "Meter number put in capitals", note: `"${typed}" → ${upper}` }]);
}

// ── Numbers ─────────────────────────────────────────────────────────────────

/**
 * An amount in pesos. Accepts what people type — "₱1,250.00", "PHP 420.50",
 * "P980", a lone dash for zero — and rounds to centavos. Refuses a negative:
 * no balance or fee is ever below zero, and an overpayment is change, not
 * credit.
 *
 * Words typed after the number ("200 (pipes)") are returned as `leftover`, so
 * a caller that has somewhere to keep them can.
 */
export function cleanMoney(raw: unknown): Cleaned<number> {
  const round = (n: number) => Math.round(n * 100) / 100;
  const rounded = (n: number, typed: string): CleanChange[] =>
    round(n) === n ? [] : [{ level: "fixed", kind: "Amount rounded to centavos", note: `${typed} → ${round(n).toFixed(2)}` }];

  if (raw === null || raw === undefined || raw === "") return ok(0);
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return fail("Amount that can't be read", `${raw} isn't an amount`);
    if (raw < 0) return fail("Negative amount", `${raw} is below zero`);
    return ok(round(raw), rounded(raw, String(raw)));
  }

  const typed = asText(raw).trim();
  if (!typed) return ok(0);
  if (/^[-–—]+$/.test(typed)) return ok(0, [{ level: "fixed", kind: "Dash read as zero", note: `"${typed}" → 0.00` }]);
  if (/^-\s*[₱P]?\s*\d/i.test(typed) || /^\(.*\)$/.test(typed)) {
    return fail("Negative amount", `"${typed}" is below zero`);
  }

  const m = typed.match(/^(?:₱|php\.?|p(?=\s*[\d.]))?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(.*)$/i);
  if (!m) return fail("Amount that can't be read", `"${typed}" isn't an amount`);

  const amount = Number(m[1].replace(/,/g, ""));
  const leftover = m[2].replace(/^[\s([{-]+|[\s)\]}.]+$/g, "");
  const changes: CleanChange[] = [];
  if (leftover) {
    changes.push({
      level: "check",
      kind: "Words dropped from an amount",
      note: `"${typed}" → ${round(amount).toFixed(2)}; "${leftover}" was left out`,
    });
  } else if (!/^\d+(?:\.\d+)?$/.test(typed)) {
    // A peso sign, "PHP" or a thousands comma — each of which the importer
    // used to read as zero.
    changes.push({ level: "fixed", kind: "Amount typed as text", note: `"${typed}" → ${round(amount).toFixed(2)}` });
  }
  changes.push(...rounded(amount, m[1]));
  return ok(round(amount), changes, leftover || undefined);
}

// ── Billing history and connection payments ─────────────────────────────────

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** A billing month, in the "JUL 2026" form every bill is keyed by. */
export function cleanMonth(raw: unknown): Cleaned<string> {
  // `same` is the typed month in capitals: "jul 2026" differs only in case,
  // which is fixed without a note like every other coded field.
  const settle = (monthIndex: number, year: number, typed: string, same: string): Cleaned<string> => {
    if (monthIndex < 0 || monthIndex > 11 || year < 1990 || year > 2100) {
      return fail("Month that can't be read", `"${typed}" isn't a month`);
    }
    const value = `${MONTHS[monthIndex]} ${year}`;
    return ok(value, value === same ? [] : [{ level: "fixed", kind: "Month written as JUL 2026", note: `"${typed}" → ${value}` }]);
  };

  // Spreadsheet date cells arrive in local time.
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return settle(raw.getMonth(), raw.getFullYear(), asText(raw), "");
  }
  const typed = asText(raw).trim();
  const s = typed.toUpperCase().replace(/\s+/g, " ");
  if (!s) return fail("Month that can't be read", "The month is blank");

  const named = s.match(/^([A-Z]{3,9})\.?[\s\-/,']*(\d{4}|\d{2})$/);
  if (named) {
    const index = MONTHS.indexOf(named[1].slice(0, 3));
    const year = named[2].length === 2 ? 2000 + Number(named[2]) : Number(named[2]);
    if (index >= 0) return settle(index, year, typed, s);
  }
  const monthFirst = s.match(/^(\d{1,2})[/\-.](\d{4})$/);
  if (monthFirst) return settle(Number(monthFirst[1]) - 1, Number(monthFirst[2]), typed, s);
  const yearFirst = s.match(/^(\d{4})[/\-.](\d{1,2})$/);
  if (yearFirst) return settle(Number(yearFirst[2]) - 1, Number(yearFirst[1]), typed, s);

  return fail("Month that can't be read", `"${typed}" isn't a month`);
}

const SLOT_BY_KEY: Record<string, string> = {
  "1ST": "1st", FIRST: "1st", "1": "1st", ONE: "1st",
  "2ND": "2nd", SECOND: "2nd", "2": "2nd", TWO: "2nd",
  "3RD": "3rd", THIRD: "3rd", "3": "3rd", THREE: "3rd",
  "4TH": "4th", FOURTH: "4th", "4": "4th", FOUR: "4th",
  FULL: "Full", FULLPAYMENT: "Full", FULLYPAID: "Full", FP: "Full",
};

/** A connection-fee installment slot. Blank means paid in full, as it always has. */
export function cleanSlot(raw: unknown): Cleaned<string> {
  const typed = asText(raw).trim();
  const key = codeKey(typed);
  if (!key) return ok("Full");
  const known = SLOT_BY_KEY[key];
  if (!known) return fail("Installment slot that can't be read", `"${typed}" isn't 1st, 2nd, 3rd, 4th or Full`);
  return ok(known, codeKey(known) === key ? [] : [{ level: "fixed", kind: "Installment slot written differently", note: `"${typed}" → ${known}` }]);
}
