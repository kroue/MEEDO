"use client";

/**
 * lib/usePreferences.ts
 *
 * Reads this PC's settings into React.
 *
 * Through an external store rather than an effect, for two reasons: the server
 * render has no browser storage to read, so it needs a defined answer to
 * render (the defaults) rather than a flash of one value replaced by another;
 * and changing a setting should reach every open list at once, including a
 * second tab, rather than only the page that changed it.
 */

import { useSyncExternalStore } from "react";
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  loadPreferences,
  savePreferences,
  type ConsolePreferences,
} from "./preferences";

const listeners = new Set<() => void>();

/**
 * useSyncExternalStore compares snapshots by identity, so the parsed
 * preferences are cached and only replaced when they actually change.
 */
let snapshot: ConsolePreferences | null = null;

function getSnapshot(): ConsolePreferences {
  if (!snapshot) snapshot = loadPreferences();
  return snapshot;
}

function getServerSnapshot(): ConsolePreferences {
  return DEFAULT_PREFERENCES;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changing a setting fires this; same-tab changes come through
  // updatePreferences below, which storage events deliberately don't fire for.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== PREFERENCES_KEY) return;
    snapshot = null;
    listeners.forEach((l) => l());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePreferences(): ConsolePreferences {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Saves a change and tells every list about it. */
export function updatePreferences(changes: Partial<ConsolePreferences>): ConsolePreferences {
  const next = { ...getSnapshot(), ...changes };
  savePreferences(next);
  snapshot = next;
  listeners.forEach((listener) => listener());
  return next;
}
