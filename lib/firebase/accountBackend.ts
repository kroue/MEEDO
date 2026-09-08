/**
 * lib/firebase/accountBackend.ts
 *
 * Which implementation handles account management — creating field-reader and
 * console accounts, disabling them, and resetting passwords.
 *
 * There are two, and the app can switch between them without any call site
 * changing:
 *
 *   "client"    — accounts are created in the browser on a throwaway secondary
 *                 Firebase app, which is how this system has always worked.
 *                 Needs no server and no paid plan, but it requires Identity
 *                 Platform to accept self-service sign-up, and the web API key
 *                 is in the JavaScript bundle by design — so anyone who opens
 *                 the login page can register themselves an account. Firestore
 *                 rules are what stop that account from being useful (it has no
 *                 `users/{uid}` role document, so every collection refuses it),
 *                 but the account still exists.
 *
 *   "functions" — accounts are created server-side by the Cloud Functions in
 *                 functions/index.js, using the Admin SDK. Sign-up can then be
 *                 switched off entirely in the Firebase console, which closes
 *                 the hole above. It also unlocks the two things the client SDK
 *                 simply cannot do: genuinely disabling an Auth account (and
 *                 revoking its refresh tokens), and setting a password directly
 *                 for a field reader, whose synthetic "@meedo.local" address
 *                 can never receive a reset email.
 *
 *                 Cloud Functions require the Blaze plan.
 *
 * Set NEXT_PUBLIC_ACCOUNT_ADMIN_BACKEND=functions in .env.local once the
 * functions are deployed. Nothing else needs to change.
 */

export type AccountBackend = "client" | "functions";

export const ACCOUNT_BACKEND: AccountBackend =
  process.env.NEXT_PUBLIC_ACCOUNT_ADMIN_BACKEND === "functions" ? "functions" : "client";

export const USING_ACCOUNT_FUNCTIONS = ACCOUNT_BACKEND === "functions";

/**
 * What the active backend can actually do, so the UI offers only the controls
 * that will work rather than presenting one that always errors.
 */
export const ACCOUNT_CAPABILITIES = {
  /**
   * Disabling an Auth account outright — the session dies immediately and the
   * credentials stop working everywhere.
   *
   * On the client backend this is false, but access is still revoked: the
   * `disabled` flag on `users/{uid}` is enforced by Firestore rules, so a
   * disabled account can no longer read or write anything, and both apps
   * refuse it at login. What it does NOT do is invalidate the Firebase Auth
   * session itself, so a phone already signed in stays signed in — it just
   * can't reach any data.
   */
  canRevokeAuthSession: USING_ACCOUNT_FUNCTIONS,

  /** Setting a new password directly, without the account's cooperation. */
  canSetPasswordDirectly: USING_ACCOUNT_FUNCTIONS,

  /**
   * Sending a password-reset email. Console accounts have real addresses so
   * this always works for them; field readers never do (their usernames map to
   * a synthetic domain that receives no mail), which is why the functions
   * backend exists for that case.
   */
  canEmailPasswordReset: true,
} as const;

/** Shown in the UI wherever a control is unavailable on the current backend. */
export const ACCOUNT_FUNCTIONS_HINT =
  "This needs the account-management Cloud Functions, which aren't deployed. " +
  "They require the Firebase project to be on the Blaze plan; see functions/README.md.";
