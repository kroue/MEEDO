/**
 * lib/firebase/concessionairesStore.ts
 *
 * One live copy of the account list, shared by everything in the console.
 *
 * Before this, every screen that needed accounts fetched the whole collection
 * for itself: the header's badges on every page, then the dashboard, billing,
 * collections and reports each opened their own listener, and the
 * Concessionaires and Connections pages fetched again per barangay. Opening
 * the dashboard downloaded every account twice. Moving from Billing to
 * Collections threw one copy away and downloaded the same accounts again —
 * each carrying its bill summary — and so did every move after that.
 *
 * Now there is one listener for the session. The first screen to ask starts
 * it; every other screen reads what it already holds, so moving between pages
 * shows the accounts at once, and a change anyone makes anywhere reaches every
 * open screen. With the database's disk cache, even a fresh load starts from
 * the accounts this browser saw last and receives only what has changed.
 *
 * Kept running a while after the last screen stops watching, so leaving and
 * coming back to a page doesn't start from nothing. Stopped at sign-out.
 */

"use client";

import { onAuthStateChanged } from "firebase/auth";
import type { Unsubscribe } from "firebase/firestore";
import { auth } from "./firebase";
import { subscribeToConcessionairesByBarangay } from "./concessionaires";
import type { Concessionaire } from "./types";

export interface ConcessionairesState {
  concessionaires: Concessionaire[];
  loading: boolean;
  error: Error | null;
  /**
   * False while the list is only what this browser had cached. Lists can show
   * that straight away — it corrects itself within a moment — but anything
   * printed or charged must wait for the server's answer.
   */
  fromServer: boolean;
}

const STARTING: ConcessionairesState = {
  concessionaires: [],
  loading: true,
  error: null,
  fromServer: false,
};
const SIGNED_OUT: ConcessionairesState = { ...STARTING, loading: false };

/** How long the listener outlives the last screen watching it. */
const IDLE_STOP_MS = 5 * 60 * 1000;

let state: ConcessionairesState = STARTING;
const watchers = new Set<() => void>();
let stopListening: Unsubscribe | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let stopWatchingAuth: Unsubscribe | null = null;

function publish(next: ConcessionairesState) {
  state = next;
  watchers.forEach((watcher) => watcher());
}

function start() {
  if (stopListening || !auth.currentUser) return;
  if (state.error) publish({ ...state, loading: true, error: null });
  stopListening = subscribeToConcessionairesByBarangay(
    "all",
    (concessionaires, fromServer) =>
      publish({ concessionaires, loading: false, error: null, fromServer }),
    (error) => {
      // A listener that errors is finished; the next start() opens a new one.
      stopListening = null;
      publish({ ...state, loading: false, error });
    }
  );
}

function stop(next: ConcessionairesState) {
  stopListening?.();
  stopListening = null;
  publish(next);
}

/**
 * Starts and stops the listener with the session. Nothing can be read before
 * sign-in, and after sign-out the listener would only collect permission
 * errors — and keep residents' records on screen for whoever sits down next.
 */
function watchAuth() {
  if (stopWatchingAuth) return;
  stopWatchingAuth = onAuthStateChanged(auth, (user) => {
    if (!user) stop(SIGNED_OUT);
    else if (watchers.size > 0) start();
  });
}

export function subscribeToAccounts(watcher: () => void): () => void {
  watchers.add(watcher);
  watchAuth();
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  start();

  return () => {
    watchers.delete(watcher);
    if (watchers.size === 0 && !idleTimer) {
      idleTimer = setTimeout(() => {
        idleTimer = null;
        if (watchers.size === 0) stop(STARTING);
      }, IDLE_STOP_MS);
    }
  };
}

export function getAccountsSnapshot(): ConcessionairesState {
  return state;
}

export function getAccountsServerSnapshot(): ConcessionairesState {
  return STARTING;
}

/**
 * Drops the listener and opens a fresh one, which reads everything from the
 * server again. The list is already live, so this is only for when someone
 * wants to be certain — the Refresh button, or recovering from an error.
 */
export function restartAccounts() {
  stopListening?.();
  stopListening = null;
  publish({ ...state, loading: true, error: null, fromServer: false });
  start();
}
