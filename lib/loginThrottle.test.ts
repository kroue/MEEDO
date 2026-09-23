import { describe, expect, it } from "vitest";
import {
  ATTEMPTS_BEFORE_COOLDOWN,
  EMPTY_RECORD,
  FAILURE_MEMORY_MS,
  FIRST_COOLDOWN_MS,
  MAX_COOLDOWN_MS,
  afterFailure,
  afterSuccess,
  describeWait,
  waitRemaining,
} from "./loginThrottle";

const NOW = Date.parse("2026-09-23T08:00:00.000Z");

/** Fails `count` times, a second apart, starting at `from`. */
function failTimes(count: number, from: number = NOW) {
  let record = EMPTY_RECORD;
  for (let i = 0; i < count; i += 1) record = afterFailure(record, from + i * 1000);
  return record;
}

describe("afterFailure", () => {
  it("lets the first few mistypes through without a wait", () => {
    const record = failTimes(ATTEMPTS_BEFORE_COOLDOWN - 1);
    expect(waitRemaining(record, NOW)).toBe(0);
  });

  it("starts a wait once the run is reached", () => {
    const record = failTimes(ATTEMPTS_BEFORE_COOLDOWN);
    const last = NOW + (ATTEMPTS_BEFORE_COOLDOWN - 1) * 1000;
    expect(waitRemaining(record, last)).toBe(FIRST_COOLDOWN_MS);
  });

  it("doubles the wait for each further run", () => {
    let record = failTimes(ATTEMPTS_BEFORE_COOLDOWN * 2);
    const last = NOW + (ATTEMPTS_BEFORE_COOLDOWN * 2 - 1) * 1000;
    expect(waitRemaining(record, last)).toBe(FIRST_COOLDOWN_MS * 2);

    record = failTimes(ATTEMPTS_BEFORE_COOLDOWN * 3);
    expect(waitRemaining(record, NOW + (ATTEMPTS_BEFORE_COOLDOWN * 3 - 1) * 1000)).toBe(
      FIRST_COOLDOWN_MS * 4
    );
  });

  it("never waits longer than the cap", () => {
    const record = failTimes(ATTEMPTS_BEFORE_COOLDOWN * 10);
    const last = NOW + (ATTEMPTS_BEFORE_COOLDOWN * 10 - 1) * 1000;
    expect(waitRemaining(record, last)).toBe(MAX_COOLDOWN_MS);
  });

  it("forgets failures that are old enough not to be a pattern", () => {
    const old = failTimes(ATTEMPTS_BEFORE_COOLDOWN - 1);
    // Past the memory window for every one of them, not just the first.
    const muchLater = NOW + FAILURE_MEMORY_MS + 10_000;
    const next = afterFailure(old, muchLater);
    expect(next.failures).toHaveLength(1);
    expect(waitRemaining(next, muchLater)).toBe(0);
  });

  it("stops waiting once the time is up", () => {
    const record = failTimes(ATTEMPTS_BEFORE_COOLDOWN);
    expect(waitRemaining(record, NOW + FIRST_COOLDOWN_MS + 10_000)).toBe(0);
  });
});

describe("afterSuccess", () => {
  it("clears the slate", () => {
    expect(afterSuccess()).toEqual(EMPTY_RECORD);
    expect(waitRemaining(afterSuccess(), NOW)).toBe(0);
  });
});

describe("describeWait", () => {
  it("says it in units someone can act on", () => {
    expect(describeWait(1_000)).toBe("1 second");
    expect(describeWait(45_000)).toBe("45 seconds");
    expect(describeWait(60_000)).toBe("1 minute");
    expect(describeWait(90_000)).toBe("2 minutes");
  });
});
