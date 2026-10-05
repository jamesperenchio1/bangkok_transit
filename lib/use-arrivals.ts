"use client";

import { useEffect, useMemo, useState } from "react";
import { FRESH_FOR_MS, isFresh } from "./bts";
import { serverNow, useArrivalsStore, type ArrivalsEntry } from "./arrivals-store";
import { useNow } from "./use-now";

export interface UseArrivalsResult {
  /** Fresh arrivals for this station, or null - never anything older than FRESH_FOR_MS. */
  data: ArrivalsEntry | null;
  /**
   * False until this tab has heard from the server once, so callers can tell
   * "still loading" apart from "no live times right now".
   */
  settled: boolean;
  /** The live (server-corrected) clock this result was checked against; reuse it for countdowns. */
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
  const clockOffsetMs = useArrivalsStore((s) => s.clockOffsetMs);
  const tick = useNow();
  // Bumped when the held entry hits FRESH_FOR_MS, so it disappears at that
  // exact moment rather than on the next (up to 15s later) clock tick.
  const [expiredAt, setExpiredAt] = useState(0);

  useEffect(() => {
    if (!entry) return;
    const timestamp = entry.timestamp;
    const msLeft = Date.parse(timestamp.endsWith("Z") ? timestamp : `${timestamp}Z`) + FRESH_FOR_MS - serverNow();
    if (!(msLeft > 0)) return;
    const timer = setTimeout(() => setExpiredAt(Date.now()), msLeft + 50);
    return () => clearTimeout(timer);
  }, [entry, clockOffsetMs]);

  // Measured on the server's clock, not the device's (see serverNow). The
  // tick, the expiry timer, a new entry, or a new offset re-evaluates it.
  const now = useMemo(() => serverNow(), [tick, expiredAt, entry, clockOffsetMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = entry && isFresh(entry.timestamp, now) ? entry : null;
  return { data, settled, now };
}
