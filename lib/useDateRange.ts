"use client";

/**
 * lib/useDateRange.ts
 *
 * Holds the period a page is reporting on: one of the presets, or two dates
 * picked off a calendar.
 *
 * One hook for both the dashboard and the reports page so the two can't drift
 * into meaning different things by "this month".
 */

import { useMemo, useState } from "react";
import { customRange, rangeFor, type DateRange, type RangePreset } from "./dateRange";

export interface DateRangeState {
  preset: RangePreset;
  setPreset: (preset: RangePreset) => void;
  /** "YYYY-MM-DD", as a date input gives them. Empty until picked. */
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  range: DateRange;
  /** True when the figures cover everything on record — the cheap path. */
  wholeArchive: boolean;
}

export function useDateRange(initial: RangePreset = "all"): DateRangeState {
  const [preset, setPreset] = useState<RangePreset>(initial);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const range = useMemo(
    () => (preset === "custom" ? customRange(from, to) : rangeFor(preset)),
    [preset, from, to]
  );

  // A custom range with neither date chosen yet covers everything, so the
  // pages keep using their cheaper all-time figures until one is picked.
  const wholeArchive = range.start === null && range.end === null;

  return { preset, setPreset, from, to, setFrom, setTo, range, wholeArchive };
}
