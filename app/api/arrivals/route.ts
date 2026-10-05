import { NextResponse } from "next/server";
import { getSnapshot, pollInBackground, REFRESH_EVERY_MS } from "@/lib/arrivals-service";
import { liveStations } from "@/data/stations";
import { isShowable, isValidArrivals } from "@/lib/bts";

/**
 * Live arrivals for every BTS station, as one shared document. This is the
 * only arrivals endpoint: every user reads the same response, almost always
 * straight from the CDN, and user traffic never causes upstream calls of its
 * own - see lib/arrivals-service.ts for the single shared poll behind it.
 *
 * Each station's latest reading is returned until it passes MAX_SHOW_AGE_MS
 * (lib/bts.ts); the client shows its age when it isn't live, rather than
 * blanking it.
 *
 * Response shape: `{ arrivals: { [code]: Arrivals }, total: number,
 * complete: boolean }` - `complete` means the latest shared poll has
 * finished (not that every station answered; one that upstream never
 * answers for must not keep every client fast-polling).
 */

/**
 * CDN caching is what turns "one poll" into "one poll for everybody": the
 * edge answers every user and only re-asks this function about once per
 * FRESH window per region, however many users there are. The client counts
 * each ETA down against its own clock, so this delay is invisible to riders.
 * A snapshot that is still filling (cold start) or empty is
 * cached only for a moment and never served stale.
 */
const FRESH_SECONDS = 10;
const STALE_WHILE_REVALIDATE_SECONDS = 10;
const FILLING_FRESH_SECONDS = 2;

export async function GET() {
  const codes = liveStations.map((s) => s.code);

  let snapshot = null;
  let readFailed = false;
  try {
    snapshot = await getSnapshot();
  } catch {
    // Redis hiccup: answer with an empty (briefly cached) snapshot below
    // rather than failing every user at once.
    readFailed = true;
  }

  const now = Date.now();
  const arrivals: Record<string, unknown> = {};
  for (const code of codes) {
    const data = snapshot?.arrivals[code];
    if (data && isValidArrivals(data) && isShowable(data.timestamp, now)) arrivals[code] = data;
  }
  const held = Object.keys(arrivals).length;

  if (!snapshot || now - snapshot.fetchedAt > REFRESH_EVERY_MS) {
    // "Cold" = we positively know there is nothing to serve: a
    // first-ever start, or a snapshot left over from a quiet night. Then
    // every user sees empty times until this poll lands, so it publishes
    // progressively. A failed Redis read is not proof of that, so it never
    // counts as cold (and never publishes partial snapshots).
    pollInBackground(codes, !readFailed && held === 0);
  }

  const complete = held > 0 && !snapshot?.partial;
  const cacheControl = complete
    ? `public, s-maxage=${FRESH_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`
    : `public, s-maxage=${FILLING_FRESH_SECONDS}`;

  return NextResponse.json(
    { arrivals, total: codes.length, complete },
    { headers: { "Cache-Control": cacheControl } },
  );
}
