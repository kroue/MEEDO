import { describe, expect, it } from "vitest";
import { BARANGAY_DUE_DAYS, daysPastDue, dueDateFor, dueDayFor, formatDueDate } from "./dueDates";

/** An instant given as Philippine wall-clock time. */
function ph(year: number, month: number, day: number, hour = 9, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour - 8, minute);
}

/** The end of a day, Philippine time. */
function endOfDayPh(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day, 23 - 8, 59, 59, 999);
}

describe("dueDayFor", () => {
  it("knows each barangay's day", () => {
    expect(dueDayFor("BO-OT")).toBe(17);
    expect(dueDayFor("CG")).toBe(19);
    expect(dueDayFor("KABATANGAN")).toBe(21);
    expect(dueDayFor("KATUTUNGAN")).toBe(23);
    expect(dueDayFor("PAGALONGAN")).toBe(25);
    expect(dueDayFor("MILAYA")).toBe(26);
  });

  it("accepts the full name and loose spellings", () => {
    expect(dueDayFor("Cebuano Group")).toBe(19);
    expect(dueDayFor("Bo-ot")).toBe(17);
    expect(dueDayFor(" boot ")).toBe(17);
    expect(dueDayFor("milaya")).toBe(26);
  });

  it("has nothing for a barangay without a set day", () => {
    expect(dueDayFor("SALVACION")).toBeNull();
    expect(dueDayFor("AMOYONG")).toBeNull();
    expect(dueDayFor("DIOMIL")).toBeNull();
    expect(dueDayFor("")).toBeNull();
    expect(dueDayFor(undefined)).toBeNull();
  });

  it("covers exactly the six barangays the office gave", () => {
    expect(Object.keys(BARANGAY_DUE_DAYS).sort()).toEqual(
      ["BO-OT", "CG", "KABATANGAN", "KATUTUNGAN", "MILAYA", "PAGALONGAN"].sort()
    );
  });
});

describe("dueDateFor", () => {
  it("is this month's day when the bill is issued before it", () => {
    expect(dueDateFor("BO-OT", ph(2026, 9, 5))).toBe(endOfDayPh(2026, 9, 17));
    expect(dueDateFor("MILAYA", ph(2026, 9, 1))).toBe(endOfDayPh(2026, 9, 26));
  });

  it("is still this month's day when the bill is issued on the day itself", () => {
    expect(dueDateFor("BO-OT", ph(2026, 9, 17, 16))).toBe(endOfDayPh(2026, 9, 17));
  });

  it("rolls to next month's day once this month's has passed", () => {
    expect(dueDateFor("BO-OT", ph(2026, 9, 18))).toBe(endOfDayPh(2026, 10, 17));
    expect(dueDateFor("CG", ph(2026, 9, 21))).toBe(endOfDayPh(2026, 10, 19));
  });

  it("rolls over the end of the year", () => {
    expect(dueDateFor("MILAYA", ph(2026, 12, 27))).toBe(endOfDayPh(2027, 1, 26));
  });

  it("goes by the office's calendar, not the machine's clock", () => {
    // 04:00 on 18 September in the Philippines is still the 17th in UTC —
    // but the office's 17th has passed, so the bill is due in October.
    const earlyMorning = ph(2026, 9, 18, 4);
    expect(new Date(earlyMorning).getUTCDate()).toBe(17);
    expect(dueDateFor("BO-OT", earlyMorning)).toBe(endOfDayPh(2026, 10, 17));
  });

  it("keeps fifteen days after billing for a barangay without a set day", () => {
    const billed = ph(2026, 9, 5);
    expect(dueDateFor("SALVACION", billed)).toBe(billed + 15 * 24 * 60 * 60 * 1000);
    expect(dueDateFor(null, billed)).toBe(billed + 15 * 24 * 60 * 60 * 1000);
  });
});

describe("formatDueDate", () => {
  it("writes the office's calendar date", () => {
    expect(formatDueDate(endOfDayPh(2026, 10, 17))).toBe("17 October 2026");
    expect(formatDueDate(endOfDayPh(2026, 10, 17), { short: true })).toBe("17 Oct 2026");
  });
});

describe("daysPastDue", () => {
  const due = endOfDayPh(2026, 10, 17);

  it("is nothing on or before the due day", () => {
    expect(daysPastDue(due, ph(2026, 10, 10))).toBeNull();
    expect(daysPastDue(due, ph(2026, 10, 17, 22))).toBeNull();
  });

  it("counts from the end of the due day", () => {
    expect(daysPastDue(due, ph(2026, 10, 18, 8))).toBe(1);
    expect(daysPastDue(due, ph(2026, 10, 20, 8))).toBe(3);
  });
});
