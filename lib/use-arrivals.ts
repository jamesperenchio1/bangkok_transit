"use client";

import { useEffect, useState } from "react";
import { isValidArrivals, type Arrivals } from "./bts";

const POLL_MS = 60_000;
// Past this age, a localStorage-cached entry is from a much earlier visit
// (or a stale browser tab reopened later) rather than merely "a minute
// behind" - don't seed it as if it were current data on cold start.
const LOCAL_STORAGE_STALE_CUTOFF_MS = 10 * 60_000;
const memCache = new Map<string, Arrivals & { stale?: boolean }>();

function dataAgeMs(data: Arrivals): number {
  return Date.now() - Date.parse(data.timestamp.endsWith("Z") ? data.timestamp : data.timestamp + "Z");
}

function storageKey(code: string) {
  return `bts:arr:${code}`;
}

function readLocalStorage(code: string): (Arrivals & { stale?: boolean }) | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(code));
    if (!raw) return null;
    // A persisted entry can predate a schema change (or just be corrupted) -
    // trusting its shape blindly is what crashed the whole page on mount.
    const parsed: unknown = JSON.parse(raw);
    return isValidArrivals(parsed) ? (parsed as Arrivals & { stale?: boolean }) : null;
  } catch {
    return null;
  }
}

function writeLocalStorage(code: string, data: Arrivals & { stale?: boolean }) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(code), JSON.stringify(data));
  } catch {
    // storage full/unavailable - non-fatal, just skip persistence
  }
}

export interface UseArrivalsResult {
  data: (Arrivals & { stale?: boolean }) | null;
  error: string | null;
  loading: boolean;
}

interface State {
  code: string | null;
  data: (Arrivals & { stale?: boolean }) | null;
  error: string | null;
  loading: boolean;
}

function initialState(code: string | null): State {
  if (!code) return { code, data: null, error: null, loading: false };

  const cached = memCache.get(code) ?? readLocalStorage(code);
  const usable = cached && dataAgeMs(cached) <= LOCAL_STORAGE_STALE_CUTOFF_MS ? cached : null;

  return { code, data: usable, error: null, loading: true };
}

// The warm cron only refreshes Redis every ~5 min, so priming faster than
// that just re-reads the same values. Deliberately slower than the
// per-station POLL_MS (60s): once a popup is open, its own poll is the
// source of truth already - bulk priming only needs to keep *unopened*
// stations reasonably fresh.
const BULK_PRIME_MS = 4 * 60_000;

async function primeArrivalsCache(): Promise<void> {
  try {
    const res = await fetch("/api/arrivals", { cache: "no-store" });
    if (!res.ok) return;
    const json: Record<string, Arrivals> = await res.json();
    for (const [code, data] of Object.entries(json)) {
      if (!isValidArrivals(data)) continue;
      // Don't clobber a fresher entry a station's own poll already wrote.
      const existing = memCache.get(code);
      if (existing && dataAgeMs(existing) < dataAgeMs(data)) continue;
      memCache.set(code, data);
      writeLocalStorage(code, data);
    }
  } catch {
    // Best-effort background priming - must never surface to the UI or
    // block anything; per-station polling is unaffected.
  }
}

/**
 * Primes every live-arrivals station's cache as soon as the app mounts, and
 * keeps it refreshed on an interval, so useArrivals's synchronous
 * initialState() already has data the very first time a station's popup is
 * opened on this device. Call once near the root of the app.
 */
export function useArrivalsPriming(): void {
  useEffect(() => {
    primeArrivalsCache();
    const interval = setInterval(primeArrivalsCache, BULK_PRIME_MS);
    return () => clearInterval(interval);
  }, []);
}

export function useArrivals(code: string | null): UseArrivalsResult {
  const [state, setState] = useState<State>(() => initialState(code));

  // Reset state synchronously when `code` changes, per React's documented
  // pattern for adjusting state during render rather than in an effect.
  if (state.code !== code) {
    setState(initialState(code));
  }

  useEffect(() => {
    if (!code) return;

    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/arrivals/${code}`, { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setState((s) =>
            s.code === code ? { ...s, error: json.error ?? "Could not load arrivals.", loading: false } : s,
          );
          return;
        }
        memCache.set(code!, json);
        writeLocalStorage(code!, json);
        setState((s) => (s.code === code ? { ...s, data: json, error: null, loading: false } : s));
      } catch {
        if (!cancelled) {
          setState((s) =>
            s.code === code ? { ...s, error: "Could not load arrivals.", loading: false } : s,
          );
        }
      }
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [code]);

  return { data: state.data, error: state.error, loading: state.loading };
}
