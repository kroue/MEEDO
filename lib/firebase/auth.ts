/**
 * lib/firebase/auth.ts
 *
 * Admin console login — email/password only. There is no self-service
 * sign-up: accounts are created by an existing admin from the Team page.
 *
 * The mobile field-reader app shares this same Firebase Auth user pool, so
 * a successful sign-in alone isn't enough to grant console access —
 * `login()` also checks the account's `users/{uid}.role`, and signs back
 * out (with NotAuthorizedError) unless it's "admin" or "staff". The two
 * console roles differ in what they can reach once signed in (see the
 * route/nav gating in app-shell.tsx and sidebar.tsx) — `login()` itself
 * just returns which one it was so the caller can act on it immediately
 * without a second round-trip.
 */

import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updatePassword,
  type User,
  type Unsubscribe,
} from "firebase/auth";
import { auth, clearLocalRecords } from "./firebase";
import { fetchUserRole } from "./users";
import { logAuditEvent } from "./auditLog";

export class NotAuthorizedError extends Error {
  constructor() {
    super(
      "This account can't sign in to the admin console — it either has no role assigned or has " +
        "been disabled. Ask an admin to check it."
    );
    this.name = "NotAuthorizedError";
  }
}

export function subscribeToAuthState(
  onChange: (user: User | null) => void
): Unsubscribe {
  return onAuthStateChanged(auth, onChange);
}

export async function login(email: string, password: string): Promise<"admin" | "staff"> {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const role = await fetchUserRole(credential.user.uid);
  if (role !== "admin" && role !== "staff") {
    await firebaseSignOut(auth);
    throw new NotAuthorizedError();
  }
  logAuditEvent("Login", `${email} signed in to the admin console (${role}).`, email);
  return role;
}

/**
 * Signs out and clears the records this browser cached during the session.
 * Follow it with a full page load — see clearLocalRecords.
 */
export async function logout(): Promise<void> {
  await firebaseSignOut(auth);
  await clearLocalRecords();
}

/** Best-effort display name for the session — falls back to the email local-part. */
export function displayNameFor(user: User): string {
  if (user.displayName) return user.displayName;
  if (user.email) return user.email.split("@")[0];
  return "Admin";
}

export class WrongPasswordError extends Error {
  constructor() {
    super("That isn't your current password.");
    this.name = "WrongPasswordError";
  }
}

/**
 * Changes the signed-in person's own password.
 *
 * The current password is required and checked first. Sign-in alone is not
 * enough: a session left open at a counter is exactly the situation where
 * someone else would change the password and take the account.
 */
export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
  minLength: number
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.email) {
    throw new Error("Your session has expired. Sign in again and retry.");
  }
  if (newPassword.length < minLength) {
    throw new Error(`The new password must be at least ${minLength} characters.`);
  }
  if (newPassword === currentPassword) {
    throw new Error("The new password is the same as the current one.");
  }

  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "";
    if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
      throw new WrongPasswordError();
    }
    throw e;
  }

  await updatePassword(user, newPassword);
  logAuditEvent("Account Update", "Changed their own password.", user.email);
}
