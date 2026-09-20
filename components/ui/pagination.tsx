"use client";

/**
 * components/ui/pagination.tsx
 *
 * The paging control the console's lists share, plus the hook that holds the
 * page for them.
 *
 * Rows are paged in memory: every one of these lists is already loaded, so
 * this decides how many are drawn, not what is fetched.
 */

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  clampPage,
  pageCount,
  pageRange,
  pageSlice,
  pageWindow,
} from "@/lib/pagination";
import { cn } from "@/lib/utils";

export interface Paged<T> {
  /** The rows for the current page. */
  rows: T[];
  page: number;
  pages: number;
  pageSize: number;
  total: number;
  from: number;
  to: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

/**
 * Pages a list that is already in memory.
 *
 * The page is clamped as it is read rather than corrected afterwards, so
 * filtering a long list down while on a later page simply shows the last page
 * instead of an empty one.
 */
export function usePagination<T>(items: T[], pageSize = DEFAULT_PAGE_SIZE): Paged<T> {
  const [size, setPageSize] = useState(pageSize);
  const [requestedPage, setPage] = useState(1);

  const total = items.length;
  const pages = pageCount(total, size);
  const page = clampPage(requestedPage, pages);
  const rows = useMemo(() => pageSlice(items, page, size), [items, page, size]);
  const { from, to } = pageRange(page, size, total);

  return { rows, page, pages, pageSize: size, total, from, to, setPage, setPageSize };
}

function PageButton({
  children,
  active,
  disabled,
  label,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-semibold transition-colors",
        active
          ? "border-sky-200 bg-sky-50 text-sky-700"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
        disabled && "pointer-events-none opacity-40"
      )}
    >
      {children}
    </button>
  );
}

/**
 * Renders as nothing while everything fits on one page and the list is short
 * — a table of six rows doesn't need telling it has six rows.
 */
export function Pagination<T>({
  paged,
  noun = "rows",
  className,
}: {
  paged: Paged<T>;
  /** What the rows are, for "Showing 1–25 of 312 accounts". */
  noun?: string;
  className?: string;
}) {
  const { page, pages, pageSize, total, from, to, setPage, setPageSize } = paged;
  if (pages <= 1 && total <= DEFAULT_PAGE_SIZE) return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-t border-slate-200/60 px-1 pt-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <p className="text-xs text-slate-500">
          Showing <span className="font-semibold text-slate-700">{from.toLocaleString()}</span>–
          <span className="font-semibold text-slate-700">{to.toLocaleString()}</span> of{" "}
          <span className="font-semibold text-slate-700">{total.toLocaleString()}</span> {noun}
        </p>
        <select
          aria-label="Rows per page"
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600"
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option} per page
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1">
        <PageButton label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </PageButton>

        {pageWindow(page, pages).map((entry, i) =>
          entry === null ? (
            <span key={`gap-${i}`} className="px-1 text-xs text-slate-400">
              …
            </span>
          ) : (
            <PageButton
              key={entry}
              label={`Page ${entry}`}
              active={entry === page}
              onClick={() => setPage(entry)}
            >
              {entry}
            </PageButton>
          )
        )}

        <PageButton label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          <ChevronRight className="h-3.5 w-3.5" />
        </PageButton>
      </div>
    </div>
  );
}
