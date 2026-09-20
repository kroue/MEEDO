import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, normalizePreferences } from "./preferences";

describe("normalizePreferences", () => {
  it("keeps values the console offers", () => {
    expect(normalizePreferences({ rowsPerPage: 100, startingBarangay: "BO-OT" })).toEqual({
      rowsPerPage: 100,
      startingBarangay: "BO-OT",
    });
  });

  it("falls back on a page size that isn't offered", () => {
    expect(normalizePreferences({ rowsPerPage: 7 }).rowsPerPage).toBe(DEFAULT_PREFERENCES.rowsPerPage);
    expect(normalizePreferences({ rowsPerPage: -1 }).rowsPerPage).toBe(DEFAULT_PREFERENCES.rowsPerPage);
  });

  it("accepts a page size stored as text, as older versions wrote it", () => {
    expect(normalizePreferences({ rowsPerPage: "50" }).rowsPerPage).toBe(50);
  });

  it("ignores a barangay that isn't text", () => {
    expect(normalizePreferences({ startingBarangay: 42 }).startingBarangay).toBe("");
  });

  it("returns the defaults for anything that isn't settings at all", () => {
    expect(normalizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences("nonsense")).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences([])).toEqual(DEFAULT_PREFERENCES);
  });

  it("never hands back the shared default object to be mutated", () => {
    const first = normalizePreferences(null);
    first.rowsPerPage = 100;
    expect(DEFAULT_PREFERENCES.rowsPerPage).toBe(25);
  });
});
