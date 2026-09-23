import { describe, expect, it } from "vitest";
import {
  isoWithinRange,
  monthWithinRange,
  parseBillingMonth,
  rangeFor,
  withinRange,
} from "./dateRange";

/** An instant given as Philippine wall-clock time. */
function ph(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour - 8, minute);
}

describe("rangeFor", () => {
  // Thursday, 17 September 2026, 14:30 in the Philippines.
  const now = ph(2026, 9, 17, 14, 30);

  it("covers the office's day, midnight to midnight", () => {
    const range = rangeFor("day", now);
    expect(range.start).toBe(ph(2026, 9, 17, 0));
    expect(range.end).toBe(ph(2026, 9, 18, 0));
    expect(range.label).toBe("Today");
  });

  it("starts the week on Monday", () => {
    const range = rangeFor("week", now);
    expect(range.start).toBe(ph(2026, 9, 14, 0)); // the Monday
    expect(range.end).toBe(ph(2026, 9, 21, 0));
  });

  it("keeps Sunday in the week that began the Monday before", () => {
    const sunday = ph(2026, 9, 20, 9);
    expect(rangeFor("week", sunday).start).toBe(ph(2026, 9, 14, 0));
  });

  it("covers the calendar month and names it", () => {
    const range = rangeFor("month", now);
    expect(range.start).toBe(ph(2026, 9, 1, 0));
    expect(range.end).toBe(ph(2026, 10, 1, 0));
    expect(range.label).toBe("September 2026");
  });

  it("covers the calendar year", () => {
    const range = rangeFor("year", now);
    expect(range.start).toBe(ph(2026, 1, 1, 0));
    expect(range.end).toBe(ph(2027, 1, 1, 0));
    expect(range.label).toBe("2026");
  });

  it("is open at both ends for all time", () => {
    expect(rangeFor("all", now)).toMatchObject({ start: null, end: null });
  });

  it("goes by the office's calendar, not the machine's clock", () => {
    // 01:00 on the 18th in the Philippines is still the 17th in UTC.
    const earlyMorning = ph(2026, 9, 18, 1);
    expect(new Date(earlyMorning).getUTCDate()).toBe(17);
    expect(rangeFor("day", earlyMorning).start).toBe(ph(2026, 9, 18, 0));
  });
});

describe("withinRange", () => {
  const today = rangeFor("day", ph(2026, 9, 17, 14));

  it("includes the first moment and excludes the last", () => {
    expect(withinRange(ph(2026, 9, 17, 0), today)).toBe(true);
    expect(withinRange(ph(2026, 9, 17, 23, 59), today)).toBe(true);
    expect(withinRange(ph(2026, 9, 18, 0), today)).toBe(false);
    expect(withinRange(ph(2026, 9, 16, 23, 59), today)).toBe(false);
  });

  it("takes everything when the range is all time", () => {
    const all = rangeFor("all");
    expect(withinRange(0, all)).toBe(true);
    expect(withinRange(ph(2030, 1, 1), all)).toBe(true);
  });

  it("has nothing to say about a missing date", () => {
    expect(withinRange(null, today)).toBe(false);
    expect(isoWithinRange(undefined, today)).toBe(false);
    expect(isoWithinRange("not a date", today)).toBe(false);
  });

  it("reads the ISO stamps records carry", () => {
    expect(isoWithinRange(new Date(ph(2026, 9, 17, 8)).toISOString(), today)).toBe(true);
    expect(isoWithinRange(new Date(ph(2026, 9, 19, 8)).toISOString(), today)).toBe(false);
  });
});

describe("monthWithinRange", () => {
  const september = rangeFor("month", ph(2026, 9, 17));
  const year = rangeFor("year", ph(2026, 9, 17));

  it("matches a billing month against the month it falls in", () => {
    expect(monthWithinRange("SEP 2026", september)).toBe(true);
    expect(monthWithinRange("AUG 2026", september)).toBe(false);
    expect(monthWithinRange("OCT 2026", september)).toBe(false);
  });

  it("matches every month of a year", () => {
    expect(monthWithinRange("JAN 2026", year)).toBe(true);
    expect(monthWithinRange("DEC 2026", year)).toBe(true);
    expect(monthWithinRange("DEC 2025", year)).toBe(false);
  });

  it("counts a month that merely overlaps the range", () => {
    const today = rangeFor("day", ph(2026, 9, 17));
    expect(monthWithinRange("SEP 2026", today)).toBe(true);
  });

  it("keeps everything for all time, and drops what it can't read", () => {
    expect(monthWithinRange("SEP 2026", rangeFor("all"))).toBe(true);
    expect(monthWithinRange("", september)).toBe(false);
    expect(monthWithinRange("LAST MONTH", september)).toBe(false);
  });
});

describe("parseBillingMonth", () => {
  it("reads the form the apps write", () => {
    expect(parseBillingMonth("SEP 2026")).toEqual({ year: 2026, month: 8 });
    expect(parseBillingMonth("September 2026")).toEqual({ year: 2026, month: 8 });
    expect(parseBillingMonth(" jan 2027 ")).toEqual({ year: 2027, month: 0 });
  });

  it("refuses anything else", () => {
    expect(parseBillingMonth("2026-09")).toBeNull();
    expect(parseBillingMonth("XXX 2026")).toBeNull();
  });
});
