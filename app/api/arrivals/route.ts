import { NextResponse } from "next/server";
import { getSnapshot, pollInBackground, REFRESH_EVERY_MS } from "@/lib/arrivals-service";
import { liveStations } from "@/data/stations";
import { isFresh, isValidArrivals } from "@/lib/bts";

/**
 * Live arrivals for every BTS station, as one shared document. This is the
 * only arrivals endpoint: every user reads the same response, almost always
 * straight from the CDN, and user traffic never causes upstream calls of its
 * own - see lib/arrivals-service.ts for the single shared poll behind it.
 *
 * Only fresh data is ever returned (lib/bts.ts FRESH_FOR_MS): a station with
 * nothing fresh is simply absent, and the client shows "unavailable" for it
 * rather than old times.
 *
 * Response shape: `{ arrivals: { [code]: Arrivals }, total: number }`.
 */

/**
 * CDN caching is what turns "one poll" into "one poll for everybody": the
 * edge answers every user and only re-asks this function about once per
 * FRESH window per region, however many users there are. The client counts
 * each ETA down against its own clock, so this delay is invisible to riders.
 * A partial snapshot (cold start, still filling) is cached only for a moment
 * and never served stale, so clients see stations land within seconds.
 */
const FRESH_SECONDS = 10;
const STALE_WHILE_REVALIDATE_SECONDS = 10;
const PARTIAL_FRESH_SECONDS = 2;

export async function GET() {
  const codes = liveStations.map((s) => s.code);

  let snapshot = null;
  try {
    snapshot = await getSnapshot();
  } catch {
    // Redis hiccup: answer with an empty (briefly cached) snapshot below
    // rather than failing every user at once.
  }

  const arrivals: Record<string, unknown> = {};
  for (const code of codes) {
    const data = snapshot?.arrivals[code];
    if (data && isValidArrivals(data) && isFresh(data.timestamp)) arrivals[code] = data;
  }
  const held = Object.keys(arrivals).length;

  if (!snapshot || Date.now() - snapshot.fetchedAt > REFRESH_EVERY_MS) {
    // "Cold" = nothing fresh to serve: a first-ever start, or a snapshot left
    // over from a quiet night. Either way every user sees empty times until
    // this poll lands, so it publishes progressively.
    pollInBackground(codes, held === 0);
  }

  const complete = held >= codes.length;
  return NextResponse.json(
    { arrivals, total: codes.length },
    {
      headers: {
        "Cache-Control": complete
          ? `public, s-maxage=${FRESH_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`
          : `public, s-maxage=${PARTIAL_FRESH_SECONDS}`,
      },
    },
  );
}
