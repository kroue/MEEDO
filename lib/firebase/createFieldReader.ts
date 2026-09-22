/**
 * lib/firebase/createFieldReader.ts
 *
 * Mobile field-reader accounts. Readers log in with a plain username, not an
 * email — it's mapped to a synthetic "username@meedo.local" address, since
 * Firebase Auth's email/password provider needs an email shape, but neither
 * the admin nor the reader ever sees that.
 *
 * Two implementations sit behind these functions; see accountBackend.ts for
 * which one is active and why. The call sites don't care.
 */

import { userMessage } from "../userMessage";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from "firebase/auth";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { db, auth, callFunction, firebaseConfig } from "./firebase";
import { logAuditEvent } from "./auditLog";
import { ACCOUNT_CAPABILITIES, USING_ACCOUNT_FUNCTIONS } from "./accountBackend";

export const MOBILE_USERNAME_DOMAIN = "meedo.local";

/**
 * Our own policy, not Firebase's — Firebase would accept six. These accounts
 * unlock write access to the district's billing records, on devices that leave
 * the office.
 */
export const MIN_PASSWORD_LENGTH = 10;

const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;

export class UsernameTakenError extends Error {
  constructor() {
    super("That username is already taken.");
    this.name = "UsernameTakenError";
  }
}

export class InvalidUsernameError extends Error {
  constructor() {
    super(
      "Username must be 3-30 characters: lowercase letters, numbers, dot, underscore, or hyphen only."
    );
    this.name = "InvalidUsernameError";
  }
}

export class UnsupportedOnThisBackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedOnThisBackendError";
  }
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

function usernameToEmail(username: string): string {
  return `${username}@${MOBILE_USERNAME_DOMAIN}`;
}

/** Turns a Cloud Function error into the message the admin should actually see. */
export function describeCallableError(e: unknown): Error {
  const code = (e as { code?: string })?.code;
  const message = (e as { message?: string })?.message;
  if (code === "functions/already-exists") return new UsernameTakenError();
  if (code === "functions/permission-denied") {
    return new Error("Only an admin can create or change accounts.");
  }
  if (code === "functions/unauthenticated") {
    return new Error("Your session expired. Sign in again and retry.");
  }
  // Named precisely rather than shown as a generic failure: the fix is a
  // deployment step, not anything the person clicking the button did wrong.
  if (code === "functions/not-found" || code === "functions/unavailable") {
    return new Error("Account management isn't available right now. Contact your system administrator.");
  }
  if (code === "functions/invalid-argument" && message) return new Error(message);
  if (code === "functions/failed-precondition" && message) return new Error(message);
  return new Error(userMessage(e));
}

/** Maps a Firebase Auth error from the client path onto our own error types. */
function describeAuthError(e: unknown): Error {
  const code = (e as { code?: string })?.code;
  if (code === "auth/email-already-in-use") return new UsernameTakenError();
  if (code === "auth/weak-password") {
    return new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (code === "auth/invalid-email") return new InvalidUsernameError();
  if (code === "auth/operation-not-allowed") {
    return new Error("New accounts can't be created right now. Contact your system administrator.");
  }
  return new Error(userMessage(e, "Failed to create the account."));
}

/**
 * Creates an Auth user without disturbing the admin's own session, and writes
 * its role document.
 *
 * The account is created on a throwaway secondary Firebase app because
 * `createUserWithEmailAndPassword` signs in as the new account on whichever app
 * instance it's called on — doing that on the primary app would sign the admin
 * out of their own console mid-task.
 *
 * The role document is written with the PRIMARY app's Firestore handle, i.e. as
 * the admin, which is what the security rules require. If that write fails the
 * Auth user is left behind and can never sign in successfully (both apps reject
 * an account with no role), while permanently reserving the username — so the
 * caller is told plainly rather than seeing a generic failure. Only the
 * functions backend can clean that up, since deleting another user needs the
 * Admin SDK.
 */
async function createAccountViaClient(
  email: string,
  password: string,
  roleDoc: Record<string, unknown>
): Promise<string> {
  const secondaryApp = initializeApp(
    firebaseConfig,
    `create-account-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const secondaryAuth = getAuth(secondaryApp);

  let uid: string;
  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    uid = credential.user.uid;
  } catch (e) {
    await deleteApp(secondaryApp).catch(() => {});
    throw describeAuthError(e);
  }

  try {
    await setDoc(doc(db, "users", uid), roleDoc);
  } catch (e) {
    throw new Error(
      `The account was created, but its access level couldn't be saved (${userMessage(e)}) ` +
        `so it can't sign in, and the username is now taken. Contact your system administrator ` +
        `and quote reference ${uid}.`
    );
  } finally {
    await signOut(secondaryAuth).catch(() => {});
    await deleteApp(secondaryApp).catch(() => {});
  }

  return uid;
}

export async function createFieldReaderAccount(
  rawUsername: string,
  password: string,
  firstName: string,
  lastName: string,
  phoneNumber: string,
  actorEmail: string
): Promise<void> {
  const username = normalizeUsername(rawUsername);
  if (!USERNAME_PATTERN.test(username)) throw new InvalidUsernameError();
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (!firstName.trim() || !lastName.trim()) {
    throw new Error("First and last name are required.");
  }

  if (USING_ACCOUNT_FUNCTIONS) {
    try {
      await callFunction("createFieldReader", {
        username,
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phoneNumber: phoneNumber.trim(),
      });
    } catch (e) {
      throw describeCallableError(e);
    }
    return;
  }

  await createAccountViaClient(usernameToEmail(username), password, {
    role: "field_reader",
    username,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    phoneNumber: phoneNumber.trim(),
    assignedBarangays: [],
    assignedMonthStr: null,
    disabled: false,
  });

  logAuditEvent(
    "Account Update",
    `Created field reader account "${username}" (${firstName.trim()} ${lastName.trim()}).`,
    actorEmail
  );
}

/** Shared by the field-reader and console-account paths. */
export async function createConsoleAccountRecord(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  role: "admin" | "staff"
): Promise<void> {
  await createAccountViaClient(email, password, {
    role,
    email,
    firstName,
    lastName,
    disabled: false,
  });
}

/**
 * Revokes an account's access.
 *
 * On the functions backend this disables the Auth user outright and revokes its
 * refresh tokens, so a signed-in device stops working immediately.
 *
 * Without them, the `disabled` flag on `users/{uid}` is the revocation: the
 * Firestore rules refuse every read and write from a disabled account, and both
 * apps reject it at login. That covers the case that matters — a lost field
 * phone can no longer reach any concessionaire data — but the Auth session
 * itself survives, so treat it as revoking access rather than revoking the
 * credential. Change the password too if the credential itself is suspect.
 */
export async function setAccountDisabled(uid: string, disabled: boolean): Promise<void> {
  if (USING_ACCOUNT_FUNCTIONS) {
    try {
      await callFunction("setAccountDisabled", { uid, disabled });
    } catch (e) {
      throw describeCallableError(e);
    }
    return;
  }

  await setDoc(doc(db, "users", uid), { disabled }, { merge: true });
}

/**
 * Sets a new password directly. Only the functions backend can do this — the
 * client SDK can change the password of the *currently signed-in* user and
 * nobody else.
 */
export async function resetAccountPassword(uid: string, password: string): Promise<void> {
  if (!ACCOUNT_CAPABILITIES.canSetPasswordDirectly) {
    throw new UnsupportedOnThisBackendError(
      "Setting a password directly isn't available. For console accounts, send a reset email instead."
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  try {
    await callFunction("resetAccountPassword", { uid, password });
  } catch (e) {
    throw describeCallableError(e);
  }
}

/**
 * Sends a password-reset email. Works for console accounts, which have real
 * addresses; field readers' synthetic "@meedo.local" addresses receive no mail,
 * so there is deliberately no reader equivalent.
 */
export async function sendPasswordResetLink(email: string): Promise<void> {
  if (email.endsWith(`@${MOBILE_USERNAME_DOMAIN}`)) {
    throw new UnsupportedOnThisBackendError(
      "Field readers sign in with a username, not a real email address, so a reset link has " +
        "nowhere to go. Create the account again with a new password instead."
    );
  }
  await sendPasswordResetEmail(auth, email);
}

/**
 * Removes a role document. Used to clean up after a partially created account
 * on the client backend; the Auth user itself can only be removed with the
 * Admin SDK.
 */
export async function deleteRoleDocument(uid: string): Promise<void> {
  await deleteDoc(doc(db, "users", uid));
}
