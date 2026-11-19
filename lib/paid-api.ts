// The paid x402 API for AI agents (served by worker/index.ts under /api/v1):
// the table of endpoints and prices, and the JSON each one returns. Pure data
// in, plain objects out - no Hono, no network, no runtime-specific imports - so
// the Worker, the OpenAPI/llms.txt checks and the tests all read one source.
//
// Everything on the website stays free and static; only these endpoints cost
// money, and only to the callers who ask for them.
import { shownCode, stationsByCode, type Station } from "@/data/stations";
import interchanges from "@/data/interchanges.json";
import { isFresh, isShowable, ageMs, type Arrivals } from "@/lib/bts";
import type { ArrivalsDocument } from "@/lib/arrivals-document";
import { findPath } from "@/lib/transit-graph";
import {
  LINES, SITE_URL, absoluteUrl, describeRoute, lineBranches, lineStations, lineTermini, linesBySlug, markdownPath,
  neighbours, stationLines, stationPath, stationsBySlug, linePath,
  type LineInfo,
} from "@/lib/seo";

/** Where the Worker reads live arrivals from: the same CDN-cached document the site uses (see lib/arrivals-url.ts). */
export const LIVE_ARRIVALS_URL = "https://live.bangkok-transit.com/arrivals.json";

export const API_BASE = "/api/v1";

export interface PaidEndpoint {
  id: "arrivals" | "route" | "station" | "line";
  /** The x402 route key: method + path pattern, matched exactly against the request path. */
  route: string;
  /** The same path in OpenAPI notation. */
  openapiPath: string;
  /** USD, charged per successful call. Edit here to change what the API costs. */
  price: string;
  summary: string;
  description: string;
  /** An example request path (with query), for the index and the docs. */
  example: string;
}

export const PAID_ENDPOINTS: PaidEndpoint[] = [
  {
    id: "arrivals",
    route: `GET ${API_BASE}/arrivals`,
    openapiPath: `${API_BASE}/arrivals`,
    price: "$0.002",
    summary: "Live arrivals at one BTS station",
    description:
      "Live train arrivals for one BTS Sukhumvit or Silom station (query: station=<code>, e.g. N8 or CEN). Each reading carries its timestamp and age, and says whether it is last-known; readings older than 30 minutes are not served. Not charged when there is no current reading.",
    example: `${API_BASE}/arrivals?station=N8`,
  },
  {
    id: "route",
    route: `GET ${API_BASE}/route`,
    openapiPath: `${API_BASE}/route`,
    price: "$0.005",
    summary: "Route between two stations",
    description:
      "Best route between two stations on any Bangkok rail line (query: from=<code>, to=<code>): lines, where to change, direction to board, walking transfers, stops and estimated minutes. Estimates, not a timetable.",
    example: `${API_BASE}/route?from=N8&to=A08`,
  },
  {
    id: "station",
    route: `GET ${API_BASE}/stations/:slug`,
    openapiPath: `${API_BASE}/stations/{slug}`,
    price: "$0.001",
    summary: "Facts about one station",
    description:
      "Names (English and Thai), official code, lines, neighbouring stations, walking interchanges and coordinates for one station. The slug is the page slug (siam-cen) or the station code (CEN).",
    example: `${API_BASE}/stations/siam-cen`,
  },
  {
    id: "line",
    route: `GET ${API_BASE}/lines/:slug`,
    openapiPath: `${API_BASE}/lines/{slug}`,
    price: "$0.001",
    summary: "Facts about one line",
    description: "Name (English and Thai), terminal stations and every station in order, branch by branch, for one rail line.",
    example: `${API_BASE}/lines/bts-sukhumvit-line`,
  },
];

/** The number the price is quoted in, for the docs ("$0.002" -> 0.002). */
export const priceUsd = (e: PaidEndpoint) => Number(e.price.replace("$", ""));

const NOTE_ESTIMATE = "Times are estimates from track distance and typical train speed, not a timetable.";

const stationRef = (s: Station) => ({ code: s.code, shownCode: shownCode(s), nameEn: s.nameEn, nameTh: s.nameTh });

/** Resolves a page slug ("siam-cen") or a station code ("CEN", any case). */
export function findStation(idOrSlug: string): Station | undefined {
  const key = idOrSlug.trim();
  if (!key || key.length > 80) return undefined;
  return stationsBySlug.get(key.toLowerCase()) ?? stationsByCode.get(key) ?? stationsByCode.get(key.toUpperCase());
}

export function stationFacts(idOrSlug: string) {
  const s = findStation(idOrSlug);
  if (!s) return null;
  const walking = (interchanges as { a: string; b: string }[])
    .filter((i) => i.a === s.code || i.b === s.code)
    .map((i) => stationsByCode.get(i.a === s.code ? i.b : i.a))
    .filter((x): x is Station => !!x);
  return {
    ...stationRef(s),
    lines: stationLines(s).map((l) => ({ slug: l.slug, nameEn: l.nameEn, nameTh: l.nameTh })),
    hasLiveArrivals: s.hasLiveArrivals,
    latitude: s.lat,
    longitude: s.lon,
    neighbours: neighbours(s.code).map(({ line, station }) => ({ line: line.nameEn, station: stationRef(station) })),
    walkingInterchanges: walking.map(stationRef),
    pages: { html: absoluteUrl(stationPath(s)), markdown: absoluteUrl(markdownPath(stationPath(s))) },
  };
}

export function lineFacts(slug: string) {
  const line: LineInfo | undefined = linesBySlug.get(slug.trim().toLowerCase());
  if (!line) return null;
  const branches = lineBranches(line.key);
  return {
    slug: line.slug,
    nameEn: line.nameEn,
    nameTh: line.nameTh,
    hasLiveArrivals: line.live,
    stationCount: lineStations(line.key).length,
    terminalStations: lineTermini(line.key).map(stationRef),
    // One run per branch (the junction appears in each branch it serves).
    branches: branches.map((b) => b.map(stationRef)),
    pages: { html: absoluteUrl(linePath(line)), markdown: absoluteUrl(markdownPath(linePath(line))) },
  };
}

export type RouteResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: 400 | 404; error: string };

export function routeFacts(from: string | undefined, to: string | undefined): RouteResult {
  if (!from || !to) return { ok: false, status: 400, error: "Both ?from= and ?to= are required (station code or slug)." };
  const a = findStation(from);
  const b = findStation(to);
  if (!a || !b) return { ok: false, status: 404, error: `Unknown station: ${!a ? from : to}` };
  if (a.code === b.code) return { ok: false, status: 400, error: "from and to are the same station." };
  const path = findPath(a.code, b.code);
  if (!path) return { ok: false, status: 404, error: "No route between these stations." };
  return {
    ok: true,
    body: {
      from: stationRef(a),
      to: stationRef(b),
      minutes: Math.round(path.minutes),
      stops: path.stops,
      changes: path.changes,
      walkMeters: Math.round(path.walkMeters),
      steps: [`Start at ${a.nameEn}.`, ...describeRoute(path)],
      legs: path.legs.map((l) => ({
        station: stationRef(l.station),
        mode: l.mode,
        line: l.line,
        boardToward: l.boardToward ? stationRef(l.boardToward) : undefined,
      })),
      map: absoluteUrl(`/?from=${a.code}&to=${b.code}`),
      note: NOTE_ESTIMATE,
    },
  };
}

export type ArrivalsResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: 400 | 404; error: string };

/** One station's reading from the shared document, with its age made explicit (the app's "honest live data" rule). */
export function arrivalsFacts(doc: ArrivalsDocument, station: string | undefined, now = Date.now()): ArrivalsResult {
  if (!station) return { ok: false, status: 400, error: "?station= is required (station code, e.g. N8)." };
  const s = findStation(station);
  if (!s) return { ok: false, status: 404, error: `Unknown station: ${station}` };
  if (!s.hasLiveArrivals) {
    return { ok: false, status: 404, error: `${s.nameEn} has no live arrivals (only BTS Sukhumvit and Silom stations do).` };
  }
  const reading: Arrivals | undefined = doc.arrivals[s.code];
  if (!reading || !isShowable(reading.timestamp, now)) {
    return { ok: false, status: 404, error: `No current reading for ${s.nameEn}${doc.status?.state === "down" ? " (the live feed is down)" : ""}.` };
  }
  return {
    ok: true,
    body: {
      station: stationRef(s),
      reading,
      ageSeconds: Math.max(0, Math.round(ageMs(reading.timestamp, now) / 1000)),
      lastKnown: !isFresh(reading.timestamp, now),
      upstream: doc.status?.state ?? "unknown",
      note: "timestamp is UTC without a trailing Z. A reading older than ~90 s is last-known; readings older than 30 minutes are not served.",
    },
  };
}

/** What `GET /api/v1` (free) says about the API. Network facts come from the Worker's config. */
export function apiIndex(payments: { network: string; payTo: string; facilitator: string; testnet: boolean }) {
  return {
    name: "Bangkok Transit API",
    version: "1",
    description:
      "Pay-per-call data for AI agents, paid with x402 (HTTP 402). The website, map, markdown pages and llms.txt are free; only these endpoints cost money. Calls that fail (unknown station, no current reading) are not charged.",
    payments: {
      protocol: "x402",
      x402Version: 2,
      scheme: "exact",
      asset: "USDC",
      network: payments.network,
      payTo: payments.payTo,
      facilitator: payments.facilitator,
      testnet: payments.testnet,
      notice: payments.testnet
        ? "TEST MODE: payments use test USDC on a test network and have no monetary value."
        : "Payments use USDC on mainnet.",
    },
    endpoints: PAID_ENDPOINTS.map((e) => ({
      method: "GET",
      path: e.openapiPath,
      priceUsd: priceUsd(e),
      price: e.price,
      summary: e.summary,
      description: e.description,
      example: absoluteUrl(e.example),
    })),
    docs: { openapi: `${SITE_URL}/openapi.json`, llms: `${SITE_URL}/llms.txt`, catalog: `${SITE_URL}/.well-known/api-catalog` },
    lines: LINES.map((l) => l.slug),
  };
}
