import { describe, expect, it } from "vitest";
import { accountNumberBlock, formatAccountNumber, isAccountNumber } from "./accountNumber";

describe("formatAccountNumber", () => {
  it("pads the sequence so numbers line up and sort by age", () => {
    expect(formatAccountNumber(2026, 1)).toBe("2026-000001");
    expect(formatAccountNumber(2026, 42)).toBe("2026-000042");
    expect(formatAccountNumber(2026, 123456)).toBe("2026-123456");
  });

  it("keeps a sequence past the padding rather than truncating it", () => {
    expect(formatAccountNumber(2026, 1234567)).toBe("2026-1234567");
  });

  it("starts again in a new year", () => {
    expect(formatAccountNumber(2027, 1)).toBe("2027-000001");
  });
});

describe("isAccountNumber", () => {
  it("recognises our own numbers, so search can tell them from a meter number", () => {
    expect(isAccountNumber("2026-000042")).toBe(true);
    expect(isAccountNumber("  2026-000042 ")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isAccountNumber("MTR-1001")).toBe(false);
    expect(isAccountNumber("2026")).toBe(false);
    expect(isAccountNumber("")).toBe(false);
  });
});

describe("accountNumberBlock", () => {
  it("hands out consecutive numbers after the last one used", () => {
    expect(accountNumberBlock(2026, 40, 3)).toEqual(["2026-000041", "2026-000042", "2026-000043"]);
  });

  it("starts at one on a fresh year", () => {
    expect(accountNumberBlock(2026, 0, 2)).toEqual(["2026-000001", "2026-000002"]);
  });

  it("returns nothing when nothing is being created", () => {
    expect(accountNumberBlock(2026, 40, 0)).toEqual([]);
    expect(accountNumberBlock(2026, 40, -5)).toEqual([]);
  });
});
