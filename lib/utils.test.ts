import { describe, expect, it } from "vitest";
import { formatCompact, formatCompactPeso, getFullName } from "./utils";

describe("formatCompact", () => {
  it("shows small numbers as themselves — a consumption axis is tens of m³", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(45)).toBe("45");
    expect(formatCompact(450)).toBe("450");
    expect(formatCompact(999)).toBe("999");
  });

  it("keeps one decimal where the value is under ten", () => {
    expect(formatCompact(7.5)).toBe("7.5");
    expect(formatCompact(0.4)).toBe("0.4");
  });

  it("switches to k only once the value is in the thousands", () => {
    expect(formatCompact(1000)).toBe("1k");
    expect(formatCompact(1250)).toBe("1.3k");
    expect(formatCompact(16668.4)).toBe("16.7k");
  });

  it("switches to M in the millions", () => {
    expect(formatCompact(1_000_000)).toBe("1M");
    expect(formatCompact(2_450_000)).toBe("2.5M");
  });

  it("keeps the sign on a negative", () => {
    expect(formatCompact(-1500)).toBe("-1.5k");
  });

  it("never collapses a whole axis to the same label", () => {
    const ticks = [0, 100, 200, 300, 400].map(formatCompact);
    expect(new Set(ticks).size).toBe(ticks.length);
  });
});

describe("formatCompactPeso", () => {
  it("prefixes the peso sign", () => {
    expect(formatCompactPeso(450)).toBe("₱450");
    expect(formatCompactPeso(3688.12)).toBe("₱3.7k");
  });
});

describe("getFullName", () => {
  it("joins the parts that are there", () => {
    expect(getFullName({ firstName: "Juan", middleName: "Santos", lastName: "Dela Cruz" })).toBe(
      "Juan Santos Dela Cruz"
    );
    expect(getFullName({ firstName: "Maria", lastName: "Reyes" })).toBe("Maria Reyes");
  });

  it("falls back to a single stored name", () => {
    expect(getFullName({ name: "Barangay Health Station" })).toBe("Barangay Health Station");
  });
});
