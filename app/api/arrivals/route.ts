import { NextResponse } from "next/server";
import { getSnapshot, pollInBackground, REFRESH_EVERY_MS } from "@/lib/arrivals-service";
import { liveStations } from "@/data/stations";
import { ageMs, CACHE_SERVE_MS, isFresh, isValidArrivals } from "@/lib/bts";

/**
 * Live arrivals for every BTS station, as one shared document. This is the
 * only arrivals endpoint: every user reads the same response, almost always
 * straight from the CDN, and user traffic never causes upstream calls of its
 * own - see lib/arrivals-service.ts for the single shared poll behind it.
 *
 * Response shape: `{ arrivals: { [code]: Arrivals }, stale: { [code]: bool },
 * total: number }`.
 */

/**
 * CDN caching is what turns "one poll" into "one poll for everybody": with
 * stale-while-revalidate the edge answers every user instantly and only
 * re-asks this function about once per FRESH window per region, however many
 * users there are. Arrivals stay fresh for ~90s (lib/bts.ts FRESH_FOR_MS) and
 * the client counts each ETA down against its own clock, so this delay is
 * invisible to riders. A partial snapshot (cold start, still filling) is
 * cached only briefly so clients see stations land within a couple of
 * seconds - but still from the CDN, not one request per user.
 */
const FRESH_SECONDS = 10;
const PARTIAL_FRESH_SECONDS = 2;
const STALE_WHILE_REVALIDATE_SECONDS = 60;

export async function GET() {
  const codes = liveStations.map((s) => s.code);

  let snapshot = null;
  try {
    snapshot = await getSnapshot();
  } catch {
    // Redis hiccup: answer with an empty (briefly cached) snapshot below
    // rather than failing every user at once.
  }

  if (!snapshot || Date.now() - snapshot.fetchedAt > REFRESH_EVERY_MS) {
    pollInBackground(codes);
  }

  const arrivals: Record<string, unknown> = {};
  const stale: Record<string, boolean> = {};
  for (const code of codes) {
    const data = snapshot?.arrivals[code];
    if (!data || !isValidArrivals(data) || ageMs(data.timestamp) >= CACHE_SERVE_MS) continue;
    arrivals[code] = data;
    if (!isFresh(data.timestamp)) stale[code] = true;
  }

  const complete = Object.keys(arrivals).length >= codes.length;
  const fresh = complete ? FRESH_SECONDS : PARTIAL_FRESH_SECONDS;
  return NextResponse.json(
    { arrivals, stale, total: codes.length },
    {
      headers: {
        "Cache-Control": `public, s-maxage=${fresh}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`,
      },
    },
  );
}
