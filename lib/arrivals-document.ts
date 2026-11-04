import {
  ageMs,
  isFresh,
  isShowable,
  isValidArrivals,
  MAX_SHOW_AGE_MS,
  type ArrivalPlatform,
  type Arrivals,
} from "./bts";

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

function parseUtc(iso: string): number {
  return Date.parse(iso.endsWith("Z") ? iso : `${iso}Z`);
}

/**
 * Same grace as lib/format-eta.ts (PLATFORM_GRACE_MS) - not imported from
 * there because that module's types reach into browser-only code, and this
 * one must typecheck in the Worker.
 */
const DEPARTED_GRACE_MS = 60_000;

function etaOf(train: { eta_minutes?: unknown; eta_precise?: unknown }): number | null {
  for (const v of [train.eta_precise, train.eta_minutes]) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** Trains not yet gone per their own ETA against `now` (no ETA: kept, as in the UI). */
function stillComing(train: { eta_minutes?: unknown; eta_precise?: unknown }, readingTs: number, now: number): boolean {
  const eta = etaOf(train);
  return eta === null || readingTs + eta * 60_000 - now >= -DEPARTED_GRACE_MS;
}

/**
 * `previous`'s trains for one platform, re-expressed against `fresh`'s
 * timestamp (ETAs are minutes from the reading's own time) with the ones
 * that have already left dropped. Empty when nothing usable remains.
 */
function rebasedTrains(previous: ArrivalPlatform, fromTs: number, toTs: number, now: number) {
  const shiftMin = (toTs - fromTs) / 60_000;
  return previous.trains
    .map((train) => {
      const eta = etaOf(train);
      if (eta === null) return null;
      const rebased = { ...train, eta_minutes: (typeof train.eta_minutes === "number" ? train.eta_minutes : eta) - shiftMin };
      if (typeof train.eta_precise === "number") rebased.eta_precise = train.eta_precise - shiftMin;
      return rebased;
    })
    .filter((train): train is NonNullable<typeof train> => train !== null)
    .filter((train) => stillComing(train, toTs, now));
}

/**
 * Never let a newer but emptier reading erase what we already knew. Upstream
 * sometimes answers with a platform that lists no trains (or leaves a
 * direction out) a minute after listing some; the older trains are still the
 * best information we have, so they stay - re-timed to the new reading and
 * marked `carried_from` so the UI can say how old they are. A genuine "not
 * running" answer always wins, and nothing outlives MAX_SHOW_AGE_MS because
 * the caller still drops old readings.
 */
export function carryOverPlatforms(previous: Arrivals | undefined, fresh: Arrivals, now = Date.now()): Arrivals {
  if (!previous || fresh.service_active === false) return fresh;
  const prevTs = parseUtc(previous.timestamp);
  const freshTs = parseUtc(fresh.timestamp);
  if (Number.isNaN(prevTs) || Number.isNaN(freshTs) || prevTs >= freshTs) return fresh;
  if (!isShowable(previous.timestamp, now)) return fresh;

  const key = (p: ArrivalPlatform) => p.platform || p.direction_key;
  const platforms = fresh.platforms.map((p) => p);
  let changed = false;
  for (const old of previous.platforms) {
    const index = platforms.findIndex((p) => key(p) === key(old));
    const current = index >= 0 ? platforms[index] : undefined;
    if (current && current.trains.some((t) => stillComing(t, freshTs, now))) continue;
    const trains = rebasedTrains(old, prevTs, freshTs, now);
    if (trains.length === 0) continue;
    const carried = { ...old, trains, carried_from: old.carried_from ?? previous.timestamp };
    if (index >= 0) platforms[index] = carried;
    else platforms.push(carried);
    changed = true;
  }
  return changed ? { ...fresh, platforms } : fresh;
}

/**
 * Previous readings carried over, then this poll's on top. A station whose
 * call failed keeps its last reading (shown with its age) until it passes
 * MAX_SHOW_AGE_MS, rather than blanking; one whose call succeeded but listed
 * fewer trains keeps the ones it dropped (see carryOverPlatforms).
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
  for (const [code, data] of Object.entries(fresh)) out[code] = carryOverPlatforms(out[code], data, now);
  return out;
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
