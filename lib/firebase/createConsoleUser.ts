/**
 * lib/firebase/createConsoleUser.ts
 *
 * Admin-console accounts (admin or staff), created with a real email address —
 * unlike field-reader accounts (see createFieldReader.ts), which use a plain
 * username mapped to a synthetic email since they never sign into a browser.
 *
 * Like field readers, this runs through whichever backend is configured; see
 * accountBackend.ts.
 */

import { callFunction } from "./firebase";
import { logAuditEvent } from "./auditLog";
import { USING_ACCOUNT_FUNCTIONS } from "./accountBackend";
import {
  createConsoleAccountRecord,
  describeCallableError,
  MIN_PASSWORD_LENGTH,
} from "./createFieldReader";

export { MIN_PASSWORD_LENGTH };

export class EmailTakenError extends Error {
  constructor() {
    super("An account with that email already exists.");
    this.name = "EmailTakenError";
  }
}

export async function createConsoleUserAccount(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  role: "admin" | "staff",
  actorEmail: string
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.includes("@")) {
    throw new Error("That doesn't look like a valid email address.");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (!firstName.trim() || !lastName.trim()) {
    throw new Error("First and last name are required.");
  }

  if (USING_ACCOUNT_FUNCTIONS) {
    try {
      await callFunction("createConsoleUser", {
        email: normalizedEmail,
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role,
      });
    } catch (e) {
      const described = describeCallableError(e);
      // The shared handler words "already exists" for usernames; console
      // accounts are identified by email, so say that instead.
      if (described.name === "UsernameTakenError") throw new EmailTakenError();
      throw described;
    }
    return;
  }

  try {
    await createConsoleAccountRecord(
      normalizedEmail,
      password,
      firstName.trim(),
      lastName.trim(),
      role
    );
  } catch (e) {
    if ((e as Error).name === "UsernameTakenError") throw new EmailTakenError();
    throw e;
  }

  logAuditEvent(
    "Account Update",
    `Created ${role} console account "${normalizedEmail}" (${firstName.trim()} ${lastName.trim()}).`,
    actorEmail
  );
}
