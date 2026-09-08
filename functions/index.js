/**
 * functions/index.js
 *
 * Admin-only account management, running on the server with the Admin SDK.
 *
 * Why this exists: both account-creation paths used to call
 * `createUserWithEmailAndPassword` from the browser. That works, but it
 * requires Identity Platform to accept self-service sign-up from anyone
 * holding the web API key — and that key ships in the JavaScript bundle by
 * design. Anyone who opened the login page could register an arbitrary
 * account against the project and get whatever an authenticated caller is
 * allowed to do.
 *
 * With creation moved here, sign-up can (and must) be switched OFF in the
 * Firebase console: Authentication → Settings → User actions → uncheck
 * "Enable create (sign-up)". Accounts then only ever come into existence
 * through an admin calling one of these functions.
 *
 * Each function also writes the users/{uid} role document itself, in the same
 * request, so a half-created account (Auth user with no role document, which
 * permanently blocks the username) is no longer possible: if the Firestore
 * write fails, the Auth user is deleted before returning.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

const auth = getAuth();
const db = getFirestore();

/** Field readers sign in with a plain username mapped onto this domain. */
const MOBILE_USERNAME_DOMAIN = "meedo.local";
const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;
const MIN_PASSWORD_LENGTH = 10;

/**
 * Throws unless the caller is signed in AND holds `role: "admin"` in
 * Firestore. Custom claims would be cheaper, but the role already lives in
 * Firestore and is what every other surface reads — one source of truth beats
 * a fast one that can drift.
 */
async function requireAdmin(request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const snapshot = await db.collection("users").doc(uid).get();
  if (!snapshot.exists || snapshot.data().role !== "admin") {
    throw new HttpsError("permission-denied", "Only an admin can manage accounts.");
  }
  return { uid, email: snapshot.data().email || (request.auth.token && request.auth.token.email) || uid };
}

function assertPassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }
}

async function writeAuditLog(actionType, description, user) {
  try {
    await db.collection("auditLogs").add({
      actionType,
      description,
      user,
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("Failed to write audit log entry", err);
  }
}

/**
 * Creates a mobile field-reader account and its role document.
 * Data: { username, password, firstName, lastName, phoneNumber }
 */
exports.createFieldReader = onCall(async (request) => {
  const actor = await requireAdmin(request);
  const { username: rawUsername, password, firstName, lastName, phoneNumber } = request.data || {};

  const username = String(rawUsername || "").trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new HttpsError(
      "invalid-argument",
      "Username must be 3-30 characters: lowercase letters, numbers, dot, underscore, or hyphen only."
    );
  }
  if (!String(firstName || "").trim() || !String(lastName || "").trim()) {
    throw new HttpsError("invalid-argument", "First and last name are required.");
  }
  assertPassword(password);

  let userRecord;
  try {
    userRecord = await auth.createUser({
      email: `${username}@${MOBILE_USERNAME_DOMAIN}`,
      password,
      displayName: `${String(firstName).trim()} ${String(lastName).trim()}`.trim(),
    });
  } catch (err) {
    if (err.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "That username is already taken.");
    }
    throw new HttpsError("internal", err.message || "Failed to create the account.");
  }

  try {
    await db.collection("users").doc(userRecord.uid).set({
      role: "field_reader",
      username,
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      phoneNumber: String(phoneNumber || "").trim(),
      assignedBarangays: [],
      assignedMonthStr: null,
      disabled: false,
    });
  } catch (err) {
    // Roll the Auth user back rather than leaving an account that can never
    // sign in successfully and permanently reserves the username.
    await auth.deleteUser(userRecord.uid).catch(() => {});
    throw new HttpsError("internal", "Failed to save the account's role. Nothing was created.");
  }

  await writeAuditLog(
    "Account Update",
    `Created field reader account "${username}" (${String(firstName).trim()} ${String(lastName).trim()}).`,
    actor.email
  );

  return { uid: userRecord.uid, username };
});

/**
 * Creates an admin-console account (admin or staff) and its role document.
 * Data: { email, password, firstName, lastName, role }
 */
exports.createConsoleUser = onCall(async (request) => {
  const actor = await requireAdmin(request);
  const { email: rawEmail, password, firstName, lastName, role } = request.data || {};

  const email = String(rawEmail || "").trim().toLowerCase();
  if (!email.includes("@")) {
    throw new HttpsError("invalid-argument", "That doesn't look like a valid email address.");
  }
  if (role !== "admin" && role !== "staff") {
    throw new HttpsError("invalid-argument", "Role must be either admin or staff.");
  }
  if (!String(firstName || "").trim() || !String(lastName || "").trim()) {
    throw new HttpsError("invalid-argument", "First and last name are required.");
  }
  assertPassword(password);

  let userRecord;
  try {
    userRecord = await auth.createUser({
      email,
      password,
      displayName: `${String(firstName).trim()} ${String(lastName).trim()}`.trim(),
    });
  } catch (err) {
    if (err.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "An account with that email already exists.");
    }
    throw new HttpsError("internal", err.message || "Failed to create the account.");
  }

  try {
    await db.collection("users").doc(userRecord.uid).set({
      role,
      email,
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      disabled: false,
    });
  } catch (err) {
    await auth.deleteUser(userRecord.uid).catch(() => {});
    throw new HttpsError("internal", "Failed to save the account's role. Nothing was created.");
  }

  await writeAuditLog(
    "Account Update",
    `Created ${role} console account "${email}" (${String(firstName).trim()} ${String(lastName).trim()}).`,
    actor.email
  );

  return { uid: userRecord.uid, email };
});

/**
 * Disables or re-enables an account — the revocation path a lost field phone
 * needs. Recalling a reader's barangays does not revoke anything; this does,
 * and it takes effect on the device's next token refresh (within an hour) or
 * immediately on any Firestore request once the session is revoked.
 *
 * Data: { uid, disabled }
 */
exports.setAccountDisabled = onCall(async (request) => {
  const actor = await requireAdmin(request);
  const { uid, disabled } = request.data || {};

  if (typeof uid !== "string" || !uid) {
    throw new HttpsError("invalid-argument", "A user id is required.");
  }
  if (typeof disabled !== "boolean") {
    throw new HttpsError("invalid-argument", "`disabled` must be true or false.");
  }
  if (uid === actor.uid) {
    throw new HttpsError("failed-precondition", "You can't disable your own account.");
  }

  await auth.updateUser(uid, { disabled });
  if (disabled) {
    // Invalidate existing refresh tokens so an already-signed-in device can't
    // keep working off a cached session.
    await auth.revokeRefreshTokens(uid);
  }
  await db.collection("users").doc(uid).set({ disabled }, { merge: true });

  await writeAuditLog(
    "Account Update",
    `${disabled ? "Disabled" : "Re-enabled"} account ${uid}.`,
    actor.email
  );

  return { uid, disabled };
});

/**
 * Sets a new password for an existing account.
 *
 * Field readers sign in with synthetic `@meedo.local` addresses, so Firebase's
 * password-reset email can never reach them — the domain doesn't receive
 * mail. Without this, a forgotten password meant creating a second account
 * and abandoning the first. Admins can now reset in place.
 *
 * Data: { uid, password }
 */
exports.resetAccountPassword = onCall(async (request) => {
  const actor = await requireAdmin(request);
  const { uid, password } = request.data || {};

  if (typeof uid !== "string" || !uid) {
    throw new HttpsError("invalid-argument", "A user id is required.");
  }
  assertPassword(password);

  await auth.updateUser(uid, { password });
  await auth.revokeRefreshTokens(uid);

  await writeAuditLog("Account Update", `Reset the password for account ${uid}.`, actor.email);

  return { uid };
});
