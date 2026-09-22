// Import the functions you need from the SDKs you need
import { initializeApp, getApps } from "firebase/app";
import {
  clearIndexedDbPersistence,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  waitForPendingWrites,
  type Firestore,
} from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";
import type { Functions } from "firebase/functions";

// Your web app's Firebase configuration — read from environment variables
// (see .env.local.example) rather than hardcoded, so a different Firebase
// project can be targeted per environment without a code change. Note this
// is a hygiene/flexibility improvement, not a secrecy one: Firebase web
// config is meant to be public — it identifies the project, it doesn't
// authenticate access — and NEXT_PUBLIC_* values are inlined into the
// client bundle at build time regardless of where they're read from. What
// actually protects this project's data is Firestore Security Rules, not
// hiding this object.
// Exported so createFieldReader.ts can spin up a throwaway secondary app.
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const MISSING_CONFIG =
  "Missing backend config — set the NEXT_PUBLIC_FIREBASE_* environment variables " +
  "(locally: copy .env.local.example to .env.local; when deploying: set them on the host, " +
  "since they are baked in at build time).";

const hasConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

if (!hasConfig) {
  // Loud in a browser, where it means the console genuinely cannot work and
  // someone is staring at a broken screen.
  //
  // On the server it is only a warning. The build prerenders pages that never
  // touch the backend — /_not-found among them — and every component here is
  // client-side, so nothing calls the backend during a build. Throwing failed
  // the whole build on the way past, which is how a deploy died on a host that
  // simply hadn't been given the variables yet. A genuinely misconfigured
  // deploy still fails plainly, because the values are inlined at build time
  // and the browser hits this same check.
  if (typeof window !== "undefined") throw new Error(MISSING_CONFIG);
  console.warn(MISSING_CONFIG);
}

/**
 * Stand-in used only when prerendering without config, so initializing the
 * SDK doesn't throw `auth/invalid-api-key` and bring the build down with a
 * message about API keys rather than about the missing variables.
 */
const configForInit = hasConfig
  ? firebaseConfig
  : {
      apiKey: "missing-config",
      authDomain: "missing-config.invalid",
      projectId: "missing-config",
      appId: "missing-config",
    };

// Initialize Firebase — singleton guard prevents re-initialization on hot reload
const app = !getApps().length ? initializeApp(configForInit) : getApps()[0];

// Analytics: loaded once the browser is idle, never on the way to first paint.
//
// It used to be imported at the top of this file, which put the analytics and
// installations SDKs into the JavaScript of every single page — including the
// login screen — for something no one using the console waits on. Now it is a
// separate chunk fetched after the page is usable, and not at all when no
// measurement ID is configured.
if (typeof window !== "undefined" && firebaseConfig.measurementId) {
  const startAnalytics = () => {
    import("firebase/analytics")
      .then(({ isSupported, getAnalytics }) =>
        isSupported().then((yes) => {
          if (yes) getAnalytics(app);
        })
      )
      .catch(() => {
        // Blocked by an extension or offline: analytics is optional.
      });
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(startAnalytics, { timeout: 10_000 });
  } else {
    setTimeout(startAnalytics, 3_000);
  }
}

/**
 * The database client, with its cache kept on disk.
 *
 * With the default in-memory cache, every reload — and every morning's first
 * sign-in — downloaded every account again before anything could be shown.
 * On disk, a reopened console draws from what it already has straight away
 * and the server sends only what changed since. Reads that must be current
 * still are: transactions (every payment, bill and approval) always go to the
 * server, and live listeners correct themselves the moment it answers.
 *
 * The multi-tab manager lets several console tabs share one cache instead of
 * the second tab silently falling back to memory.
 *
 * Only in a browser: the build prerenders pages on the server, where there is
 * no disk cache to open. And only once — a hot reload re-runs this module, and
 * initializing twice throws, so the second time gets the existing instance.
 */
function createDb(): Firestore {
  if (typeof window === "undefined") return getFirestore(app);
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}

// Firestore instance — imported by concessionaires.ts and other service files
export const db: Firestore = createDb();

// Auth instance — admin login
export const auth: Auth = getAuth(app);

/**
 * Callable Cloud Functions — account creation, disabling and password resets
 * run server-side under the Admin SDK so Identity Platform's self-service
 * sign-up can stay switched off. See lib/firebase/createFieldReader.ts.
 *
 * Loaded on first use. Only an admin managing accounts ever calls these, but a
 * client created at the top of this file shipped the whole Functions SDK with
 * every page.
 */
let functionsClient: Promise<Functions> | null = null;
export function getFunctionsClient(): Promise<Functions> {
  functionsClient ??= import("firebase/functions").then(({ getFunctions }) =>
    getFunctions(app, process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION || "us-central1")
  );
  return functionsClient;
}

/**
 * Calls a Cloud Function by name, loading the Functions SDK the first time.
 * Errors are the SDK's own, with their "functions/…" codes, so callers map
 * them exactly as they did when calling httpsCallable directly.
 */
export async function callFunction(name: string, data: unknown): Promise<unknown> {
  const [client, { httpsCallable }] = await Promise.all([
    getFunctionsClient(),
    import("firebase/functions"),
  ]);
  const result = await httpsCallable(client, name)(data);
  return result.data;
}

/** How long sign-out waits for unsent changes before leaving the cache alone. */
const PENDING_WRITES_TIMEOUT_MS = 4_000;

/**
 * Wipes the records this browser has cached, for sign-out.
 *
 * The on-disk cache holds residents' names, addresses and balances, and an
 * office PC is shared — so they don't stay behind on it after the person who
 * loaded them has signed out.
 *
 * Two cases where it deliberately leaves the cache alone:
 *  - Changes that haven't reached the server yet. They live in that cache, and
 *    clearing it would throw away work someone did offline. It waits a few
 *    seconds for them to go, and if they can't, keeps them for next time.
 *  - Another console tab still open. The cache can only be cleared once no tab
 *    is using it; it is cleared on a later sign-out instead.
 *
 * Shuts the database client down either way, so the caller must follow this
 * with a full page load rather than an in-app navigation.
 */
export async function clearLocalRecords(): Promise<void> {
  if (typeof window === "undefined") return;
  const flushed = await Promise.race([
    waitForPendingWrites(db).then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PENDING_WRITES_TIMEOUT_MS)),
  ]).catch(() => false);

  await terminate(db).catch(() => {});
  if (!flushed) return;
  await clearIndexedDbPersistence(db).catch(() => {
    // "failed-precondition": another tab still has it open.
  });
}

export { app };
