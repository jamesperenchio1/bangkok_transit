"use client";

import { useEffect, useMemo, useState } from "react";
import { ageMs, FRESH_FOR_MS, isFresh, isShowable, MAX_SHOW_AGE_MS } from "./bts";
import { serverNow, useArrivalsStore, type ArrivalsEntry } from "./arrivals-store";
import { useNow } from "./use-now";

export interface UseArrivalsResult {
  /**
   * The latest arrivals for this station - live or not - or null when there
   * is nothing recent enough to show (see MAX_SHOW_AGE_MS).
   */
  data: ArrivalsEntry | null;
  /** True while `data` is live (younger than FRESH_FOR_MS); false means it's last-known. */
  live: boolean;
  /**
   * False until this tab has heard from the server once, so callers can tell
   * "still loading" apart from "no times right now".
   */
  settled: boolean;
  /** The live (server-corrected) clock this result was checked against; reuse it for countdowns. */
  now: number;
}

/**
 * Reads arrivals from the shared store. There is no per-station fetch: the
 * store is refreshed from the one shared snapshot (/api/arrivals), so
 * opening a station never causes a request of its own.
 *
 * If updates stall, the last-known times keep showing (callers count them
 * down and show their age) instead of vanishing; only entries past
 * MAX_SHOW_AGE_MS are dropped. Re-evaluated on every clock tick and exactly
 * at each threshold.
 */
export function useArrivals(code: string | null): UseArrivalsResult {
  const entry = useArrivalsStore((s) => (code ? (s.map[code] ?? null) : null));
  const settled = useArrivalsStore((s) => s.settled);
  const clockOffsetMs = useArrivalsStore((s) => s.clockOffsetMs);
  const tick = useNow();
  // Bumped exactly when the held entry crosses its next threshold (stops
  // being live at FRESH_FOR_MS, then drops at MAX_SHOW_AGE_MS), so the card
  // changes at that moment rather than on the next 15s tick.
  const [crossedAt, setCrossedAt] = useState(0);

  useEffect(() => {
    if (!entry) return;
    const age = ageMs(entry.timestamp, serverNow());
    const next = age < FRESH_FOR_MS ? FRESH_FOR_MS : age < MAX_SHOW_AGE_MS ? MAX_SHOW_AGE_MS : null;
    if (next === null) return;
    const timer = setTimeout(() => setCrossedAt(Date.now()), next - age + 50);
    return () => clearTimeout(timer);
  }, [entry, clockOffsetMs, crossedAt]);

  // Measured on the server's clock, not the device's (see serverNow). The
  // tick, a threshold crossing, a new entry, or a new offset re-evaluates it.
  const now = useMemo(() => serverNow(), [tick, crossedAt, entry, clockOffsetMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = entry && isShowable(entry.timestamp, now) ? entry : null;
  const live = data !== null && isFresh(data.timestamp, now);
  return { data, live, settled, now };
}
