"use client";

/**
 * The "Sort by" control every list uses. Labelled like the other filters, so
 * it reads as part of the same toolbar rather than a stray dropdown.
 */

import { ArrowUpDown } from "lucide-react";
import type { SortOption } from "@/lib/sorting";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function SortSelect<T>({
  options,
  value,
  onChange,
  label = "Sort by",
  hideLabel = false,
  size = "default",
  className,
}: {
  options: SortOption<T>[];
  value: SortOption<T>;
  onChange: (id: string) => void;
  label?: string;
  /** For toolbars whose other controls carry no visible label either. */
  hideLabel?: boolean;
  size?: "sm" | "default";
  className?: string;
}) {
  return (
    <div className={className}>
      {!hideLabel && (
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
      )}
      <Select value={value.id} onValueChange={(id) => id && onChange(id)}>
        <SelectTrigger
          aria-label={label}
          className={`${size === "sm" ? "h-8 text-xs" : "h-9 text-sm"} w-full min-w-[190px] bg-white border-slate-200`}
        >
          <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <SelectValue>{() => value.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id} className="text-sm">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
