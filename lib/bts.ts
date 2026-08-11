/**
 * Shared types and normalisation for the BTS live-arrivals upstream
 * (bts-api.topmile.com), plus the schematic loader.
 *
 * The upstream is never called from the browser: it sends no
 * `Access-Control-Allow-Origin`, so a direct client fetch is CORS-blocked. All
 * access goes through /api/arrivals/[code], which also absorbs its ~6s cold
 * latency and its burst rate limit (20 concurrent requests returns 429).
 */
import schematic from "@/data/canonical/bts-schematic.json";
import type { BtsSchematic } from "@/data/schemas";

export const UPSTREAM = "https://bts-api.topmile.com";

export const btsSchematic = schematic as BtsSchematic;

/** Every code /arrivals accepts. Anything else is rejected before we call upstream. */
export const LIVE_CODES: ReadonlySet<string> = new Set(btsSchematic.liveCodes);

/**
 * Past this age the ETAs are no longer describing reality — a train that was
 * two minutes out when the data was computed has already come and gone. Older
 * payloads are still rendered (station name, platforms, service state) but the
 * times are replaced with an "updating" state rather than a confident lie.
 */
export const FRESH_FOR_MS = 90_000;

export interface Train {
  trainNo: string;
  destinationEn: string;
  destinationTh: string;
  destinationCode: string;
  /** Minutes until arrival *at `dataAt`* — the client counts this down locally. */
  etaPrecise: number;
  status: string;
}

export interface Platform {
  platform: string;
  directionEn: string;
  directionTh: string;
  directionCode: string;
  lineColor: string;
  trains: Train[];
}

export interface Arrivals {
  code: string;
  nameEn: string;
  nameTh: string;
  lineColor: string;
  platforms: Platform[];
  serviceActive: boolean;
  nearEndOfService: boolean;
  nextService: string | null;
  /** Epoch ms the upstream computed these ETAs. All countdowns are relative to this. */
  dataAt: number;
  /** True when served from store after an upstream failure. */
  stale?: boolean;
}

/** Upstream shape, as observed. */
interface RawArrivals {
  station?: { code?: string; name_en?: string; name_th?: string; line_color?: string };
  platforms?: {
    platform?: string;
    line_color?: string;
    direction?: string;
    direction_key?: string;
    trains?: {
      train_no?: string;
      destination?: string;
      destination_key?: string;
      eta_minutes?: number;
      eta_precise?: number;
      status?: string;
    }[];
  }[];
  service_active?: boolean;
  near_end_of_service?: boolean;
  next_service?: string | null;
  timestamp?: string;
}

/**
 * Upstream joins both languages into one field, e.g. "เคหะฯ  | Kheha".
 * Split so the UI can honour the language toggle instead of showing both.
 */
function splitBilingual(value: string | undefined): { th: string; en: string } {
  const [th = "", en = ""] = (value ?? "").split("|");
  return { th: th.trim(), en: en.trim() || th.trim() };
}

/**
 * Upstream sends a naive ISO timestamp that is actually UTC — its `server_time`
 * field reads 7 hours later, matching Asia/Bangkok. Without forcing the zone,
 * every countdown would be off by 7 hours.
 */
function parseUtc(timestamp: string | undefined): number {
  if (!timestamp) return Date.now();
  const iso = /(Z|[+-]\d{2}:?\d{2})$/.test(timestamp) ? timestamp : `${timestamp}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Date.now();
}

/** Trim the upstream payload to what the UI renders, and split its bilingual fields. */
export function normalizeArrivals(raw: RawArrivals, code: string): Arrivals {
  const platforms = (raw.platforms ?? []).map((p) => {
    const dir = splitBilingual(p.direction);
    return {
      platform: p.platform ?? "",
      directionEn: dir.en,
      directionTh: dir.th,
      directionCode: p.direction_key ?? "",
      lineColor: p.line_color ?? "",
      trains: (p.trains ?? []).map((t) => {
        const dest = splitBilingual(t.destination);
        return {
          trainNo: t.train_no ?? "",
          destinationEn: dest.en,
          destinationTh: dest.th,
          destinationCode: t.destination_key ?? "",
          // Prefer the float; eta_minutes is the same value floored.
          etaPrecise: t.eta_precise ?? t.eta_minutes ?? 0,
          status: t.status ?? "pending",
        };
      }),
    };
  });

  return {
    code: (raw.station?.code ?? code).toUpperCase(),
    nameEn: raw.station?.name_en ?? "",
    nameTh: raw.station?.name_th ?? "",
    lineColor: raw.station?.line_color ?? "",
    platforms,
    serviceActive: raw.service_active ?? true,
    nearEndOfService: raw.near_end_of_service ?? false,
    nextService: raw.next_service ?? null,
    dataAt: parseUtc(raw.timestamp),
  };
}

/** Live ETA in minutes, counted down from when the data was computed. */
export function currentEta(train: Train, dataAt: number, now: number = Date.now()): number {
  return train.etaPrecise - (now - dataAt) / 60_000;
}

export function isFresh(dataAt: number, now: number = Date.now()): boolean {
  return now - dataAt < FRESH_FOR_MS;
}
