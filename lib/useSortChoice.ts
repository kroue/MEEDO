"use client";

/**
 * Which order each list is in, remembered on this PC — so a cashier who
 * prefers last names doesn't have to pick it again every visit. Per list, not
 * shared across the console: meter-number order suits Connections and makes
 * no sense for the audit log.
 *
 * Stored like the other per-PC preferences (lib/preferences.ts): a missing or
 * blocked localStorage just means every list opens in its default order.
 */

import { useCallback, useSyncExternalStore } from "react";
import { sortOptionFor, type SortOption } from "./sorting";

const KEY = "meedo:sort-choices";
const EMPTY: Record<string, string> = {};

let snapshot: Record<string, string> | null = null;
const listeners = new Set<() => void>();

function load(): Record<string, string> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

function getSnapshot(): Record<string, string> {
  if (snapshot === null) snapshot = load();
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSortChoice<T>(listId: string, options: SortOption<T>[]) {
  const choices = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  const option = sortOptionFor(options, choices[listId]);

  const setSort = useCallback(
    (id: string) => {
      snapshot = { ...getSnapshot(), [listId]: id };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(snapshot));
      } catch {
        // Storage blocked: the choice holds until the page is left.
      }
      listeners.forEach((listener) => listener());
    },
    [listId]
  );

  return { option, setSort };
}
