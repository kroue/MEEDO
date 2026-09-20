import { describe, expect, it } from "vitest";
import { clampPage, pageCount, pageRange, pageSlice, pageWindow } from "./pagination";

const rows = Array.from({ length: 312 }, (_, i) => i + 1);

describe("pageCount", () => {
  it("counts the pages a list needs", () => {
    expect(pageCount(312, 25)).toBe(13);
    expect(pageCount(25, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
  });

  it("keeps page 1 even with nothing to show", () => {
    expect(pageCount(0, 25)).toBe(1);
  });
});

describe("clampPage", () => {
  it("holds the page inside the list", () => {
    expect(clampPage(9, 2)).toBe(2);
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(-3, 5)).toBe(1);
  });

  it("survives a nonsense page", () => {
    expect(clampPage(Number.NaN, 5)).toBe(1);
  });
});

describe("pageSlice", () => {
  it("returns the rows for the page asked for", () => {
    expect(pageSlice(rows, 1, 25)[0]).toBe(1);
    expect(pageSlice(rows, 2, 25)[0]).toBe(26);
    expect(pageSlice(rows, 2, 25)).toHaveLength(25);
  });

  it("gives a short last page rather than padding it", () => {
    expect(pageSlice(rows, 13, 25)).toHaveLength(12);
  });

  it("shows the last page when the list shrank under you", () => {
    expect(pageSlice([1, 2, 3], 9, 25)).toEqual([1, 2, 3]);
  });
});

describe("pageRange", () => {
  it("reads as the row numbers on screen", () => {
    expect(pageRange(1, 25, 312)).toEqual({ from: 1, to: 25 });
    expect(pageRange(2, 25, 312)).toEqual({ from: 26, to: 50 });
    expect(pageRange(13, 25, 312)).toEqual({ from: 301, to: 312 });
  });

  it("says nothing rather than 1 to 0 for an empty list", () => {
    expect(pageRange(1, 25, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe("pageWindow", () => {
  it("lists every page while they fit", () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps the first and last page reachable from the middle", () => {
    const window = pageWindow(8, 40);
    expect(window[0]).toBe(1);
    expect(window[window.length - 1]).toBe(40);
    expect(window).toContain(8);
    expect(window).toContain(null);
  });

  it("does not open a gap next to the ends", () => {
    expect(pageWindow(2, 40)).toEqual([1, 2, 3, null, 40]);
    expect(pageWindow(39, 40)).toEqual([1, null, 38, 39, 40]);
  });

  it("never draws more buttons than asked for", () => {
    for (const page of [1, 5, 20, 40]) {
      expect(pageWindow(page, 40, 7).length).toBeLessThanOrEqual(7);
    }
  });
});
