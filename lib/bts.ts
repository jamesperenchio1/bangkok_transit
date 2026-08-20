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

export interface ArrivalTrain {
  /** Minutes until arrival, as reported upstream. */
  minutes?: number;
  [key: string]: unknown;
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

export function isFresh(timestampIso: string, now = Date.now()): boolean {
  const dataAt = Date.parse(timestampIso.endsWith("Z") ? timestampIso : timestampIso + "Z");
  if (Number.isNaN(dataAt)) return false;
  return now - dataAt < FRESH_FOR_MS;
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
    return (await res.json()) as Arrivals;
  } finally {
    clearTimeout(timeout);
  }
}
