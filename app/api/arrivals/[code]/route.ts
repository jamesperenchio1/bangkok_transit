/**
 * Live arrivals for one BTS station, proxied and cached.
 *
 * Exists because the upstream cannot be called from the browser (no CORS header),
 * is slow when cold (~6s), and rate-limits bursts (20 concurrent requests -> 429).
 *
 * Read path, fastest first:
 *   1. module memory, if younger than HOT_MS          ~0ms
 *   2. Upstash last-known-good, if still renderable    ~30ms  (revalidates behind the response)
 *   3. upstream                                        ~6s
 *
 * A CDN sits in front of all of it, and the client holds its own localStorage copy,
 * so a warm station is effectively instant for everyone.
 */
import { after } from "next/server";
import { LIVE_CODES, UPSTREAM, isFresh, normalizeArrivals, type Arrivals } from "@/lib/bts";
import { readCached, writeCached } from "@/lib/arrivals-cache";

/** Below this age the in-process copy is served without touching Redis or upstream. */
const HOT_MS = 20_000;

/**
 * Measured upstream latency is 2-4s cold, spiking past 8s while it is throttling.
 * Generous enough to ride out a spike rather than turning it into a failed request;
 * only reached when there is no cached value at all to fall back on.
 */
const UPSTREAM_TIMEOUT_MS = 12_000;

/** Must exceed UPSTREAM_TIMEOUT_MS or the platform kills the call before it returns. */
export const maxDuration = 20;

const memory = new Map<string, Arrivals>();

/**
 * One upstream call per station at a time. Without this, a burst of requests for
 * the same station on a cold cache would fan out into concurrent upstream calls
 * and trip the 429.
 */
const inFlight = new Map<string, Promise<Arrivals | null>>();

async function fetchUpstream(code: string): Promise<Arrivals | null> {
  const existing = inFlight.get(code);
  if (existing) return existing;

  const task = (async () => {
    try {
      const res = await fetch(`${UPSTREAM}/arrivals/${code}`, {
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        // We do our own caching; Next's fetch cache would fight it.
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`upstream ${res.status}`);

      const data = normalizeArrivals(await res.json(), code);
      memory.set(code, data);
      await writeCached(code, data);
      return data;
    } catch (err) {
      console.error(`arrivals ${code} upstream failed`, err);
      return null;
    } finally {
      inFlight.delete(code);
    }
  })();

  inFlight.set(code, task);
  return task;
}

function json(data: Arrivals, { hit, maxAge }: { hit: string; maxAge: number }) {
  return Response.json(data, {
    headers: {
      // Lets the CDN serve every other user from the edge, and keep serving
      // during revalidation rather than stampeding back to this function.
      "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=60`,
      "X-Cache": hit,
    },
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const code = (await ctx.params).code?.toUpperCase() ?? "";

  // Reject unknown codes here so junk and scanners never reach upstream. The set
  // is exhaustive: it was derived by probing every plausible code (see
  // scripts/extract-bts-schematic.ts), and includes N6, which serves arrivals
  // despite having no station on the map.
  if (!LIVE_CODES.has(code)) {
    return Response.json(
      { error: "unknown station code", code },
      { status: 404, headers: { "Cache-Control": "public, s-maxage=3600" } }
    );
  }

  const hot = memory.get(code);
  if (hot && Date.now() - hot.dataAt < HOT_MS) {
    return json(hot, { hit: "memory", maxAge: 20 });
  }

  const cached = hot ?? (await readCached(code));

  // Still recent enough for its ETAs to mean something: answer now, refresh behind
  // the response so the next caller gets newer data without anyone having waited.
  if (cached && isFresh(cached.dataAt)) {
    memory.set(code, cached);
    after(() => fetchUpstream(code));
    // Distinguish the tier that actually served it — otherwise a memory hit and
    // a Redis hit are indistinguishable when diagnosing latency.
    return json(cached, { hit: hot ? "memory-aging" : "store", maxAge: 10 });
  }

  const fresh = await fetchUpstream(code);
  if (fresh) return json(fresh, { hit: "upstream", maxAge: 20 });

  // Upstream is down or throttling. Stale times are flagged so the client shows
  // the station without pretending the numbers are current.
  if (cached) return json({ ...cached, stale: true }, { hit: "stale", maxAge: 5 });

  return Response.json(
    { error: "arrivals unavailable", code },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}
