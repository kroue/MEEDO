/**
 * lib/pagination.ts
 *
 * Paging for the lists the console renders.
 *
 * The rows are already in memory — a barangay's accounts, a month's bills, the
 * audit log — so this is about how many are put on screen at once, not about
 * fetching. A thousand table rows makes a page slow to render and impossible
 * to find anything in.
 *
 * The page number is clamped rather than corrected: filtering a list down to
 * two pages while sitting on page nine shows page two, without a round trip
 * through state that would re-render everything twice.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [25, 50, 100];

/** Pages needed for `total` rows, always at least one so page 1 exists. */
export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

export function clampPage(page: number, pages: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.trunc(page), 1), Math.max(pages, 1));
}

export function pageSlice<T>(items: T[], page: number, pageSize: number): T[] {
  if (pageSize <= 0) return items;
  const start = (clampPage(page, pageCount(items.length, pageSize)) - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

/**
 * The "Showing 26–50 of 312" numbers, 1-based and inclusive. An empty list
 * reads as 0 to 0 rather than 1 to 0.
 */
export function pageRange(
  page: number,
  pageSize: number,
  total: number
): { from: number; to: number } {
  if (total === 0 || pageSize <= 0) return { from: 0, to: 0 };
  const current = clampPage(page, pageCount(total, pageSize));
  const from = (current - 1) * pageSize + 1;
  return { from, to: Math.min(current * pageSize, total) };
}

/**
 * Page buttons to draw, with `null` where a run was left out: e.g.
 * 1 … 6 7 [8] 9 10 … 40. Always includes the first and last page, so the ends
 * of a long list stay one click away.
 */
export function pageWindow(page: number, pages: number, maxButtons = 7): (number | null)[] {
  if (pages <= maxButtons) return Array.from({ length: pages }, (_, i) => i + 1);

  const current = clampPage(page, pages);
  const neighbours = Math.max(1, Math.floor((maxButtons - 5) / 2));
  const start = Math.max(2, current - neighbours);
  const end = Math.min(pages - 1, current + neighbours);

  const window: (number | null)[] = [1];
  if (start > 2) window.push(null);
  for (let p = start; p <= end; p++) window.push(p);
  if (end < pages - 1) window.push(null);
  window.push(pages);
  return window;
}
