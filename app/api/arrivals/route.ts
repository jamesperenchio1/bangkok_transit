import { NextResponse } from "next/server";
import { getSnapshot, pollInBackground, REFRESH_EVERY_MS } from "@/lib/arrivals-service";
import { liveStations } from "@/data/stations";
import { ageMs, isFresh, isValidArrivals, MAX_SHOW_AGE_MS } from "@/lib/bts";

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
 * A snapshot that is still filling (cold start), empty, or left over from a
 * quiet spell is cached only for a moment and never served stale.
 */
const FRESH_SECONDS = 10;
const STALE_WHILE_REVALIDATE_SECONDS = 10;
const FILLING_FRESH_SECONDS = 2;
/** The longest the CDN can hold a response (fresh + stale-while-revalidate). */
const MAX_EDGE_AGE_MS = (FRESH_SECONDS + STALE_WHILE_REVALIDATE_SECONDS) * 1000;

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
  let freshCount = 0;
  for (const code of codes) {
    const data = snapshot?.arrivals[code];
    // Dropped a CDN lifetime early, so even the edge's cached copy never
    // carries an entry past MAX_SHOW_AGE_MS.
    if (data && isValidArrivals(data) && ageMs(data.timestamp, now) < MAX_SHOW_AGE_MS - MAX_EDGE_AGE_MS) {
      arrivals[code] = data;
      if (isFresh(data.timestamp, now)) freshCount++;
    }
  }

  if (!snapshot || now - snapshot.fetchedAt > REFRESH_EVERY_MS) {
    // "Cold" = we positively know nothing current is being served: a
    // first-ever start, or a snapshot left over from a quiet spell (users
    // see last-known times with their age until this poll lands). Either
    // way it publishes progressively so live times appear within seconds.
    // A failed Redis read is not proof of that, so it never counts as cold
    // (and never publishes partial snapshots).
    pollInBackground(codes, !readFailed && freshCount === 0);
  }

  // "Complete" = the latest shared poll finished and is current. A snapshot
  // with nothing fresh in it (left over from a quiet spell) is not: it's
  // only cached for a moment, and clients keep fast-polling until the poll
  // it just triggered lands, instead of holding its last-known times for a
  // full cache cycle.
  const complete = freshCount > 0 && !snapshot?.partial;
  const cacheControl = complete
    ? `public, s-maxage=${FRESH_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`
    : `public, s-maxage=${FILLING_FRESH_SECONDS}`;

  return NextResponse.json(
    { arrivals, total: codes.length, complete },
    { headers: { "Cache-Control": cacheControl } },
  );
}
