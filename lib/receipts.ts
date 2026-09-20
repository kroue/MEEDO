/**
 * lib/receipts.ts
 *
 * Official Receipt numbers.
 *
 * The office does not invent these. Each OR is pre-printed in the booklet the
 * treasury issues against the Business Tax listing, so whoever takes the cash
 * copies the number off the receipt they just wrote. Nothing here generates
 * one; this only checks that what was typed can be stored and found again.
 *
 * A payment is stored under its OR number, which is also the document's id —
 * so the same rules a document id must satisfy apply, and two payments can
 * never share a number.
 */

export const OR_NUMBER_MAX_LENGTH = 40;

/** Upper-cased, with runs of whitespace collapsed to one space. */
export function normalizeOrNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Why the typed number can't be used, or null when it's fine. The message is
 * shown to whoever is at the counter, so it says what to do about it.
 */
export function orNumberProblem(raw: string): string | null {
  const value = normalizeOrNumber(raw);
  if (!value) return "Enter the OR number from the receipt.";
  if (value.length > OR_NUMBER_MAX_LENGTH) {
    return `An OR number can be at most ${OR_NUMBER_MAX_LENGTH} characters.`;
  }
  if (!/^[A-Z0-9][A-Z0-9 \-_#]*$/.test(value)) {
    return "An OR number can use letters, numbers, spaces, hyphens, underscores and #.";
  }
  return null;
}

export class InvalidOrNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOrNumberError";
  }
}

export class DuplicateOrNumberError extends Error {
  constructor(orNumber: string) {
    super(`OR ${orNumber} has already been used on another payment.`);
    this.name = "DuplicateOrNumberError";
  }
}

/** Normalizes and validates in one step, throwing [InvalidOrNumberError]. */
export function requireOrNumber(raw: string): string {
  const problem = orNumberProblem(raw);
  if (problem) throw new InvalidOrNumberError(problem);
  return normalizeOrNumber(raw);
}
