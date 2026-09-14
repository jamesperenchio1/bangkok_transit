"use client";

import { create } from "zustand";
import { isValidArrivals, type Arrivals } from "./bts";

/**
 * One shared arrivals store for the whole app. Seeded from localStorage on
 * mount so times are on screen the instant a station card opens, then
 * refreshed in bulk and polled. Background refreshes swap data in silently -
 * no loading flags, no "updating…" copy.
 */

const POLL_MS = 60_000;
/**
 * The bulk endpoint returns immediately and fills in from the server's
 * background refresh, so a first-time visitor (empty localStorage) starts with
 * a partial payload. Poll fast until every live station has arrived, then fall
 * back to the slow interval.
 */
const FAST_POLL_MS = 2_000;
const MAX_FAST_POLLS = 15;

const SNAPSHOT_KEY = "bts:arrivals:v1";
// Past this age a persisted entry is from an earlier visit rather than merely
// a minute behind; don't present it as current data.
const SNAPSHOT_STALE_CUTOFF_MS = 10 * 60_000;

export type ArrivalsEntry = Arrivals & { stale?: boolean };
export type ArrivalsMap = Record<string, ArrivalsEntry>;

interface ArrivalsStore {
  map: ArrivalsMap;
  setMap: (map: ArrivalsMap) => void;
  merge: (incoming: ArrivalsMap) => void;
}

function dataAgeMs(data: Arrivals): number {
  const iso = data.timestamp.endsWith("Z") ? data.timestamp : data.timestamp + "Z";
  return Date.now() - Date.parse(iso);
}

function readSnapshot(): ArrivalsMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: ArrivalsMap = {};
    for (const [code, value] of Object.entries(parsed as Record<string, unknown>)) {
      // A persisted entry can predate a schema change or just be corrupted -
      // validating before trusting its shape is what keeps the page alive.
      if (isValidArrivals(value) && dataAgeMs(value) <= SNAPSHOT_STALE_CUTOFF_MS) {
        out[code] = value as ArrivalsEntry;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeSnapshot(map: ArrivalsMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(map));
  } catch {
    // storage full/unavailable - non-fatal, just skip persistence
  }
}

export const useArrivalsStore = create<ArrivalsStore>((set) => ({
  map: {},
  setMap: (map) => set({ map }),
  merge: (incoming) =>
    set((s) => {
      const next = { ...s.map, ...incoming };
      writeSnapshot(next);
      return { map: next };
    }),
}));

/** Single-station fallback used when the bulk payload hasn't reached a code yet. */
const stationFetches = new Set<string>();

export async function fetchStationArrivals(code: string): Promise<void> {
  if (stationFetches.has(code)) return;
  stationFetches.add(code);
  try {
    const res = await fetch(`/api/arrivals/${code}`, { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as Arrivals & { stale?: boolean };
    if (!isValidArrivals(json)) return;
    const entry: ArrivalsEntry = json.stale ? { ...json, stale: true } : json;
    useArrivalsStore.getState().merge({ [code]: entry });
  } catch {
    // keep showing whatever we already have; the next poll will retry
  } finally {
    stationFetches.delete(code);
  }
}

let started = false;

/** Seed from localStorage, fetch everything once, then poll. Idempotent. */
export function startArrivalsPolling() {
  if (started || typeof window === "undefined") return;
  started = true;

  const seeded = readSnapshot();
  if (Object.keys(seeded).length > 0) {
    useArrivalsStore.getState().setMap(seeded);
  }

  let expected = 0;
  let fastPolls = 0;

  async function poll() {
    let complete = true;
    try {
      const res = await fetch("/api/arrivals", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as {
          arrivals?: Record<string, Arrivals>;
          stale?: Record<string, boolean>;
          total?: number;
        };
        if (json.arrivals) {
          const incoming: ArrivalsMap = {};
          for (const [code, data] of Object.entries(json.arrivals)) {
            if (!isValidArrivals(data)) continue;
            incoming[code] = json.stale?.[code] ? { ...data, stale: true } : data;
          }
          useArrivalsStore.getState().merge(incoming);
        }
        if (typeof json.total === "number") expected = json.total;
      }
    } catch {
      // network hiccup - keep showing what we have and retry next tick
    }

    const held = Object.keys(useArrivalsStore.getState().map).length;
    complete = expected > 0 && held >= expected;

    let delay = POLL_MS;
    if (!complete && fastPolls < MAX_FAST_POLLS) {
      fastPolls += 1;
      delay = FAST_POLL_MS;
    } else {
      fastPolls = 0;
    }
    setTimeout(poll, delay);
  }

  poll();
}
