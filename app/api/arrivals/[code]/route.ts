import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { ageMs, CACHE_SERVE_MS, fetchUpstream, isFresh, isValidArrivals, type Arrivals } from "@/lib/bts";
import { readCached, writeCached } from "@/lib/arrivals-cache";
import { stationsByCode } from "@/data/stations";

/**
 * Tiered read path: module memory (~0ms) -> Redis last-known-good (~30ms,
 * served as long as it's within CACHE_SERVE_MS) -> upstream (~2-6s, worse
 * under load). The keep-warm workflow refreshes every station's Redis entry
 * on a fixed interval, so under normal operation this route never blocks on
 * upstream at all - that fallback only fires if the warm job has actually
 * stopped running. A single-flight map collapses concurrent misses for the
 * same station into one upstream call. `cache: "no-store"` on fetchUpstream
 * plus this route's own headers keep the browser from serving a stale
 * HTTP-cached response and freezing the countdown.
 */

const HOT_MS = 20_000;
const hotCache = new Map<string, { data: Arrivals; at: number }>();
const inFlight = new Map<string, Promise<Arrivals>>();

async function getArrivals(code: string): Promise<{ data: Arrivals; stale: boolean }> {
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const station = stationsByCode.get(code);

  if (!station || !station.hasLiveArrivals) {
    return NextResponse.json(
      { error: "Live arrivals are only available for BTS stations." },
      { status: 404 },
    );
  }

  try {
    const { data, stale } = await getArrivals(code);
    return NextResponse.json(
      { ...data, stale },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not reach the arrivals service." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
