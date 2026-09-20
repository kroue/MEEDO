/**
 * lib/firebase/useConcessionaires.ts
 *
 * React hook — fetches concessionaires from Firestore filtered by barangay.
 * Supports one-time fetch (default) or real-time subscription.
 *
 * Usage:
 *   const { concessionaires, loading, error, refresh } = useConcessionaires("BO-OT");
 *   const { concessionaires } = useConcessionaires("Cebuano Group", { realtime: true });
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchConcessionairesByBarangay,
  subscribeToConcessionairesByBarangay,
  fetchConcessionaireById,
  subscribeToConcessionaireById,
} from "./concessionaires";
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
  /** Manually re-fetches data (only meaningful when realtime=false). */
  refresh: () => void;
}

export function useConcessionaires(
  barangay: string | null | undefined,
  options: UseConcessionairesOptions = {}
): UseConcessionairesResult {
  const { realtime = false } = options;

  const [concessionaires, setConcessionaires] = useState<Concessionaire[]>([]);
  // Loading from the very first render whenever there is something to load.
  // Starting at false meant one render reporting "done, nothing found" before
  // the fetch had even begun.
  const [loading, setLoading] = useState<boolean>(() => Boolean(barangay));
  const [error, setError] = useState<Error | null>(null);

  // Stable counter to trigger manual refreshes without changing deps
  const [refreshTick, setRefreshTick] = useState(0);

  // Track whether the effect is still mounted to avoid state updates after unmount
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
    // Don't fetch until a barangay is selected
    if (!barangay) {
      setConcessionaires([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    if (realtime) {
      // ── Real-time listener ─────────────────────────────────────────────
      const unsubscribe = subscribeToConcessionairesByBarangay(
        barangay,
        (data) => {
          if (!isMounted.current) return;
          setConcessionaires(data);
          setLoading(false);
        },
        (err) => {
          if (!isMounted.current) return;
          setError(err);
          setLoading(false);
        }
      );

      // Cleanup: detach listener when barangay changes or component unmounts
      return () => {
        unsubscribe();
      };
    } else {
      // ── One-time fetch ─────────────────────────────────────────────────
      let cancelled = false;

      fetchConcessionairesByBarangay(barangay)
        .then((data) => {
          if (cancelled || !isMounted.current) return;
          setConcessionaires(data);
          setLoading(false);
        })
        .catch((err: Error) => {
          if (cancelled || !isMounted.current) return;
          setError(err);
          setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }
    // `refreshTick` as dep so `refresh()` re-runs a one-time fetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barangay, realtime, refreshTick]);

  return { concessionaires, loading, error, refresh };
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

  return { concessionaire, loading, error, refresh };
}
