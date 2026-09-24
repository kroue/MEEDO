/**
 * lib/sorting.ts
 *
 * The orders a list can be put in. Lists of people and accounts open
 * alphabetically and offer the same handful of alternatives, built from the
 * comparators here — so "Name (A–Z)" means the same thing on every page.
 *
 * Text is compared the way a person reads it rather than by character code:
 * case and accents are ignored (Cañete sits with Canete), and numbers inside
 * text go in number order (MTR-9 before MTR-10). Blank values always go last,
 * whichever way a list is turned.
 */

import { getFullName } from "./utils";

export type Compare<T> = (a: T, b: T) => number;

export interface SortOption<T> {
  id: string;
  label: string;
  compare: Compare<T>;
}

type Direction = "asc" | "desc";

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Missing values go last in either direction; present values follow `direction`. */
function withBlanksLast<V>(
  a: V | null,
  b: V | null,
  compare: (x: V, y: V) => number,
  direction: Direction
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const c = compare(a, b);
  return direction === "asc" ? c : -c;
}

export function byText<T>(get: (row: T) => string | null | undefined, direction: Direction = "asc"): Compare<T> {
  const value = (row: T) => {
    const s = (get(row) ?? "").trim();
    return s ? s : null;
  };
  return (a, b) => withBlanksLast(value(a), value(b), collator.compare, direction);
}

export function byNumber<T>(get: (row: T) => number | null | undefined, direction: Direction = "asc"): Compare<T> {
  const value = (row: T) => {
    const n = get(row);
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  };
  return (a, b) => withBlanksLast(value(a), value(b), (x, y) => x - y, direction);
}

/**
 * Milliseconds for whatever form a time arrives in: an ISO string, a Date,
 * epoch millis, or a database timestamp still in its stored form.
 */
export function timeOf(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === "string") {
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  }
  if (typeof v === "object") {
    const ts = v as { toMillis?: () => number; seconds?: number };
    if (typeof ts.toMillis === "function") return ts.toMillis();
    if (typeof ts.seconds === "number") return ts.seconds * 1000;
  }
  return null;
}

export function byTime<T>(get: (row: T) => unknown, direction: Direction = "asc"): Compare<T> {
  return (a, b) => withBlanksLast(timeOf(get(a)), timeOf(get(b)), (x, y) => x - y, direction);
}

/** The first comparison that tells two rows apart. */
export function thenBy<T>(...compares: Compare<T>[]): Compare<T> {
  return (a, b) => {
    for (const compare of compares) {
      const c = compare(a, b);
      if (c !== 0) return c;
    }
    return 0;
  };
}

/** A sorted copy; the original list is left as it was. */
export function sortRows<T>(rows: readonly T[], compare: Compare<T>): T[] {
  return [...rows].sort(compare);
}

// ── People and accounts ──────────────────────────────────────────────────────

interface NamedAccount {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  meterNumber?: string;
  accountNumber?: string;
  barangay?: string;
  purok?: string;
  totalBalance?: number;
  createdAt?: unknown;
}

const fullName = <T extends NamedAccount>(c: T) => getFullName(c);

/** The orders every list of concessionaires offers. Alphabetical comes first — it is the default. */
export function accountSorts<T extends NamedAccount>(): SortOption<T>[] {
  const meter = byText<T>((c) => c.meterNumber);
  return [
    { id: "name", label: "Name (A–Z)", compare: thenBy(byText(fullName), meter) },
    { id: "name-desc", label: "Name (Z–A)", compare: thenBy(byText(fullName, "desc"), meter) },
    {
      id: "last-name",
      label: "Last name (A–Z)",
      compare: thenBy(byText((c) => c.lastName), byText((c) => c.firstName), meter),
    },
    { id: "meter", label: "Meter number", compare: meter },
    { id: "account", label: "Account number", compare: thenBy(byText((c) => c.accountNumber), meter) },
    {
      id: "place",
      label: "Barangay, then purok",
      compare: thenBy(byText((c) => c.barangay), byText((c) => c.purok), byText(fullName)),
    },
    {
      id: "balance",
      label: "Balance (highest first)",
      compare: thenBy(byNumber((c) => c.totalBalance, "desc"), byText(fullName)),
    },
    { id: "newest", label: "Newest accounts first", compare: thenBy(byTime((c) => c.createdAt, "desc"), byText(fullName)) },
  ];
}

/** The option with `id`, or the first — the default — when there's no such option. */
export function sortOptionFor<T>(options: SortOption<T>[], id: string | null | undefined): SortOption<T> {
  return options.find((o) => o.id === id) ?? options[0];
}
