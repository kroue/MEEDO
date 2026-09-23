"use client";

/**
 * The period a page is reporting on. Labelled, like every other filter in the
 * console, so nobody has to work out what the box does.
 */

import { RANGE_PRESETS, type DateRange, type RangePreset } from "@/lib/dateRange";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function DateRangeFilter({
  value,
  onChange,
  range,
  label = "Period",
  className,
}: {
  value: RangePreset;
  onChange: (preset: RangePreset) => void;
  /** Shown under the box, so "This month" says which month it worked out to. */
  range?: DateRange;
  label?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </label>
      <Select value={value} onValueChange={(v) => v && onChange(v as RangePreset)}>
        <SelectTrigger className="h-9 w-[160px] text-sm">
          <SelectValue>
            {(current) =>
              RANGE_PRESETS.find((p) => p.preset === current)?.label ?? "All time"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {RANGE_PRESETS.map((option) => (
            <SelectItem key={option.preset} value={option.preset}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {range && range.preset !== "all" && range.label !== labelOf(range.preset) && (
        <p className="mt-1 text-[11px] text-slate-500">{range.label}</p>
      )}
    </div>
  );
}

function labelOf(preset: RangePreset): string {
  return RANGE_PRESETS.find((p) => p.preset === preset)?.label ?? "";
}
