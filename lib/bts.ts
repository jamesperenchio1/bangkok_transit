/**
 * Client for the undocumented bts-api.topmile.com live-arrivals API.
 *
 * Has no Access-Control-Allow-Origin header, so it can never be called from
 * the browser directly — all access goes through /api/arrivals/[code].
 *
 * Coverage is BTS Sukhumvit + Silom only; other codes (or Gold/Yellow/Pink)
 * return 400/"unavailable". `timestamp` in the payload is UTC despite
 * looking like a naive local time — parse it as UTC or every countdown will
 * be off by 7 hours (Asia/Bangkok).
 */
export const UPSTREAM = "https://bts-api.topmile.com";
export const UPSTREAM_TIMEOUT_MS = 12_000;

/** Past this age, an arrival time is wrong rather than merely stale. */
export const FRESH_FOR_MS = 90_000;

/**
 * There is no batch endpoint on the upstream API - confirmed by probing
 * `/arrivals/all`, comma-separated codes, `/arrivals/batch`, and multi-segment
 * paths, all of which 400/404. The closest equivalent is our own server
 * fetching every station sequentially on a fixed interval (see
 * .github/workflows/keep-arrivals-warm.yml) and caching the results - so an
 * on-demand request almost never needs to hit upstream itself. This is the
 * ceiling on how old a Redis-cached read is allowed to be before a request
 * falls back to the slow upstream call. The warm job targets a 5-minute
 * interval, but GitHub's scheduler can delay runs by several minutes under
 * load, so this needs real headroom above that - it's meant to catch the
 * warm job actually being down, not fire on ordinary cron jitter.
 */
export const CACHE_SERVE_MS = 10 * 60_000;

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
 * too, so it goes through the normal stale-cache-or-502 path instead of
 * being forwarded to the client as if it were valid data.
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

export async function fetchUpstream(code: string): Promise<Arrivals> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${UPSTREAM}/arrivals/${code}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`upstream ${res.status} for ${code}`);
    }
    const data = await res.json();
    if (!isValidArrivals(data)) {
      throw new Error(`upstream returned malformed arrivals for ${code}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}
