/**
 * lib/firebase/useConcessionaires.ts
 *
 * React hooks for accounts: the list (optionally one barangay's), and a single
 * account by id.
 *
 * Usage:
 *   const { concessionaires, loading, error, refresh } = useConcessionaires("BO-OT");
 *   const { concessionaires } = useConcessionaires("all");
 *   const { concessionaire } = useConcessionaire(id, { realtime: true });
 */

"use client";

import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { fetchConcessionaireById, subscribeToConcessionaireById } from "./concessionaires";
import {
  getAccountsServerSnapshot,
  getAccountsSnapshot,
  restartAccounts,
  subscribeToAccounts,
} from "./concessionairesStore";
import type { Concessionaire } from "./types";

export interface UseConcessionairesOptions {
  /**
   * When true, uses onSnapshot for live updates.
   * When false (default), uses getDocs for a one-time fetch.
   */
  realtime?: boolean;
}

export interface UseConcessionairesResult {
  concessionaires: Concessionaire[];
  loading: boolean;
  error: Error | null;
  /** Reads the whole list from the server again. It is already live; this is for certainty. */
  refresh: () => void;
}

const NOT_WATCHING = () => () => {};
const EMPTY: Concessionaire[] = [];

/**
 * The account list — every account for "all", or one barangay's.
 *
 * Always live, and always the same shared copy (see concessionairesStore.ts):
 * a second screen asking for accounts costs nothing, and a barangay is a
 * filter over the list already held rather than another download.
 *
 * Nothing is read until a barangay is chosen, as before.
 */
export function useConcessionaires(barangay: string | null | undefined): UseConcessionairesResult {
  const store = useSyncExternalStore(
    barangay ? subscribeToAccounts : NOT_WATCHING,
    getAccountsSnapshot,
    getAccountsServerSnapshot
  );

  const concessionaires = useMemo(() => {
    if (!barangay) return EMPTY;
    if (barangay === "all") return store.concessionaires;
    return store.concessionaires.filter((c) => c.barangay === barangay);
  }, [store.concessionaires, barangay]);

  if (!barangay) {
    return { concessionaires: EMPTY, loading: false, error: null, refresh: restartAccounts };
  }
  return { concessionaires, loading: store.loading, error: store.error, refresh: restartAccounts };
}

/**
 * The account with this id from the shared list, if the list has it — so a
 * detail page can draw at once from what is already in memory while its own
 * read of the account catches up.
 */
function useAccountFromList(id: string | null | undefined): Concessionaire | null {
  const store = useSyncExternalStore(
    id ? subscribeToAccounts : NOT_WATCHING,
    getAccountsSnapshot,
    getAccountsServerSnapshot
  );
  // Only once the server has confirmed the list. Detail pages print statements
  // and receipts, and a balance read from last session's cache must never end
  // up on paper.
  const confirmed = store.fromServer ? store.concessionaires : EMPTY;
  return useMemo(
    () => (id ? confirmed.find((c) => c.id === id) ?? null : null),
    [confirmed, id]
  );
}

export interface UseConcessionaireResult {
  concessionaire: Concessionaire | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useConcessionaire(
  id: string | null | undefined,
  options: UseConcessionairesOptions = {}
): UseConcessionaireResult {
  const { realtime = false } = options;

  // Drawn at once from the shared list when it already has this account; this
  // hook's own read replaces it as soon as that arrives.
  const fromList = useAccountFromList(id);

  const [concessionaire, setConcessionaire] = useState<Concessionaire | null>(null);
  // Loading from the very first render whenever there is an id. Starting at
  // false gave one render of "loaded, and no such account" before the fetch
  // began — which printable documents took as final and refused to print, and
  // detail pages flashed as "not found".
  const [loading, setLoading] = useState<boolean>(() => Boolean(id));
  const [error, setError] = useState<Error | null>(null);

  const [refreshTick, setRefreshTick] = useState(0);

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!id) {
      setConcessionaire(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    if (realtime) {
      const unsubscribe = subscribeToConcessionaireById(
        id,
        (data) => {
          if (!isMounted.current) return;
          setConcessionaire(data);
          setLoading(false);
        },
        (err) => {
          if (!isMounted.current) return;
          setError(err);
          setLoading(false);
        }
      );

      return () => {
        unsubscribe();
      };
    } else {
      let cancelled = false;

      fetchConcessionaireById(id)
        .then((data) => {
          if (cancelled || !isMounted.current) return;
          setConcessionaire(data);
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled || !isMounted.current) return;
          setError(err);
          setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }
  }, [id, realtime, refreshTick]);

  // Until this hook's own read lands, the list's copy stands in for it. Once it
  // has landed it wins outright — including when it says the account is gone.
  if (loading && fromList) {
    return { concessionaire: fromList, loading: false, error, refresh };
  }
  return { concessionaire, loading, error, refresh };
}
