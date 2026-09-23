"use client";

/**
 * The period a page is reporting on. Labelled, like every other filter in the
 * console, so nobody has to work out what the box does.
 *
 * "Custom range" opens two date boxes; each is a plain date input, so tapping
 * one gets the browser's own calendar rather than a hand-rolled one.
 */

import { RANGE_PRESETS, type RangePreset } from "@/lib/dateRange";
import type { DateRangeState } from "@/lib/useDateRange";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function DateRangeFilter({
  state,
  label = "Period",
  className,
}: {
  state: DateRangeState;
  label?: string;
  className?: string;
}) {
  const { preset, setPreset, from, to, setFrom, setTo, range } = state;
  const showsWorkedOutDates = preset !== "all" && range.label !== presetLabel(preset);

  return (
    // Relative, because the worked-out dates below hang out of the flow: in it
    // they would make this block taller than the box beside it and drag
    // whatever is aligned with it out of line.
    <div className={`relative ${className ?? ""}`}>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={preset} onValueChange={(v) => v && setPreset(v as RangePreset)}>
          <SelectTrigger className="h-9 w-[160px] text-sm">
            <SelectValue>{(current) => presetLabel(current as RangePreset)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {RANGE_PRESETS.map((option) => (
              <SelectItem key={option.preset} value={option.preset}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="From date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus-visible:ring-1 focus-visible:ring-sky-500"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              aria-label="To date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus-visible:ring-1 focus-visible:ring-sky-500"
            />
          </div>
        )}
      </div>
      {showsWorkedOutDates && (
        <p className="absolute left-0 top-full mt-1 text-[11px] text-slate-500">{range.label}</p>
      )}
    </div>
  );
}

function presetLabel(preset: RangePreset): string {
  return RANGE_PRESETS.find((p) => p.preset === preset)?.label ?? "All time";
}
