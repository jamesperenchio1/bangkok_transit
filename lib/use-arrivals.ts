"use client";

/**
 * Client-side live arrivals.
 *
 * Three things keep this feeling instant without hammering anything:
 *
 *  - a station's last payload is seeded synchronously from localStorage, so
 *    opening a station you've seen before never shows a spinner;
 *  - ETAs are counted down locally every second from `dataAt`, so the numbers
 *    move continuously between network requests — which is what lets the poll
 *    interval be as slow as 60s while still reading as live;
 *  - polling stops while the tab is hidden or the device is offline, and resumes
 *    with an immediate refresh.
 *
 * Requests go to /api/arrivals/[code], never to the upstream directly — it sends
 * no CORS header, so a browser fetch to it is blocked.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isFresh, type Arrivals } from "@/lib/bts";

const POLL_MS = 60_000;
const TICK_MS = 1_000;
const STORAGE_PREFIX = "bts:arr:";

/** Shared across hook instances so re-opening a station is instant. */
const memory = new Map<string, Arrivals>();

function readStored(code: string): Arrivals | null {
  const hit = memory.get(code);
  if (hit) return hit;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + code);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Arrivals;
    memory.set(code, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(code: string, data: Arrivals) {
  memory.set(code, data);
  try {
    window.localStorage.setItem(STORAGE_PREFIX + code, JSON.stringify(data));
  } catch {
    // Private mode or quota exceeded — the in-memory copy still works.
  }
}

async function load(code: string, signal?: AbortSignal): Promise<Arrivals | null> {
  try {
    const res = await fetch(`/api/arrivals/${code}`, {
      signal,
      // The route sends `stale-while-revalidate`, which applies to the browser's
      // own HTTP cache as well as the CDN — without this the browser answers
      // from its stale copy and never reaches the network, so the countdown
      // silently freezes at whatever it last saw. Skipping the local cache costs
      // nothing: the CDN still absorbs the request, and localStorage is already
      // the instant-paint layer.
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Arrivals;
    writeStored(code, data);
    return data;
  } catch {
    return null;
  }
}

/**
 * Warm a station ahead of the user opening it. Called on hover/touchstart and
 * for a handful of likely stations on load — never for the whole network, which
 * is the burst pattern the upstream rate-limits.
 */
export function prefetchArrivals(code: string) {
  const known = readStored(code);
  if (known && isFresh(known.dataAt)) return;
  void load(code);
}

export interface UseArrivals {
  data: Arrivals | null;
  /** Ticks every second; ETAs are derived from this so they count down smoothly. */
  now: number;
  /** False when the payload is too old for its times to mean anything. */
  fresh: boolean;
  /** Nothing at all to show yet — a previously-viewed station never hits this. */
  loading: boolean;
}

export function useArrivals(code: string | null): UseArrivals {
  const [data, setData] = useState<Arrivals | null>(() => (code ? readStored(code) : null));
  const [now, setNow] = useState(() => Date.now());
  const abort = useRef<AbortController | null>(null);

  // Swap to the new station's stored copy immediately on change, so the panel
  // repaints with that station's data instead of briefly showing the last one's.
  const shown = data && code && data.code === code ? data : code ? readStored(code) : null;

  const refresh = useCallback(async () => {
    if (!code) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    const next = await load(code, controller.signal);
    if (controller.signal.aborted) return;
    if (next) setData(next);
  }, [code]);

  useEffect(() => {
    if (!code) return;
    // Fetch-on-mount is the intended behaviour: these are live external times,
    // not derivable state. The setState inside `refresh` runs after the fetch
    // resolves, not synchronously, and is guarded by an AbortController.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();

    const poll = setInterval(() => {
      if (document.hidden || !navigator.onLine) return;
      void refresh();
    }, POLL_MS);

    // Coming back to the tab or regaining connectivity should not wait out the
    // remainder of the poll interval — whatever is on screen is stale by then.
    const wake = () => {
      if (!document.hidden && navigator.onLine) void refresh();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);

    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      abort.current?.abort();
    };
  }, [code, refresh]);

  // Drives the countdown. Cheap: one setState per second, and only while a
  // station is actually open.
  useEffect(() => {
    if (!code) return;
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(tick);
  }, [code]);

  return {
    data: shown,
    now,
    fresh: shown ? isFresh(shown.dataAt, now) : false,
    // Derived rather than tracked: "loading" is exactly "nothing to render yet",
    // and holding it in state meant setting state synchronously inside an effect.
    loading: !shown,
  };
}
