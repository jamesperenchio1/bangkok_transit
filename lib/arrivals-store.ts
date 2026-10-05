"use client";

import { create } from "zustand";
import { ageMs, isShowable, isValidArrivals, type Arrivals } from "./bts";
import { ARRIVALS_URL } from "./arrivals-url";

/**
 * One shared arrivals store for the whole app, fed by the one shared
 * snapshot (ARRIVALS_URL, lib/arrivals-url.ts). Seeded from localStorage on mount so times are on
 * screen the instant a station card opens, then polled for as long as the
 * page is open - minutes or days.
 *
 * If updates stall, the last-known times stay on screen (counted down, with
 * their age shown) rather than disappearing - a slightly old time beats an
 * empty card. Only entries past MAX_SHOW_AGE_MS are dropped: in the seed,
 * on each poll, and on every render (lib/use-arrivals.ts).
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
   * Server clock minus this device's clock, in ms, from the latest response.
   * Ages and countdowns are measured on the server's clock (see serverNow),
   * so on a phone whose clock is minutes off the countdowns are still right
   * and data is still flagged live or last-known correctly.
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

/**
 * The latest server time seen, pinned to the monotonic clock. Unlike the
 * wall-clock offset, it can't be thrown off by the phone's clock changing
 * mid-session (an NTP sync, a timezone or manual change).
 */
let anchor: { serverMs: number; perfMs: number } | null = null;

/**
 * Best estimate of the server's current time: the later of the wall clock
 * corrected by the measured offset, and the monotonic clock run forward from
 * the last server response. Taking the later of two independent estimates
 * is deliberately conservative - a device clock jump or a monotonic clock
 * that paused while the phone slept can each only make data look *older*
 * (flagged as last-known, or dropped past MAX_SHOW_AGE_MS, a little early),
 * never newer than it is.
 */
export function serverNow(): number {
  const wall = Date.now() + useArrivalsStore.getState().clockOffsetMs;
  const mono = anchor ? anchor.serverMs + (performance.now() - anchor.perfMs) : -Infinity;
  return Math.max(wall, mono);
}

function readSnapshot(clockOffsetMs: number): ArrivalsMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // A saved offset may be out of date (the phone's clock could have been
    // changed since), so it may only make the check stricter: an entry must
    // be recent enough by the device clock *and* by the saved offset. Worst
    // case the seed is dropped and times appear with the first poll instead.
    const now = Math.max(Date.now(), Date.now() + clockOffsetMs);
    const out: ArrivalsMap = {};
    for (const [code, value] of Object.entries(parsed as Record<string, unknown>)) {
      // A persisted entry can predate a schema change or just be corrupted -
      // validating before trusting its shape is what keeps the page alive.
      if (isValidArrivals(value) && isShowable(value.timestamp, now)) out[code] = value;
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

  // The saved offset only screens the seed (see readSnapshot). Until this
  // session's first response measures it afresh, render-time checks use the
  // stricter of the device clock and the saved offset too.
  const savedOffset = readClockOffset();
  const seeded = readSnapshot(savedOffset);
  useArrivalsStore.setState({ clockOffsetMs: Math.max(0, savedOffset) });
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
    let answered = false;
    try {
      // `no-store` only skips the browser's own HTTP cache; the request is
      // still answered by the shared CDN copy, never by a per-user poll.
      const res = await fetch(ARRIVALS_URL, {
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) {
        const json = (await res.json()) as { arrivals?: Record<string, unknown>; complete?: boolean };
        answered = true;

        const measured = serverNowFrom(res);
        if (measured !== null) {
          anchor = { serverMs: measured, perfMs: performance.now() };
          const clockOffsetMs = measured - Date.now();
          useArrivalsStore.setState({ clockOffsetMs });
          try {
            window.localStorage.setItem(CLOCK_OFFSET_KEY, String(clockOffsetMs));
          } catch {
            // non-fatal
          }
        }
        const correctedNow = serverNow();

        // Merge, keeping the newer reading per station, rather than
        // replacing: an empty or partial answer (a Redis error, a cold-start
        // snapshot still filling) must not wipe last-known times this tab
        // already holds. Anything past MAX_SHOW_AGE_MS is dropped here.
        const next: ArrivalsMap = {};
        const held = useArrivalsStore.getState().map;
        for (const [code, data] of Object.entries(held)) {
          if (isShowable(data.timestamp, correctedNow)) next[code] = data;
        }
        for (const [code, data] of Object.entries(json.arrivals ?? {})) {
          if (!isValidArrivals(data) || !isShowable(data.timestamp, correctedNow)) continue;
          const current = next[code];
          if (!current || ageMs(data.timestamp, correctedNow) <= ageMs(current.timestamp, correctedNow)) {
            next[code] = data;
          }
        }
        useArrivalsStore.getState().setMap(next);
        writeSnapshot(next);
        // "Complete" comes from the server: the latest shared poll finished.
        // Not a count of stations, so a station upstream never answers for
        // can't keep every tab in fast-poll mode.
        complete = json.complete === true;
      }
    } catch {
      // Network hiccup or timeout: keep showing what's held (its age is shown
      // on the card); renders still drop anything past MAX_SHOW_AGE_MS.
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
    // Only a server that answered with a still-filling snapshot earns a quick
    // retry; a failed request (offline, timeout, error) waits the normal
    // POLL_MS, so an outage never burns through quick retries.
    let delay = POLL_MS;
    if (answered && !complete && fastPolls < MAX_FAST_POLLS) {
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
