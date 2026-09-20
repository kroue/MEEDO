/**
 * lib/userMessage.ts
 *
 * The text to show a person when something fails.
 *
 * Errors thrown by our own code are already plain sentences written for the
 * people using the console, and pass through unchanged. Errors raised by the
 * database or sign-in SDKs are not: they carry codes like "permission-denied",
 * name the vendor ("Firebase: Error (auth/...)"), and sometimes link to its
 * developer console. None of that means anything at a cashier's counter, so
 * those are mapped to plain wording, and anything unrecognised falls back to
 * the caller's own message for what was being attempted.
 */

const DEFAULT_FALLBACK = "Something went wrong. Please try again.";

const OFFLINE = "Can't reach the server right now. Check your internet connection and try again.";

/** SDK error codes, with the "auth/", "functions/" or "firestore/" prefix removed. */
const CODE_MESSAGES: Record<string, string> = {
  "permission-denied": "You don't have permission to do that.",
  unauthenticated: "Your session has expired. Sign in again and retry.",
  unavailable: OFFLINE,
  "network-request-failed": OFFLINE,
  "deadline-exceeded": "The server took too long to respond. Please try again.",
  "resource-exhausted": "The system is busy right now. Please wait a moment and try again.",
  "too-many-requests": "Too many attempts. Please wait a moment and try again.",
  "not-found": "That record no longer exists. Refresh the page and try again.",
  aborted: "Someone else changed this record at the same time. Please try again.",
  cancelled: "The request was cancelled. Please try again.",
  "requires-recent-login": "For your security, sign out and sign in again, then retry.",
  "user-disabled": "This account has been disabled.",
  "user-token-expired": "Your session has expired. Sign in again and retry.",
};

/** Text that gives away the backend, whatever the error object looks like. */
const VENDOR_TEXT = /firebase|firestore|googleapis|cloud function|gcloud/i;

export function userMessage(error: unknown, fallback: string = DEFAULT_FALLBACK): string {
  if (error === null || error === undefined) return fallback;

  const { code, message, name } = error as { code?: unknown; message?: unknown; name?: unknown };

  if (typeof code === "string") {
    const mapped = CODE_MESSAGES[code.replace(/^(auth|functions|firestore)\//, "")];
    if (mapped) return mapped;
  }

  const text = typeof error === "string" ? error : message;
  if (typeof text !== "string" || text.trim() === "") return fallback;

  // Any other SDK error: its message is written for developers, not for staff.
  if (name === "FirebaseError" || VENDOR_TEXT.test(text)) return fallback;

  return text;
}
