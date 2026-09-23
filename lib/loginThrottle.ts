/**
 * lib/loginThrottle.ts
 *
 * Slows down repeated failed sign-ins from this browser.
 *
 * The backend rate-limits sign-ins of its own accord, but not before a console
 * left open at the counter has taken a few hundred guesses at a colleague's
 * password. After a handful of failures this browser refuses to try again for
 * a while, and says how long — each further run of failures waits longer.
 *
 * Kept per username so one person mistyping their password doesn't lock out
 * the next person to use the PC, and in this browser only: it is a speed bump
 * for someone at the keyboard, not a security control. What actually protects
 * the data is the security rules.
 */

/** Failures allowed before the first wait. */
export const ATTEMPTS_BEFORE_COOLDOWN = 5;

/** How long the first cooldown lasts; it doubles with each further run. */
export const FIRST_COOLDOWN_MS = 60_000;

export const MAX_COOLDOWN_MS = 15 * 60_000;

/** Failures older than this are forgotten — a mistyped password last week is not a pattern. */
export const FAILURE_MEMORY_MS = 30 * 60_000;

export interface AttemptRecord {
  /** When each recent failure happened, oldest first. */
  failures: number[];
  /** Nothing may be tried again until this moment. */
  blockedUntil: number;
}

export const EMPTY_RECORD: AttemptRecord = { failures: [], blockedUntil: 0 };

/** Drops failures old enough to be irrelevant. */
function recent(record: AttemptRecord, now: number): number[] {
  return record.failures.filter((at) => now - at < FAILURE_MEMORY_MS);
}

/** How long this username must wait before trying again, in ms. 0 when it may. */
export function waitRemaining(record: AttemptRecord, now: number): number {
  return Math.max(0, record.blockedUntil - now);
}

/**
 * The record after another failed attempt. Every [ATTEMPTS_BEFORE_COOLDOWN]
 * failures starts a wait, each twice the last, up to [MAX_COOLDOWN_MS].
 */
export function afterFailure(record: AttemptRecord, now: number): AttemptRecord {
  const failures = [...recent(record, now), now];
  const runs = Math.floor(failures.length / ATTEMPTS_BEFORE_COOLDOWN);
  if (runs === 0 || failures.length % ATTEMPTS_BEFORE_COOLDOWN !== 0) {
    return { failures, blockedUntil: record.blockedUntil };
  }
  const wait = Math.min(FIRST_COOLDOWN_MS * 2 ** (runs - 1), MAX_COOLDOWN_MS);
  return { failures, blockedUntil: now + wait };
}

/** A successful sign-in clears the slate for that username. */
export function afterSuccess(): AttemptRecord {
  return EMPTY_RECORD;
}

/** "in 45 seconds", "in 2 minutes" — for telling someone how long to wait. */
export function describeWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

// ── This browser's memory of it ──────────────────────────────────────────────

const STORAGE_KEY = "meedo:sign-in-attempts";

type Store = Record<string, AttemptRecord>;

function readStore(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage blocked or full: the throttle simply doesn't apply.
  }
}

function keyFor(username: string): string {
  return username.trim().toLowerCase();
}

export function recordFor(username: string): AttemptRecord {
  return readStore()[keyFor(username)] ?? EMPTY_RECORD;
}

export function recordFailure(username: string, now: number = Date.now()): AttemptRecord {
  const store = readStore();
  const next = afterFailure(store[keyFor(username)] ?? EMPTY_RECORD, now);
  store[keyFor(username)] = next;
  writeStore(store);
  return next;
}

export function clearFailures(username: string): void {
  const store = readStore();
  delete store[keyFor(username)];
  writeStore(store);
}
