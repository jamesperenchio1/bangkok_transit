"use client";

import { useArrivalsStore, type ArrivalsEntry } from "./arrivals-store";

export interface UseArrivalsResult {
  data: ArrivalsEntry | null;
  error: string | null;
  loading: boolean;
}

/**
 * Reads live arrivals from the shared store. There is no loading state and no
 * per-station fetch: the store is seeded from localStorage on mount and
 * refreshed in bulk, so this resolves instantly for every station.
 */
export function useArrivals(code: string | null): UseArrivalsResult {
  const data = useArrivalsStore((s) => (code ? (s.map[code] ?? null) : null));
  return { data, error: null, loading: false };
}
