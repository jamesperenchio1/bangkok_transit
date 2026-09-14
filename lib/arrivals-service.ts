import { after } from "next/server";
import { ageMs, CACHE_SERVE_MS, fetchUpstream, isFresh, isValidArrivals, type Arrivals } from "./bts";
import { readCached, readCachedMany, writeCached } from "./arrivals-cache";

/**
 * Shared read path for live arrivals, used by both the single-station route
 * (/api/arrivals/[code]) and the bulk route (/api/arrivals).
 *
 * Two distinct modes:
 *
 *  - `getArrivals` (single station) blocks if nothing is cached. One upstream
 *    call is ~2s, which is fine for a single station.
 *  - `snapshotMany` (bulk) NEVER touches upstream. It returns whatever memory
 *    or Redis already holds and lets the caller kick off `refreshMany` in the
 *    background. That is what makes the bulk response fast for every visitor
 *    instead of only for revisits - the request never waits on 61 upstream
 *    calls, and each station is written to Redis the moment it lands, so a
 *    client that retries quickly sees stations appear progressively.
 *
 * Tiered read: module memory (~0ms) -> Redis (~30ms, within CACHE_SERVE_MS) ->
 * upstream (slow, background only). A single-flight map collapses concurrent
 * fetches for the same station into one upstream call.
 */

const HOT_MS = 20_000;
/** A station younger than this is left alone by the background refresh. */
const REFRESH_AFTER_MS = 45_000;
/** Upstream calls the background refresh keeps in flight at once. */
const REFRESH_CONCURRENCY = 12;

const hotCache = new Map<string, { data: Arrivals; at: number }>();
const inFlight = new Map<string, Promise<Arrivals>>();

export interface ArrivalsResult {
  data: Arrivals;
  /** True when this copy is older than the freshness window. */
  stale: boolean;
}

function remember(code: string, data: Arrivals) {
  hotCache.set(code, { data, at: Date.now() });
}

/** Single-flight upstream fetch that also warms memory and Redis. */
function refreshOne(code: string): Promise<Arrivals> {
  let pending = inFlight.get(code);
  if (!pending) {
    pending = (async () => {
      const fresh = await fetchUpstream(code);
      remember(code, fresh);
      await writeCached(code, fresh);
      return fresh;
    })().finally(() => inFlight.delete(code));
    inFlight.set(code, pending);
  }
  return pending;
}

/**
 * Read one station, falling back to upstream only if neither memory nor Redis
 * has anything usable. Serves Redis up to CACHE_SERVE_MS old.
 */
export async function getArrivals(code: string): Promise<ArrivalsResult> {
  const hot = hotCache.get(code);
  if (hot && Date.now() - hot.at < HOT_MS) {
    return { data: hot.data, stale: !isFresh(hot.data.timestamp) };
  }

  const cachedRaw = await readCached(code);
  const cached = cachedRaw && isValidArrivals(cachedRaw) ? cachedRaw : null;
  if (cached && ageMs(cached.timestamp) < CACHE_SERVE_MS) {
    remember(code, cached);
    return { data: cached, stale: !isFresh(cached.timestamp) };
  }

  try {
    const fresh = await refreshOne(code);
    return { data: fresh, stale: false };
  } catch (err) {
    if (cached) {
      return { data: cached, stale: true };
    }
    throw err;
  }
}

/**
 * Read many stations with a single Redis round trip and no upstream calls at
 * all. Codes with nothing cached are simply absent from the result - the
 * caller is expected to schedule `refreshMany` to fill them in.
 */
export async function snapshotMany(codes: string[]): Promise<Record<string, ArrivalsResult>> {
  const out: Record<string, ArrivalsResult> = {};
  const missing: string[] = [];

  for (const code of codes) {
    const hot = hotCache.get(code);
    if (hot && Date.now() - hot.at < HOT_MS) {
      out[code] = { data: hot.data, stale: !isFresh(hot.data.timestamp) };
    } else {
      missing.push(code);
    }
  }

  if (missing.length > 0) {
    const cached = await readCachedMany(missing);
    for (const code of missing) {
      const value = cached[code];
      if (value && isValidArrivals(value) && ageMs(value.timestamp) < CACHE_SERVE_MS) {
        remember(code, value);
        out[code] = { data: value, stale: !isFresh(value.timestamp) };
      }
    }
  }

  return out;
}

/**
 * Refresh every station whose cached copy is missing or older than
 * REFRESH_AFTER_MS. Individual failures are dropped - a station with no data
 * simply stays missing until the next refresh. Intended to run inside
 * `after()` so it never delays a response.
 */
export async function refreshMany(codes: string[]): Promise<void> {
  const needs: string[] = [];
  for (const code of codes) {
    const hot = hotCache.get(code);
    if (!hot || ageMs(hot.data.timestamp) > REFRESH_AFTER_MS) {
      needs.push(code);
    }
  }

  let cursor = 0;
  async function worker() {
    while (cursor < needs.length) {
      const code = needs[cursor++];
      try {
        await refreshOne(code);
      } catch {
        // skip this station for now; the next refresh will retry it
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(REFRESH_CONCURRENCY, needs.length) }, () => worker()),
  );
}

/**
 * Convenience wrapper used by the bulk route's background refresh.
 *
 * Kicks the refresh off immediately *and* registers it with `after()`:
 * `after()` is what keeps the work alive in a serverless deployment once the
 * response has been sent, but it does not reliably fire under `next dev`
 * (Turbopack), so the direct call is what makes local development behave like
 * production. Both are safe to run together - `refreshMany` skips stations
 * that are already fresh and `refreshOne` collapses concurrent fetches for the
 * same station into a single upstream call, so nothing is fetched twice.
 */
export function refreshInBackground(codes: string[]): void {
  void refreshMany(codes);
  after(() => refreshMany(codes));
}
