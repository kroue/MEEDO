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

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  throw new Error(
    "Missing Firebase config — copy .env.local.example to .env.local and fill in your project's values."
  );
}

// Initialize Firebase — singleton guard prevents re-initialization on hot reload
const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];

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