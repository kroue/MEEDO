/**
 * lib/dateRange.ts
 *
 * The stretch of time a page is reporting on: a day, a week, a month, a year,
 * or everything on record.
 *
 * Ranges are half-open — `start` is included, `end` is not — so a day's
 * takings can't be counted twice by a payment landing exactly at midnight,
 * and adjacent ranges never overlap.
 *
 * Worked out on the office's calendar (the Philippines, UTC+8 all year), like
 * due dates are, so "today" means today in Wao whatever a PC's clock is set
 * to, and a week starts on Monday as the office's week does.
 */

export type RangePreset = "day" | "week" | "month" | "year" | "all";

export interface DateRange {
  /** Inclusive, epoch millis. Null for "everything on record". */
  start: number | null;
  /** Exclusive, epoch millis. Null for "up to now". */
  end: number | null;
  preset: RangePreset;
  /** How the range reads on screen: "Today", "September 2026". */
  label: string;
}

export const RANGE_PRESETS: ReadonlyArray<{ preset: RangePreset; label: string }> = [
  { preset: "day", label: "Today" },
  { preset: "week", label: "This week" },
  { preset: "month", label: "This month" },
  { preset: "year", label: "This year" },
  { preset: "all", label: "All time" },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The office's calendar date for an instant, as UTC fields on a shifted date. */
function officeDate(millis: number): Date {
  return new Date(millis + PH_OFFSET_MS);
}

/** Midnight at the start of an office day, back in real time. */
function officeMidnight(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) - PH_OFFSET_MS;
}

/** The range a preset covers around `now`. */
export function rangeFor(preset: RangePreset, now: number = Date.now()): DateRange {
  if (preset === "all") {
    return { start: null, end: null, preset, label: "All time" };
  }

  const office = officeDate(now);
  const year = office.getUTCFullYear();
  const month = office.getUTCMonth();
  const day = office.getUTCDate();

  switch (preset) {
    case "day": {
      const start = officeMidnight(year, month, day);
      return { start, end: start + MS_PER_DAY, preset, label: "Today" };
    }
    case "week": {
      // Monday to Sunday. getUTCDay() is 0 on Sunday, which belongs to the
      // week that started six days earlier, not the one starting tomorrow.
      const weekday = office.getUTCDay();
      const daysSinceMonday = (weekday + 6) % 7;
      const start = officeMidnight(year, month, day - daysSinceMonday);
      return { start, end: start + 7 * MS_PER_DAY, preset, label: "This week" };
    }
    case "month": {
      const start = officeMidnight(year, month, 1);
      const end = officeMidnight(year, month + 1, 1);
      return { start, end, preset, label: `${MONTHS[month]} ${year}` };
    }
    case "year": {
      const start = officeMidnight(year, 0, 1);
      const end = officeMidnight(year + 1, 0, 1);
      return { start, end, preset, label: String(year) };
    }
  }
}

/** True when an instant falls inside the range. */
export function withinRange(millis: number | null | undefined, range: DateRange): boolean {
  if (millis === null || millis === undefined || Number.isNaN(millis)) return false;
  if (range.start !== null && millis < range.start) return false;
  if (range.end !== null && millis >= range.end) return false;
  return true;
}

/** The same, for the ISO timestamps records are stamped with. */
export function isoWithinRange(iso: string | null | undefined, range: DateRange): boolean {
  if (!iso) return false;
  const millis = Date.parse(iso);
  return Number.isNaN(millis) ? false : withinRange(millis, range);
}

/**
 * True when a billing month — "SEP 2026", the label bills carry — falls in the
 * range. A month counts when any part of it does, so a month-long range
 * matches exactly its own month and a year matches its twelve.
 */
export function monthWithinRange(month: string | null | undefined, range: DateRange): boolean {
  if (range.start === null && range.end === null) return true;
  if (!month) return false;

  const parsed = parseBillingMonth(month);
  if (!parsed) return false;

  const monthStart = officeMidnight(parsed.year, parsed.month, 1);
  const monthEnd = officeMidnight(parsed.year, parsed.month + 1, 1);
  if (range.end !== null && monthStart >= range.end) return false;
  if (range.start !== null && monthEnd <= range.start) return false;
  return true;
}

const MONTH_ABBREVIATIONS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

/** "SEP 2026" — the form the apps write billing months in. */
export function parseBillingMonth(month: string): { year: number; month: number } | null {
  const match = /^\s*([A-Za-z]{3,})\s+(\d{4})\s*$/.exec(month);
  if (!match) return null;
  const index = MONTH_ABBREVIATIONS.indexOf(match[1].slice(0, 3).toUpperCase());
  if (index < 0) return null;
  return { year: Number(match[2]), month: index };
}
