import { after } from "next/server";
import { ageMs, CACHE_SERVE_MS, fetchUpstream, isFresh, isValidArrivals, type Arrivals } from "./bts";
import { readCached, writeCached } from "./arrivals-cache";

/**
 * Shared read path for live arrivals, used by both the single-station route
 * (/api/arrivals/[code]) and the bulk route (/api/arrivals).
 *
 * Tiered: module memory (~0ms) -> Redis last-known-good (~30ms, served as long
 * as it's within CACHE_SERVE_MS) -> upstream (~2-6s, worse under load). The
 * keep-warm workflow refreshes every station's Redis entry on a fixed interval,
 * so under normal operation this never blocks on upstream - that fallback only
 * fires if the warm job has actually stopped running. A single-flight map
 * collapses concurrent misses for the same station into one upstream call.
 * `cache: "no-store"` on fetchUpstream plus the routes' own headers keep the
 * browser from serving a stale HTTP-cached response and freezing the countdown.
 */

const HOT_MS = 20_000;
const hotCache = new Map<string, { data: Arrivals; at: number }>();
const inFlight = new Map<string, Promise<Arrivals>>();

export interface ArrivalsResult {
  data: Arrivals;
  /** True when the upstream failed and this is the last-known-good copy. */
  stale: boolean;
}

export async function getArrivals(code: string): Promise<ArrivalsResult> {
  const hot = hotCache.get(code);
  if (hot && Date.now() - hot.at < HOT_MS) {
    return { data: hot.data, stale: !isFresh(hot.data.timestamp) };
  }

  const cachedRaw = await readCached(code);
  const cached = cachedRaw && isValidArrivals(cachedRaw) ? cachedRaw : null;
  if (cached && ageMs(cached.timestamp) < CACHE_SERVE_MS) {
    hotCache.set(code, { data: cached, at: Date.now() });
    return { data: cached, stale: !isFresh(cached.timestamp) };
  }

  let pending = inFlight.get(code);
  if (!pending) {
    pending = fetchUpstream(code).finally(() => inFlight.delete(code));
    inFlight.set(code, pending);
  }

  try {
    const fresh = await pending;
    hotCache.set(code, { data: fresh, at: Date.now() });
    after(() => writeCached(code, fresh));
    return { data: fresh, stale: false };
  } catch (err) {
    if (cached) {
      return { data: cached, stale: true };
    }
    throw err;
  }
}

/**
 * Fetch many stations at once with bounded concurrency. Individual failures
 * are dropped rather than failing the whole batch - a station with no data
 * yet simply won't appear in the map.
 */
export async function getManyArrivals(
  codes: string[],
  concurrency = 8,
): Promise<Record<string, ArrivalsResult>> {
  const out: Record<string, ArrivalsResult> = {};
  let cursor = 0;

  async function worker() {
    while (cursor < codes.length) {
      const code = codes[cursor++];
      try {
        out[code] = await getArrivals(code);
      } catch {
        // skip this station for now; the next poll will retry it
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, codes.length) }, () => worker()),
  );

  return out;
}
