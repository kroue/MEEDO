import { describe, expect, it } from "vitest";
import {
  InvalidOrNumberError,
  normalizeOrNumber,
  orNumberProblem,
  requireOrNumber,
} from "./receipts";

describe("normalizeOrNumber", () => {
  it("upper-cases and tidies spacing so the same receipt is stored one way", () => {
    expect(normalizeOrNumber("  or 2026-0041  ")).toBe("OR 2026-0041");
    expect(normalizeOrNumber("ar\t\t7781")).toBe("AR 7781");
  });
});

describe("orNumberProblem", () => {
  it("accepts the shapes a treasury booklet actually uses", () => {
    ["1234567", "OR-2026-000042", "AR 7781", "BT#4410", "or_2026_11"].forEach((value) =>
      expect(orNumberProblem(value)).toBeNull()
    );
  });

  it("asks for a number when nothing was typed", () => {
    expect(orNumberProblem("   ")).toMatch(/enter the or number/i);
  });

  it("refuses characters that can't be stored as a record id", () => {
    expect(orNumberProblem("2026/0041")).toMatch(/letters, numbers/i);
    expect(orNumberProblem("..")).toMatch(/letters, numbers/i);
    expect(orNumberProblem("-1234")).toMatch(/letters, numbers/i);
  });

  it("refuses one longer than the field allows", () => {
    expect(orNumberProblem("A".repeat(41))).toMatch(/at most 40/i);
  });
});

describe("requireOrNumber", () => {
  it("returns the stored form", () => {
    expect(requireOrNumber(" or-2026-7 ")).toBe("OR-2026-7");
  });

  it("throws with the counter-facing message", () => {
    expect(() => requireOrNumber("")).toThrow(InvalidOrNumberError);
    expect(() => requireOrNumber("a/b")).toThrow(/letters, numbers/i);
  });
});
