"use client";

import { useArrivalsStore, type ArrivalsEntry } from "./arrivals-store";

export interface UseArrivalsResult {
  data: ArrivalsEntry | null;
  error: string | null;
  loading: boolean;
}

/**
 * Reads live arrivals from the shared store. There is no per-station fetch:
 * the store is seeded from localStorage on mount and refreshed from the one
 * shared snapshot (/api/arrivals), so opening a station never causes a
 * request of its own. A station missing from the snapshot (a cold start that
 * is still filling in) simply appears on the next shared poll.
 */
export function useArrivals(code: string | null): UseArrivalsResult {
  const data = useArrivalsStore((s) => (code ? (s.map[code] ?? null) : null));
  return { data, error: null, loading: false };
}
