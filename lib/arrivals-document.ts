import { ageMs, isFresh, isShowable, isValidArrivals, MAX_SHOW_AGE_MS, type Arrivals } from "./bts";

/**
 * The one shared arrivals document every client reads
 * (`live.<domain>/arrivals.json`). Written by the poller Durable Object
 * (cloudflare/poller) and served from Cloudflare's CDN cache, so user
 * traffic never reaches the poller or the upstream API.
 *
 * Kept free of runtime-specific imports: both the Worker and the browser
 * bundle use these types.
 */
export interface ArrivalsDocument {
  arrivals: Record<string, Arrivals>;
  /** How many stations have live arrivals at all (BTS Sukhumvit + Silom). */
  total: number;
  /**
   * True once the latest full poll has landed and is current (or the
   * upstream is known to be down, so there is nothing to wait for). Clients
   * fast-poll until they see it - it is not a count of stations, so one
   * station upstream never answers for can't keep every client fast-polling.
   */
  complete: boolean;
  /** Health of the upstream API, as the poller sees it. */
  status?: UpstreamStatus;
  /** What the latest poll did - diagnostics only, ignored by the client. */
  poll?: PollReport;
}

/**
 * - ok: the latest poll got an answer from every station it tried.
 * - degraded: some stations failed (or one whole cycle did, not yet "down").
 * - down: whole cycles in a row failed; the poller has backed off to probing.
 */
export type UpstreamState = "ok" | "degraded" | "down";

export interface Incident {
  /** When the upstream started failing (ISO, UTC). */
  start: string;
  /** When it recovered, or null while still down. */
  end: string | null;
}

export interface UpstreamStatus {
  state: UpstreamState;
  /** When `state` began (ISO, UTC). */
  since: string;
  /** Last time any station answered (ISO, UTC), or null if never seen. */
  lastSuccessAt: string | null;
  /** Recent outages, newest first (bounded). */
  incidents: Incident[];
}

export interface PollReport {
  /** When the poll finished (ISO, UTC). */
  at: string;
  /** How long it took. */
  ms: number;
  /** Stations it tried. */
  polled: number;
  /** Stations that answered. */
  ok: number;
  /** Stations that didn't, with why: an HTTP status, "timeout", "deadline", "skipped", ... */
  failed: Record<string, string>;
}

/**
 * How long the edge may serve one copy. The client counts each ETA down
 * against its own (server-corrected) clock, so this delay is invisible.
 * A document that is still filling is cached only for a moment; one that
 * says the upstream is down changes rarely, so it is cached longer.
 */
export const EDGE_FRESH_SECONDS = 10;
export const EDGE_FILLING_SECONDS = 2;
export const EDGE_DOWN_SECONDS = 30;
/**
 * If the origin (R2) errors, the edge may keep serving its last copy for
 * this long rather than failing every client. Clients show each reading's
 * age (from `Date` + `Age`), so a copy served this way is still honest.
 * Not applied while filling: a half-built document shouldn't linger.
 */
export const EDGE_STALE_IF_ERROR_SECONDS = 300;

/**
 * Previous readings carried over, then this poll's on top. A station whose
 * call failed keeps its last reading (shown with its age) until it passes
 * MAX_SHOW_AGE_MS, rather than blanking.
 */
export function mergeArrivals(
  previous: Record<string, Arrivals>,
  fresh: Record<string, Arrivals>,
  now = Date.now(),
): Record<string, Arrivals> {
  const out: Record<string, Arrivals> = {};
  for (const [code, data] of Object.entries(previous)) {
    if (isValidArrivals(data) && isShowable(data.timestamp, now)) out[code] = data;
  }
  return Object.assign(out, fresh);
}

/**
 * The published document plus the Cache-Control to store it with. Entries
 * are dropped one edge lifetime early, so even a cached copy never carries
 * an entry past MAX_SHOW_AGE_MS.
 */
export function buildArrivalsDocument(
  merged: Record<string, Arrivals>,
  codes: string[],
  pollComplete: boolean,
  now = Date.now(),
  poll?: PollReport,
  status?: UpstreamStatus,
): { document: ArrivalsDocument; cacheControl: string } {
  const down = status?.state === "down";
  const arrivals: Record<string, Arrivals> = {};
  let freshCount = 0;
  for (const code of codes) {
    const data = merged[code];
    if (data && ageMs(data.timestamp, now) < MAX_SHOW_AGE_MS - (down ? EDGE_DOWN_SECONDS : EDGE_FRESH_SECONDS) * 1000) {
      arrivals[code] = data;
      if (isFresh(data.timestamp, now)) freshCount++;
    }
  }
  const complete = (pollComplete && freshCount > 0) || down;
  const seconds = down ? EDGE_DOWN_SECONDS : complete ? EDGE_FRESH_SECONDS : EDGE_FILLING_SECONDS;
  return {
    document: { arrivals, total: codes.length, complete, ...(status && { status }), ...(poll && { poll }) },
    // max-age=0: browsers always come back to the edge; s-maxage: the edge
    // holds one copy for everybody.
    cacheControl: `public, max-age=0, s-maxage=${seconds}${complete ? `, stale-if-error=${EDGE_STALE_IF_ERROR_SECONDS}` : ""}`,
  };
}
