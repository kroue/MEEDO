/**
 * lib/firebase/users.ts
 *
 * Per-account role lookup. Both the admin console and the mobile field-reader
 * app authenticate against the same Firebase Auth user pool, so a role alone
 * (not just "is this a valid login") is what keeps a field-reader account out
 * of the admin console and vice versa. Set up by the developers alongside
 * the Auth account itself: a `users/{uid}` document with a `role` field.
 *
 * Field-reader accounts additionally carry `assignedBarangays` — the set of
 * Barangays the admin has handed that reader for the current billing cycle.
 * The reader's device picks which one to work on first; this collection is
 * how the admin pushes/recalls that list per person instead of per device.
 */

import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { logAuditEvent } from "./auditLog";

export type UserRole = "admin" | "staff" | "field_reader";

/**
 * Null if no role document exists yet, its `role` field isn't recognized, or
 * the account has been disabled.
 *
 * Treating a disabled account as having no role is what makes revocation work
 * without the Admin SDK: the console's AuthGate bounces it straight back to
 * the login screen, and the Firestore rules independently refuse every read and
 * write. Both checks matter — the rules are the boundary that actually holds,
 * this one is what makes the app behave sensibly rather than erroring
 * everywhere.
 */
export async function fetchUserRole(uid: string): Promise<UserRole | null> {
  const snapshot = await getDoc(doc(db, "users", uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (data?.disabled === true) return null;
  const role = data?.role;
  return role === "admin" || role === "staff" || role === "field_reader" ? role : null;
}

export interface FieldReaderUser {
  uid: string;
  username: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  assignedBarangays: string[];
  assignedMonthStr: string | null;
  /** True when the Auth account has been disabled — see setAccountDisabled. */
  disabled: boolean;
}

/** Realtime list of every field-reader account, for the Mobile Sync page's per-reader Barangay assignment. */
export function subscribeToFieldReaderUsers(
  onData: (users: FieldReaderUser[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const readersQuery = query(
    collection(db, "users"),
    where("role", "==", "field_reader")
  );
  return onSnapshot(
    readersQuery,
    (snapshot) => {
      onData(
        snapshot.docs.map((d) => {
          const data = d.data();
          return {
            uid: d.id,
            username: (data.username as string | undefined) ?? d.id,
            firstName: (data.firstName as string | undefined) ?? "",
            lastName: (data.lastName as string | undefined) ?? "",
            phoneNumber: (data.phoneNumber as string | undefined) ?? "",
            assignedBarangays: (data.assignedBarangays as string[] | undefined) ?? [],
            assignedMonthStr: (data.assignedMonthStr as string | undefined) ?? null,
            disabled: (data.disabled as boolean | undefined) ?? false,
          };
        })
      );
    },
    onError
  );
}

/** Replaces a field reader's assigned Barangay list for the given billing month. */
export async function setAssignedBarangays(
  uid: string,
  barangays: string[],
  monthStr: string,
  actorEmail: string
): Promise<void> {
  await setDoc(
    doc(db, "users", uid),
    { assignedBarangays: barangays, assignedMonthStr: monthStr },
    { merge: true }
  );
  logAuditEvent(
    "Data Sync",
    `Set field reader ${uid}'s assigned Barangays to [${barangays.join(", ") || "none"}] for ${monthStr}.`,
    actorEmail
  );
}

/** Updates a field reader's profile details (name/phone) — not their username or password. */
export async function updateFieldReaderDetails(
  uid: string,
  details: { firstName: string; lastName: string; phoneNumber: string },
  actorEmail: string
): Promise<void> {
  await setDoc(doc(db, "users", uid), details, { merge: true });
  logAuditEvent(
    "Account Update",
    `Updated field reader ${uid}'s details to ${details.firstName} ${details.lastName} (${details.phoneNumber || "no phone"}).`,
    actorEmail
  );
}

// ── Admin console accounts (admin / staff) ──────────────────────────────────
//
// Distinct from field readers: these sign into the admin console itself
// with a real email address (not a plain username), and are split into two
// permission levels — "admin" (full access) and "staff" (concessionaire
// lookup, printing SOAs/receipts, and accepting both connection and water
// bill payments — see the route/nav gating in app-shell.tsx and sidebar.tsx).

export interface ConsoleUser {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  role: "admin" | "staff";
  /** True when the Auth account has been disabled — see setAccountDisabled. */
  disabled: boolean;
}

/** Realtime list of every admin-console account (admin + staff), for the Team page. */
export function subscribeToConsoleUsers(
  onData: (users: ConsoleUser[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const consoleUsersQuery = query(collection(db, "users"), where("role", "in", ["admin", "staff"]));
  return onSnapshot(
    consoleUsersQuery,
    (snapshot) => {
      onData(
        snapshot.docs.map((d) => {
          const data = d.data();
          return {
            uid: d.id,
            email: (data.email as string | undefined) ?? "",
            firstName: (data.firstName as string | undefined) ?? "",
            lastName: (data.lastName as string | undefined) ?? "",
            role: (data.role as "admin" | "staff" | undefined) ?? "staff",
            disabled: (data.disabled as boolean | undefined) ?? false,
          };
        })
      );
    },
    onError
  );
}

/** Updates a console account's name/role — not its email or password. */
export async function updateConsoleUserDetails(
  uid: string,
  details: { firstName: string; lastName: string; role: "admin" | "staff" },
  actorEmail: string
): Promise<void> {
  await setDoc(doc(db, "users", uid), details, { merge: true });
  logAuditEvent(
    "Account Update",
    `Updated console account ${uid} to ${details.firstName} ${details.lastName} (${details.role}).`,
    actorEmail
  );
}
