import { describe, expect, it } from "vitest";
import { accountSorts, byNumber, byText, byTime, sortOptionFor, sortRows, thenBy, timeOf } from "./sorting";

const names = (rows: { firstName: string; lastName: string }[]) => rows.map((r) => `${r.firstName} ${r.lastName}`);

describe("comparators", () => {
  it("sorts text the way a person reads it", () => {
    const rows = ["delacruz", "Abellana", "Cañete", "Canoy", "bacus"].map((s) => ({ s }));
    expect(sortRows(rows, byText((r) => r.s)).map((r) => r.s)).toEqual([
      "Abellana",
      "bacus",
      "Cañete",
      "Canoy",
      "delacruz",
    ]);
  });

  it("puts numbers inside text in number order", () => {
    const rows = ["MTR-10", "MTR-9", "MTR-100", "MTR-2"].map((m) => ({ m }));
    expect(sortRows(rows, byText((r) => r.m)).map((r) => r.m)).toEqual(["MTR-2", "MTR-9", "MTR-10", "MTR-100"]);
  });

  it("keeps blanks last whichever way the list is turned", () => {
    const rows = [{ v: "" }, { v: "B" }, { v: undefined }, { v: "A" }];
    expect(sortRows(rows, byText((r) => r.v)).map((r) => r.v ?? "")).toEqual(["A", "B", "", ""]);
    expect(sortRows(rows, byText((r) => r.v, "desc")).map((r) => r.v ?? "")).toEqual(["B", "A", "", ""]);
    const nums = [{ n: 5 }, { n: null }, { n: 20 }];
    expect(sortRows(nums, byNumber((r) => r.n, "desc")).map((r) => r.n)).toEqual([20, 5, null]);
  });

  it("reads times in every form they arrive in", () => {
    expect(timeOf("2026-09-01T00:00:00.000Z")).toBe(Date.parse("2026-09-01T00:00:00.000Z"));
    expect(timeOf(new Date(5))).toBe(5);
    expect(timeOf({ toMillis: () => 7 })).toBe(7);
    expect(timeOf({ seconds: 2, nanoseconds: 0 })).toBe(2000);
    expect(timeOf("not a date")).toBeNull();
    const rows = [{ t: "2026-01-01" }, { t: null }, { t: "2026-06-01" }];
    expect(sortRows(rows, byTime((r) => r.t, "desc")).map((r) => r.t)).toEqual(["2026-06-01", "2026-01-01", null]);
  });

  it("falls through to the next comparison on a tie", () => {
    const rows = [
      { a: "x", b: 2 },
      { a: "x", b: 1 },
      { a: "w", b: 9 },
    ];
    expect(sortRows(rows, thenBy(byText((r) => r.a), byNumber((r) => r.b)))).toEqual([
      { a: "w", b: 9 },
      { a: "x", b: 1 },
      { a: "x", b: 2 },
    ]);
  });
});

describe("account lists", () => {
  const accounts = [
    { firstName: "Maria", lastName: "Villanueva", meterNumber: "MTR-10", barangay: "MILAYA", purok: "2", totalBalance: 0, createdAt: "2026-03-01" },
    { firstName: "Abdul", lastName: "Sarip", meterNumber: "MTR-2", barangay: "BO-OT", purok: "5", totalBalance: 1250.5, createdAt: "2026-08-01" },
    { firstName: "Juan", lastName: "Dela Cruz", meterNumber: "MTR-7", barangay: "BO-OT", purok: "1", totalBalance: 300, createdAt: "2025-12-01" },
  ];
  const sorts = accountSorts<(typeof accounts)[number]>();
  const by = (id: string) => sortRows(accounts, sortOptionFor(sorts, id).compare);

  it("opens alphabetically", () => {
    expect(sorts[0].id).toBe("name");
    expect(names(by("name"))).toEqual(["Abdul Sarip", "Juan Dela Cruz", "Maria Villanueva"]);
  });

  it("offers the alternatives", () => {
    expect(names(by("name-desc"))).toEqual(["Maria Villanueva", "Juan Dela Cruz", "Abdul Sarip"]);
    expect(names(by("last-name"))).toEqual(["Juan Dela Cruz", "Abdul Sarip", "Maria Villanueva"]);
    expect(by("meter").map((a) => a.meterNumber)).toEqual(["MTR-2", "MTR-7", "MTR-10"]);
    expect(names(by("place"))).toEqual(["Juan Dela Cruz", "Abdul Sarip", "Maria Villanueva"]);
    expect(names(by("balance"))).toEqual(["Abdul Sarip", "Juan Dela Cruz", "Maria Villanueva"]);
    expect(names(by("newest"))).toEqual(["Abdul Sarip", "Maria Villanueva", "Juan Dela Cruz"]);
  });

  it("falls back to alphabetical for a choice that no longer exists", () => {
    expect(sortOptionFor(sorts, "gone").id).toBe("name");
    expect(sortOptionFor(sorts, null).id).toBe("name");
  });
});
