"use client";

import { useEffect } from "react";
import { fetchStationArrivals, useArrivalsStore, type ArrivalsEntry } from "./arrivals-store";

export interface UseArrivalsResult {
  data: ArrivalsEntry | null;
  error: string | null;
  loading: boolean;
}

/**
 * Reads live arrivals from the shared store. There is no loading state and no
 * per-station fetch for the common case: the store is seeded from localStorage
 * on mount and refreshed in bulk, so this resolves instantly for every station.
 *
 * If a code has not reached the store yet - a first-ever visitor whose bulk
 * snapshot is still filling in - this asks for that one station directly so
 * the station the user actually opened arrives in ~2s instead of waiting for
 * all 61.
 */
export function useArrivals(code: string | null): UseArrivalsResult {
  const data = useArrivalsStore((s) => (code ? (s.map[code] ?? null) : null));

  useEffect(() => {
    if (code && !data) {
      void fetchStationArrivals(code);
    }
  }, [code, data]);

  return { data, error: null, loading: false };
}
