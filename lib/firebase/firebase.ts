// Import the functions you need from the SDKs you need
import { initializeApp, getApps } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";
import { getFunctions, type Functions } from "firebase/functions";

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

// Analytics: only load in browser (not during SSR/build)
if (typeof window !== "undefined") {
  isSupported().then((yes) => {
    if (yes) getAnalytics(app);
  });
}

// Firestore instance — imported by concessionaires.ts and other service files
export const db: Firestore = getFirestore(app);

// Auth instance — admin login
export const auth: Auth = getAuth(app);

// Callable Cloud Functions — account creation, disabling and password resets
// run server-side under the Admin SDK so Identity Platform's self-service
// sign-up can stay switched off. See lib/firebase/createFieldReader.ts.
export const functions: Functions = getFunctions(
  app,
  process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION || "us-central1"
);

export { app };