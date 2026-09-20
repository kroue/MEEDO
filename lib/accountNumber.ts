/**
 * lib/accountNumber.ts
 *
 * The account number the office quotes.
 *
 * Distinct from the meter number, which is stamped on the hardware and typed
 * in by hand: a meter gets replaced, and a household can be moved onto another
 * one, but the account it belongs to stays the same. So this is assigned by
 * the system and never edited.
 *
 * Shape is "2026-000042": the year it was opened, then a sequence that starts
 * again each January. Sorting by it puts accounts in the order they were
 * opened, and the year makes a number unique for good.
 */

export const ACCOUNT_NUMBER_DIGITS = 6;

export function formatAccountNumber(year: number, sequence: number): string {
  return `${year}-${String(sequence).padStart(ACCOUNT_NUMBER_DIGITS, "0")}`;
}

/** Whether `value` looks like one of ours, for search and validation. */
export function isAccountNumber(value: string): boolean {
  return /^\d{4}-\d{4,}$/.test(value.trim());
}

/**
 * The numbers a batch of new accounts gets, given where the counter stood.
 *
 * `lastNumber` is the highest already handed out for `year`; an import asks
 * for as many as it has rows so the whole batch can be written at once.
 */
export function accountNumberBlock(year: number, lastNumber: number, count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) =>
    formatAccountNumber(year, lastNumber + i + 1)
  );
}
