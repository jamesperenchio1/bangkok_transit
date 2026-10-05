"use client";

import { isFresh } from "./bts";
import { useArrivalsStore, type ArrivalsEntry } from "./arrivals-store";
import { useNow } from "./use-now";

export interface UseArrivalsResult {
  /** Fresh arrivals for this station, or null - never anything older than FRESH_FOR_MS. */
  data: ArrivalsEntry | null;
  /**
   * False until this tab has heard from the server once, so callers can tell
   * "still loading" apart from "no live times right now".
   */
  settled: boolean;
  /** The live clock this result was checked against; reuse it for countdowns. */
  now: number;
}

/**
 * Reads live arrivals from the shared store. There is no per-station fetch:
 * the store is refreshed from the one shared snapshot (/api/arrivals), so
 * opening a station never causes a request of its own.
 *
 * Freshness is re-checked on every tick of the live clock, not just when data
 * arrives: if updates stop (offline, server trouble, a laptop lid closed for
 * a day), the times disappear within FRESH_FOR_MS instead of lingering.
 */
export function useArrivals(code: string | null): UseArrivalsResult {
  const entry = useArrivalsStore((s) => (code ? (s.map[code] ?? null) : null));
  const settled = useArrivalsStore((s) => s.settled);
  const now = useNow();
  const data = entry && isFresh(entry.timestamp, now) ? entry : null;
  return { data, settled, now };
}
