/**
 * Client for the undocumented bts-api.topmile.com live-arrivals API.
 *
 * Has no Access-Control-Allow-Origin header, so it can never be called from
 * the browser directly — all access goes through the shared snapshot behind
 * /api/arrivals.
 *
 * Coverage is BTS Sukhumvit + Silom only; other codes (or Gold/Yellow/Pink)
 * return 400/"unavailable". `timestamp` in the payload is UTC despite
 * looking like a naive local time — parse it as UTC or every countdown will
 * be off by 7 hours (Asia/Bangkok).
 */
export const UPSTREAM = "https://bts-api.topmile.com";
export const UPSTREAM_TIMEOUT_MS = 8_000;

/**
 * Arrivals younger than this are "live". Older ones are still shown - a
 * slightly old time, counted down against the clock, beats an empty card -
 * just with their age flagged ("Updated 3 min ago"). Comfortably above the
 * normal worst-case age (20s shared poll + 10s CDN + 15s client poll), so it
 * only trips when updates have genuinely stalled.
 *
 * There is no batch endpoint on the upstream API - confirmed by probing
 * `/arrivals/all`, comma-separated codes, `/arrivals/batch`, and multi-segment
 * paths, all of which 400/404 - hence our own single shared poll of every
 * station (lib/arrivals-service.ts).
 */
export const FRESH_FOR_MS = 90_000;

/**
 * Past this age an entry is dropped everywhere (server snapshot, client
 * store, render). By then every train it listed has left according to its
 * own countdown, and what remains would be stale service status - e.g. last
 * night's "Not running" showing the next morning.
 */
export const MAX_SHOW_AGE_MS = 30 * 60_000;

export interface ArrivalTrain {
  train_no: string;
  destination: string;
  destination_key: string;
  /** Minutes until arrival, as reported upstream. */
  eta_minutes?: number;
  eta_precise?: number;
  status: string;
}

export interface ArrivalPlatform {
  platform: string;
  line_color: string;
  line_id: number;
  /** Both languages joined in one string, e.g. "เคหะฯ  | Kheha". */
  direction: string;
  /** Terminus station code for this platform's direction. */
  direction_key: string;
  trains: ArrivalTrain[];
}

export interface Arrivals {
  station: {
    code: string;
    name_en: string;
    name_th: string;
    line_color: string;
  };
  platforms: ArrivalPlatform[];
  near_end_of_service: boolean;
  service_active: boolean;
  next_service: string;
  server_time: string;
  timestamp: string;
}

export function ageMs(timestampIso: string, now = Date.now()): number {
  const dataAt = Date.parse(timestampIso.endsWith("Z") ? timestampIso : timestampIso + "Z");
  return Number.isNaN(dataAt) ? Infinity : now - dataAt;
}

export function isFresh(timestampIso: string, now = Date.now()): boolean {
  return ageMs(timestampIso, now) < FRESH_FOR_MS;
}

/** Recent enough to show at all (see MAX_SHOW_AGE_MS), live or not. */
export function isShowable(timestampIso: string, now = Date.now()): boolean {
  return ageMs(timestampIso, now) < MAX_SHOW_AGE_MS;
}

/**
 * Past these, a field is malformed/hostile rather than merely unusual - a
 * real BTS platform has a handful of trains, not hundreds, and station/
 * destination names are short. Bounding sizes here, not just shapes, keeps
 * a misbehaving upstream from inflating what gets cached in Redis and
 * relayed to every polling client.
 */
const MAX_PLATFORMS = 10;
const MAX_TRAINS_PER_PLATFORM = 20;
const MAX_STRING_LENGTH = 200;

function isBoundedString(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX_STRING_LENGTH;
}

/**
 * The upstream is undocumented and, for stations outside its real coverage
 * (e.g. the northern Sukhumvit extension), can return HTTP 200 with a body
 * that's missing `platforms` entirely rather than an error status. Treat
 * that shape (and anything exceeding the size bounds above) as a failure
 * too, so that station is simply left out of the snapshot instead of being
 * forwarded to the client as if it were valid data.
 */
export function isValidArrivals(data: unknown): data is Arrivals {
  if (!data || typeof data !== "object") return false;
  const d = data as Partial<Arrivals>;
  if (!Array.isArray(d.platforms) || d.platforms.length > MAX_PLATFORMS) return false;
  if (!isBoundedString(d.station?.code) || !isBoundedString(d.timestamp)) return false;
  return d.platforms.every(
    (p) =>
      p &&
      typeof p === "object" &&
      Array.isArray(p.trains) &&
      p.trains.length <= MAX_TRAINS_PER_PLATFORM &&
      isBoundedString(p.direction) &&
      p.trains.every((t) => t && typeof t === "object" && isBoundedString(t.destination)),
  );
}

/**
 * `deadline` lets a caller cut the call short on top of the per-call
 * timeout - the shared poll uses it to guarantee it finishes before its
 * fleet-wide lock expires.
 */
export async function fetchUpstream(code: string, deadline?: AbortSignal): Promise<Arrivals> {
  const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  const signal = deadline ? AbortSignal.any([timeout, deadline]) : timeout;
  const res = await fetch(`${UPSTREAM}/arrivals/${code}`, { signal, cache: "no-store" });
  if (!res.ok) {
    throw new Error(`upstream ${res.status} for ${code}`);
  }
  const data = await res.json();
  if (!isValidArrivals(data)) {
    throw new Error(`upstream returned malformed arrivals for ${code}`);
  }
  return data;
}
