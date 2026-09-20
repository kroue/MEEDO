import { describe, expect, it } from "vitest";
import { userMessage } from "./userMessage";

/** Shaped like the SDK's own errors, without importing the SDK into a unit test. */
function sdkError(code: string, message: string): Error {
  const e = new Error(message) as Error & { code: string };
  e.name = "FirebaseError";
  e.code = code;
  return e;
}

describe("userMessage", () => {
  it("passes our own error messages through unchanged", () => {
    expect(userMessage(new Error("Enter a valid payment amount."), "Failed.")).toBe(
      "Enter a valid payment amount."
    );
  });

  it("maps database error codes to plain wording", () => {
    expect(userMessage(sdkError("permission-denied", "Missing or insufficient permissions."))).toBe(
      "You don't have permission to do that."
    );
    expect(
      userMessage(sdkError("unavailable", "Failed to get document because the client is offline."))
    ).toMatch(/can't reach the server/i);
  });

  it("maps prefixed sign-in and server codes the same way", () => {
    expect(
      userMessage(sdkError("auth/network-request-failed", "Firebase: Error (auth/network-request-failed)."))
    ).toMatch(/can't reach the server/i);
    expect(userMessage(sdkError("functions/unauthenticated", "unauthenticated"))).toMatch(
      /session has expired/i
    );
  });

  it("never shows an unmapped SDK message, which names the vendor or links its console", () => {
    const missingIndex = sdkError(
      "failed-precondition",
      "The query requires an index. You can create it here: https://console.firebase.google.com/..."
    );
    expect(userMessage(missingIndex, "Couldn't load bills.")).toBe("Couldn't load bills.");
    expect(userMessage(sdkError("auth/internal-error", "Firebase: Error (auth/internal-error)."), "Failed.")).toBe(
      "Failed."
    );
  });

  it("hides vendor names even on errors that aren't SDK-shaped", () => {
    expect(userMessage(new Error("Firestore write failed"), "Couldn't save.")).toBe("Couldn't save.");
  });

  it("falls back when there is nothing usable to show", () => {
    expect(userMessage(undefined, "Failed.")).toBe("Failed.");
    expect(userMessage(new Error(""), "Failed.")).toBe("Failed.");
    expect(userMessage({})).toBe("Something went wrong. Please try again.");
  });

  it("accepts a bare string", () => {
    expect(userMessage("Meter number is required.")).toBe("Meter number is required.");
  });
});
