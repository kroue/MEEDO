/**
 * lib/preferences.ts
 *
 * The handful of choices the Settings page offers, kept in this browser.
 *
 * Deliberately per-machine rather than per-account: these are about how this
 * PC is used — the counter machine wants the barangay it serves and short
 * pages, the office machine wants long ones — and following someone from one
 * PC to another would be the wrong behaviour, not a feature.
 *
 * Nothing here affects what anything means. Anything that would — the fees,
 * the grace period, who may approve what — belongs in the code and the
 * security rules, where it is reviewed, not in a box someone can tick.
 */

export const ROWS_PER_PAGE_OPTIONS = [25, 50, 100];

export interface ConsolePreferences {
  /** Rows a list shows before paging. */
  rowsPerPage: number;
  /** Barangay the Concessionaires page opens on; empty means ask each time. */
  startingBarangay: string;
}

export const DEFAULT_PREFERENCES: ConsolePreferences = {
  rowsPerPage: 25,
  startingBarangay: "",
};

export const PREFERENCES_KEY = "meedo:preferences";

/**
 * Reads whatever was stored back into a usable shape.
 *
 * Storage is a shared, editable place — an older version of the console, a
 * half-written value, someone's console session — so every field is checked
 * rather than trusted, and anything unrecognised falls back to the default.
 */
export function normalizePreferences(raw: unknown): ConsolePreferences {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFERENCES };
  const value = raw as Partial<Record<keyof ConsolePreferences, unknown>>;

  const rowsPerPage = Number(value.rowsPerPage);
  const startingBarangay = value.startingBarangay;

  return {
    rowsPerPage: ROWS_PER_PAGE_OPTIONS.includes(rowsPerPage)
      ? rowsPerPage
      : DEFAULT_PREFERENCES.rowsPerPage,
    startingBarangay:
      typeof startingBarangay === "string" ? startingBarangay : DEFAULT_PREFERENCES.startingBarangay,
  };
}

export function loadPreferences(): ConsolePreferences {
  try {
    return normalizePreferences(JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? "null"));
  } catch {
    // No storage, or nothing stored: the defaults are a working console.
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences: ConsolePreferences): void {
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Storage blocked or full: the choice holds for this session and no longer.
  }
}
