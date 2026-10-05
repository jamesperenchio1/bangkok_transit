"use client";

import { create } from "zustand";
import { isFresh, isValidArrivals, type Arrivals } from "./bts";

/**
 * One shared arrivals store for the whole app, fed by the one shared
 * snapshot (/api/arrivals). Seeded from localStorage on mount so times are on
 * screen the instant a station card opens, then polled for as long as the
 * page is open - minutes or days.
 *
 * Old data is never kept: each poll replaces the map wholesale, the seed only
 * accepts entries that are still fresh, and every render re-checks freshness
 * against the live clock (lib/format-eta.ts isFreshNow) - so if updates stop
 * for any reason, times disappear rather than linger.
 */

/** Steady-state poll. Served by the CDN, so this costs the server nothing per user. */
const POLL_MS = 15_000;
/**
 * A first-time visitor can arrive while the shared snapshot is still filling
 * in after a cold start. Poll fast until every live station has arrived.
 */
const FAST_POLL_MS = 2_000;
const MAX_FAST_POLLS = 15;
/**
 * Coming back (tab shown again, back online, restored from the back/forward
 * cache) after a while can find the shared snapshot cold too - if nobody else
 * was using the app, the server just started a fresh poll. Allow a few quick
 * retries then, so the times appear in seconds rather than after a full
 * POLL_MS. Only these user-return events grant them, so it can't loop.
 */
const RESUME_FAST_POLLS = 5;
/**
 * Backstop for a poll chain that silently died (a timer dropped while the
 * phone slept, say): if no poll has started for this long while the page is
 * visible, start one.
 */
const WATCHDOG_MS = 2 * POLL_MS;

const SNAPSHOT_KEY = "bts:arrivals:v1";
const CLOCK_OFFSET_KEY = "bts:clock-offset:v1";
/** Abandon a request that hasn't answered by now, so a hung connection can't stall polling. */
const REQUEST_TIMEOUT_MS = 10_000;

export type ArrivalsEntry = Arrivals;
export type ArrivalsMap = Record<string, ArrivalsEntry>;

interface ArrivalsStore {
  map: ArrivalsMap;
  /**
   * Server clock minus this device's clock, in ms. Freshness and countdowns
   * are measured on the server's clock (Date.now() + clockOffsetMs), so a
   * phone whose clock is minutes off neither hides every time nor shows old
   * ones as current.
   */
  clockOffsetMs: number;
  /** True once this tab has heard back from (or failed to reach) the server at least once. */
  settled: boolean;
  setMap: (map: ArrivalsMap) => void;
}

function readClockOffset(): number {
  try {
    const value = Number(window.localStorage.getItem(CLOCK_OFFSET_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * The server's current time per this response: its `Date` header, plus the
 * `Age` header when the CDN answered from a copy it has held for a while.
 * Null when the header is missing or unparseable.
 */
function serverNowFrom(res: Response): number | null {
  const date = Date.parse(res.headers.get("date") ?? "");
  if (Number.isNaN(date)) return null;
  const age = Number(res.headers.get("age") ?? 0);
  return date + (Number.isFinite(age) ? age * 1000 : 0);
}

function readSnapshot(clockOffsetMs: number): ArrivalsMap {
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
      if (isValidArrivals(value) && isFresh(value.timestamp, Date.now() + clockOffsetMs)) out[code] = value;
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
  clockOffsetMs: 0,
  settled: false,
  setMap: (map) => set({ map }),
}));

let started = false;

/** Seed from localStorage, fetch everything once, then poll. Idempotent. */
export function startArrivalsPolling() {
  if (started || typeof window === "undefined") return;
  started = true;

  const savedOffset = readClockOffset();
  const seeded = readSnapshot(savedOffset);
  useArrivalsStore.setState({ clockOffsetMs: savedOffset });
  if (Object.keys(seeded).length > 0) {
    useArrivalsStore.getState().setMap(seeded);
  }

  let fastPolls = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let lastPollStart = 0;

  function stop() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  /** Poll right now (unless one is already running), resetting the schedule. */
  function pollNow() {
    if (inFlight || document.hidden) return;
    stop();
    void poll();
  }

  /** The user is back: poll now, with a few quick retries if the snapshot is still filling. */
  function resume() {
    fastPolls = Math.min(fastPolls, MAX_FAST_POLLS - RESUME_FAST_POLLS);
    pollNow();
  }

  async function poll() {
    timer = null;
    inFlight = true;
    lastPollStart = Date.now();
    let complete = false;
    try {
      // `no-store` only skips the browser's own HTTP cache; the request is
      // still answered by the shared CDN copy, never by a per-user poll.
      const res = await fetch("/api/arrivals", {
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) {
        const json = (await res.json()) as { arrivals?: Record<string, unknown>; complete?: boolean };

        const serverNow = serverNowFrom(res);
        if (serverNow !== null) {
          const clockOffsetMs = serverNow - Date.now();
          useArrivalsStore.setState({ clockOffsetMs });
          try {
            window.localStorage.setItem(CLOCK_OFFSET_KEY, String(clockOffsetMs));
          } catch {
            // non-fatal
          }
        }
        const correctedNow = Date.now() + useArrivalsStore.getState().clockOffsetMs;

        const next: ArrivalsMap = {};
        for (const [code, data] of Object.entries(json.arrivals ?? {})) {
          if (isValidArrivals(data) && isFresh(data.timestamp, correctedNow)) next[code] = data;
        }
        // Replace, don't merge: a station missing from the shared snapshot
        // has nothing fresh, so whatever this tab held for it must go too.
        useArrivalsStore.getState().setMap(next);
        writeSnapshot(next);
        // "Complete" comes from the server: the latest shared poll finished.
        // Not a count of stations, so a station upstream never answers for
        // can't keep every tab in fast-poll mode.
        complete = json.complete === true;
      }
    } catch {
      // Network hiccup or timeout: nothing to replace the map with. What's
      // held stays only while still fresh - renders re-check its age on a
      // live clock.
    } finally {
      inFlight = false;
      if (!useArrivalsStore.getState().settled) useArrivalsStore.setState({ settled: true });
    }

    // The fast burst is a one-off for a cold first load, and ends for good
    // the first time the snapshot comes back complete. It is never reset:
    // otherwise one station that stays missing (its upstream call keeps
    // failing), or a long network outage, would burn a 2s-poll burst on every
    // cycle for every open tab. Outages retry at the normal POLL_MS cadence.
    if (complete) fastPolls = MAX_FAST_POLLS;
    // (resume() hands back a few of these for a cold snapshot after a return.)
    let delay = POLL_MS;
    if (!complete && fastPolls < MAX_FAST_POLLS) {
      fastPolls += 1;
      delay = FAST_POLL_MS;
    }
    if (!document.hidden) timer = setTimeout(poll, delay);
  }

  // Nobody can see a hidden tab's times, so stop polling there (battery,
  // data) and fetch straight away on return - the moment someone switches
  // back is exactly when they want fresh times. The same goes for coming
  // back online and for a page restored from the back/forward cache.
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : resume()));
  window.addEventListener("online", resume);
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) resume();
  });
  setInterval(() => {
    if (!document.hidden && !inFlight && Date.now() - lastPollStart > WATCHDOG_MS) pollNow();
  }, POLL_MS);

  void poll();
}
