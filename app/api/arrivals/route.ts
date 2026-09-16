import { NextRequest, NextResponse } from "next/server";
import { refreshInBackground, snapshotMany } from "@/lib/arrivals-service";
import { liveStations } from "@/data/stations";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

/**
 * Bulk arrivals for every station that has a live API, so the client can
 * paint times instantly for any station without a per-station round trip.
 *
 * This route never waits on upstream: it returns whatever memory/Redis already
 * holds and refreshes the missing or ageing stations in the background. That
 * keeps the response fast for a visitor with an empty cache, not just for
 * revisits. Stations still being fetched are simply absent from `arrivals`;
 * the client retries quickly until `total` codes have arrived.
 *
 * Response shape: `{ arrivals: { [code]: Arrivals }, stale: { [code]: bool },
 * total: number }`.
 */
export async function GET(req: NextRequest) {
  const { allowed, retryAfterSeconds } = await checkRateLimit(clientIp(req));
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      {
        status: 429,
        headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSeconds) },
      },
    );
  }

  const codes = liveStations.map((s) => s.code);

  // Same graceful-degradation posture as the single-station route: a
  // transient Redis error should surface as a partial/stale snapshot to
  // every polling client, not a hard 500 for all of them at once.
  try {
    const results = await snapshotMany(codes);

    // Warm everything missing or ageing once this response has been sent.
    refreshInBackground(codes);

    const arrivals: Record<string, unknown> = {};
    const stale: Record<string, boolean> = {};
    for (const [code, result] of Object.entries(results)) {
      arrivals[code] = result.data;
      if (result.stale) stale[code] = true;
    }

    // Never cached: a partial snapshot must not be held at the edge, or
    // clients would keep seeing the gap instead of the stations that have
    // since landed.
    return NextResponse.json(
      { arrivals, stale, total: codes.length },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { arrivals: {}, stale: {}, total: codes.length },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
