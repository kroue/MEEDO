/**
 * lib/dueDates.ts
 *
 * When a bill has to be paid by.
 *
 * Each barangay pays on its own fixed day of the month, so collections are
 * spread across the second half of the month rather than landing on the
 * counter all at once. A bill is due on its barangay's next such day: this
 * month's if it hasn't passed yet when the bill is issued, otherwise next
 * month's. A barangay without a set day keeps the old rule of fifteen days
 * after billing.
 *
 * This decides only the date printed on the bill. The 3% surcharge, the ₱10
 * extension fee and disconnection still run from when the balance went from
 * zero to owing, under the fifteen-day grace period in lib/billing.ts.
 *
 * The field reader app computes the same thing in DueDates.kt, and the two must
 * agree — a bill issued at the counter and one issued at the meter have to name
 * the same day.
 */

/** The day of the month each barangay's bills fall due. */
export const BARANGAY_DUE_DAYS: Readonly<Record<string, number>> = {
  "BO-OT": 17,
  CG: 19,
  KABATANGAN: 21,
  KATUTUNGAN: 23,
  PAGALONGAN: 25,
  MILAYA: 26,
};

/** For a barangay with no set day: days after billing, as before. */
export const DEFAULT_DUE_AFTER_DAYS = 15;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The Philippines is UTC+8 all year, with no daylight saving. Dates are worked
 * out on the office's calendar, not the machine's: a PC or phone with its
 * clock set to another zone must still put a bill due on the same day.
 */
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Spellings the same barangay turns up under — the code, or its full name. */
const ALIASES: Readonly<Record<string, string>> = {
  BOOT: "BO-OT",
  CG: "CG",
  CEBUANOGROUP: "CG",
  KABATANGAN: "KABATANGAN",
  KATUTUNGAN: "KATUTUNGAN",
  PAGALONGAN: "PAGALONGAN",
  MILAYA: "MILAYA",
};

/** The barangay's due day, or null if it has none. */
export function dueDayFor(barangay: string | null | undefined): number | null {
  const key = (barangay ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const code = ALIASES[key];
  return code ? BARANGAY_DUE_DAYS[code] : null;
}

/**
 * When a bill issued at `billedAt` must be paid by: the last moment of its due
 * day, office time, so "on or before the 17th" holds for all of the 17th.
 *
 * A bill issued on the due day itself is due that same day — the day hasn't
 * passed yet.
 */
export function dueDateFor(
  barangay: string | null | undefined,
  billedAt: number,
  defaultDays: number = DEFAULT_DUE_AFTER_DAYS
): number {
  const dueDay = dueDayFor(barangay);
  if (dueDay === null) return billedAt + defaultDays * MS_PER_DAY;

  // Read the office's calendar date by shifting into its zone and using UTC
  // fields, which no local timezone setting can disturb.
  const office = new Date(billedAt + PH_OFFSET_MS);
  const year = office.getUTCFullYear();
  const month = office.getUTCMonth();
  const day = office.getUTCDate();

  const dueMonth = day <= dueDay ? month : month + 1;
  // Every due day is under 29 today, but a later one shouldn't overflow a
  // short month into the next.
  const daysInDueMonth = new Date(Date.UTC(year, dueMonth + 1, 0)).getUTCDate();
  const dueOn = Math.min(dueDay, daysInDueMonth);

  return Date.UTC(year, dueMonth, dueOn, 23, 59, 59, 999) - PH_OFFSET_MS;
}

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

/**
 * A due date as the office writes it — "17 October 2026", or "17 Oct 2026"
 * where space is tight. Always on the office's calendar, like the date itself.
 */
export function formatDueDate(millis: number, { short = false }: { short?: boolean } = {}): string {
  const office = new Date(millis + PH_OFFSET_MS);
  const month = MONTHS[office.getUTCMonth()];
  return `${office.getUTCDate()} ${short ? month.slice(0, 3) : month} ${office.getUTCFullYear()}`;
}

/**
 * Whole days a bill has gone past its due date, or null if it isn't past due
 * yet. Counted from the end of the due day, so the day after is one day late.
 */
export function daysPastDue(dueDateMillis: number, now: number = Date.now()): number | null {
  if (now <= dueDateMillis) return null;
  return Math.max(1, Math.ceil((now - dueDateMillis) / MS_PER_DAY));
}
