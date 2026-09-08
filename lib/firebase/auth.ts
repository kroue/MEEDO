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
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
  type Unsubscribe,
} from "firebase/auth";
import { auth } from "./firebase";
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

export async function logout(): Promise<void> {
  await firebaseSignOut(auth);
}

/** Best-effort display name for the session — falls back to the email local-part. */
export function displayNameFor(user: User): string {
  if (user.displayName) return user.displayName;
  if (user.email) return user.email.split("@")[0];
  return "Admin";
}
