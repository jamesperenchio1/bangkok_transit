/**
 * Station exits/landmarks + the offline places index, both from OpenStreetMap.
 *
 * Source: OpenStreetMap contributors, queried through the Overpass API for
 * greater Bangkok (bbox 13.40,100.20,14.10,100.95) and published under the
 * Open Database License (ODbL) 1.0 - https://www.openstreetmap.org/copyright
 * The raw response is cached in data/raw/osm-bangkok-pois.json so the build is
 * reproducible without hitting Overpass again (pass --refresh to re-query).
 *
 *   node --experimental-strip-types scripts/fetch-station-details.ts
 *
 * What it writes:
 *  - data/stations.json: optional `exits` (only stations whose entrances OSM
 *    actually maps) and `landmark` (one nearby well-known place).
 *  - data/places.json: up to 400 named places for instant offline search,
 *    each tied to its nearest station and straight-line walk distance.
 *
 * Exit numbers are only ever taken from OSM (`ref`, or a numeric `name` such
 * as "ทางออก 2"); an unnamed entrance gets an "Entrance A/B/..." label sorted
 * by distance, never an invented "Exit N".
 *
 * A handful of very well-known places are missing from the Overpass result
 * (mostly relations or place_of_worship polygons). They are listed in
 * CURATED below with coordinates looked up through OSM's Nominatim geocoder,
 * so they are still OSM data; the build says so instead of guessing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const STATIONS = path.join(ROOT, "data", "stations.json");
const PLACES = path.join(ROOT, "data", "places.json");
const CACHE = path.join(ROOT, "data", "raw", "osm-bangkok-pois.json");

const BBOX = "13.40,100.20,14.10,100.95"; // south,west,north,east
const OVERPASS = "https://overpass-api.de/api/interpreter";
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** One combined query: entrances plus the place types we show. Relations are
 * included because several malls, parks and the airports are multipolygons. */
const QUERY = `[out:json][timeout:240];
(
  node["railway"="subway_entrance"](${BBOX});
  way["railway"="subway_entrance"](${BBOX});
  node["entrance"]["public_transport"](${BBOX});
  node["railway"="station"]["entrance"](${BBOX});
  nwr["shop"="mall"](${BBOX});
  nwr["aeroway"="aerodrome"](${BBOX});
  nwr["amenity"="hospital"](${BBOX});
  nwr["amenity"="university"](${BBOX});
  nwr["amenity"="marketplace"](${BBOX});
  nwr["leisure"="park"](${BBOX});
  nwr["tourism"="museum"](${BBOX});
  nwr["tourism"="attraction"](${BBOX});
  nwr["historic"]["wikidata"](${BBOX});
  nwr["place"="attraction"](${BBOX});
);
out center tags;`;

interface OsmTags {
  name?: string;
  "name:en"?: string;
  wikidata?: string;
  wikipedia?: string;
  ref?: string;
  railway?: string;
  entrance?: string;
  public_transport?: string;
  shop?: string;
  aeroway?: string;
  iata?: string;
  amenity?: string;
  leisure?: string;
  tourism?: string;
  historic?: string;
  place?: string;
  [key: string]: string | undefined;
}

interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: OsmTags;
}

interface Station {
  code: string;
  nameEn: string;
  nameTh: string;
  lines: { line: string }[];
  lat: number;
  lon: number;
  exits?: string[];
  landmark?: string;
}

type PlaceKind = "mall" | "hospital" | "university" | "airport" | "attraction" | "park" | "market" | "place";

interface Place {
  id: string;
  name: string;
  nameTh?: string;
  kind: PlaceKind;
  lat: number;
  lon: number;
  stationCode: string;
  meters: number;
}

/** Public, verifiable places the Overpass extract does not contain. Coordinates
 * from OSM Nominatim (nominatim.openstreetmap.org, ODbL), queried 2026-11-26. */
const CURATED: Array<{ name: string; nameTh: string; kind: PlaceKind; lat: number; lon: number }> = [
  { name: "Suvarnabhumi Airport", nameTh: "ท่าอากาศยานสุวรรณภูมิ", kind: "airport", lat: 13.6818767, lon: 100.7485803 },
  { name: "Don Mueang Airport", nameTh: "ท่าอากาศยานดอนเมือง", kind: "airport", lat: 13.9126097, lon: 100.6067500 },
  { name: "Queen Sirikit National Convention Center", nameTh: "ศูนย์การประชุมแห่งชาติสิริกิติ์", kind: "attraction", lat: 13.7242403, lon: 100.558736 },
  { name: "BITEC Bang Na", nameTh: "ไบเทค บางนา", kind: "attraction", lat: 13.669801, lon: 100.6085436 },
  { name: "IMPACT Muang Thong Thani", nameTh: "อิมแพ็ค เมืองทองธานี", kind: "attraction", lat: 13.9134256, lon: 100.5476259 },
  { name: "Wat Pho", nameTh: "วัดพระเชตุพนวิมลมังคลาราม", kind: "attraction", lat: 13.7463456, lon: 100.4927381 },
  { name: "Wat Saket (Golden Mount)", nameTh: "วัดสระเกศราชวรมหาวิหาร", kind: "attraction", lat: 13.7538492, lon: 100.5066941 },
  { name: "Museum Siam", nameTh: "มิวเซียมสยาม", kind: "attraction", lat: 13.7439935, lon: 100.4938519 },
  { name: "Siriraj Hospital", nameTh: "โรงพยาบาลศิริราช", kind: "hospital", lat: 13.7578222, lon: 100.4853833 },
  { name: "Bumrungrad International Hospital", nameTh: "โรงพยาบาลบำรุงราษฎร์", kind: "hospital", lat: 13.7464113, lon: 100.5524335 },
  { name: "Chulalongkorn University", nameTh: "จุฬาลงกรณ์มหาวิทยาลัย", kind: "university", lat: 13.7430893, lon: 100.5328725 },
];

const ENTRANCE_RADIUS = 300;
const LANDMARK_RADIUS = 700;
const PLACE_RADIUS = 2000;
const MAX_EXITS = 8;
const MAX_PLACES = 400;

const R = 6_371_000;
const RAD = Math.PI / 180;
function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function coords(e: OsmElement): [number, number] | null {
  if (e.type === "node" && e.lat !== undefined && e.lon !== undefined) return [e.lat, e.lon];
  if (e.center) return [e.center.lat, e.center.lon];
  return null;
}

function englishName(t: OsmTags): string {
  return (t["name:en"] || t.name || "").trim();
}

function thaiName(t: OsmTags): string | undefined {
  const name = (t.name || "").trim();
  return /[\u0E00-\u0E7F]/.test(name) ? name : undefined;
}

const KIND_WEIGHT: Record<PlaceKind, number> = {
  airport: 60,
  mall: 58,
  attraction: 46,
  park: 40,
  market: 34,
  university: 28,
  hospital: 26,
  place: 20,
};

/** The city-scale parks that are destinations in their own right; a small
 * neighbourhood park should not outrank a monument next door. */
const ICONIC_PARK = /lumphini|benjakitti|benchasiri|chatuchak park|queen sirikit park|wachirabenchathat|sanam luang|saranrom|santichaiprakan|chao phraya sky park|nagaraphirom/i;

/** Sights a visitor means by the station's name; they outrank any nearby shop. */
const ICONIC_LANDMARK =
  /grand palace|wat arun|wat pho|wat saket|golden mount|khao san|chatuchak|iconsiam|siam paragon|central ?world|mbk|terminal 21|emsphere|emquartier|emporium|jim thompson|museum siam|yaowarat|pak khlong|lumphini|benjakitti|queen sirikit national convention|bitec|impact|suvarnabhumi|don mueang/i;

const MALL_ALLOWLIST =
  /iconsiam|siam paragon|siam center|central ?world|central ?plaza|central (?:ram|ladprao|pinklao|bangna|chaengwattana|northville|rama|salaya|westgate|eastville)|emporium|emquartier|emsphere|mbk|terminal 21|platinum|union mall|seacon|paradise park|fashion island|mega bangna|the mall|robinson|big c|lotus|makro|gateway|show dc|samyan mitrtown|jj mall|future park|zeer rangsit|market village|marche/i;

/** Markets are everywhere in OSM; only these read as city landmarks rather
 * than a neighbourhood fresh market. */
const FAMOUS_MARKET =
  /chatuchak|or tor kor|pak khlong|pakkhlong|jodd fairs|asiatique|suan lum|sam yan|pahurat|pratunam|bang rak|khlong thom|on nut|huai khwang|talad rot fai|train night market|flower market|floating market|patpong/i;

function weightOf(name: string, kind: PlaceKind): number {
  if (kind !== "university" && kind !== "hospital" && ICONIC_LANDMARK.test(name)) return 75;
  if (kind === "park" && ICONIC_PARK.test(name)) return 56;
  if (kind === "market" && FAMOUS_MARKET.test(name)) return 52;
  return KIND_WEIGHT[kind];
}

function kindOf(t: OsmTags): PlaceKind | null {
  if (t.aeroway === "aerodrome") return "airport";
  if (t.shop === "mall") return "mall";
  if (t.amenity === "hospital") return "hospital";
  if (t.amenity === "university") return "university";
  if (t.amenity === "marketplace") return "market";
  if (t.leisure === "park") return "park";
  if (t.tourism === "museum" || t.tourism === "attraction") return "attraction";
  if (t.place === "attraction" || t.historic || t.amenity === "place_of_worship") return "attraction";
  return null;
}

const GENERIC = /^(park|parking|market|mall|hospital|university|museum|entrance|exit|gate|building|tower|plaza|station)$/i;

function isUsablePlace(t: OsmTags, kind: PlaceKind, name: string): boolean {
  if (name.length < 3 || GENERIC.test(name)) return false;
  if (kind === "airport") return Boolean(t.iata) || /international airport/i.test(name);
  if (kind === "university") return !/^faculty of/i.test(name) && Boolean(t.wikidata || t.wikipedia || /university|มหาวิทยาลัย/i.test(name));
  if (kind === "park") return Boolean(t.wikidata || t.wikipedia);
  if (kind === "mall") return Boolean(t.wikidata || t.wikipedia) || MALL_ALLOWLIST.test(name);
  if (kind === "market") return Boolean(t.wikidata || t.wikipedia) || FAMOUS_MARKET.test(name);
  if (kind === "hospital") return Boolean(t.wikidata || t.wikipedia) || /hospital|โรงพยาบาล/i.test(name);
  return Boolean(t.wikidata || t.wikipedia || t.tourism === "attraction");
}

/** Numeric exit label from ref or name; anything else that is descriptive is
 * kept as-is; nothing numeric is ever invented. */
function exitLabel(t: OsmTags): string | null {
  const ref = (t.ref || "").trim();
  if (ref) return `Exit ${ref}`;
  const name = englishName(t);
  const numbered = /(?:exit|ทางออก)\s*([0-9]+[A-Za-z]?)/i.exec(name) || /^([0-9]+[A-Za-z]?)$/.exec(name);
  if (numbered) return `Exit ${numbered[1]}`;
  if (name && !/^(entrance|elevator|stairs|lift|gate)$/i.test(name)) return name;
  return null;
}

async function loadOsm(refresh: boolean): Promise<{ elements: OsmElement[]; fetched: string }> {
  if (!refresh && existsSync(CACHE)) {
    const raw = JSON.parse(readFileSync(CACHE, "utf8")) as { elements: OsmElement[] };
    return { elements: raw.elements, fetched: "cache" };
  }
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "BangkokTransit/1.0 (static transit map; gingerbros.brew@gmail.com)",
  };
  let lastError = "";
  for (const url of [OVERPASS, ...MIRRORS]) {
    try {
      const response = await fetch(url, { method: "POST", headers, body: `data=${encodeURIComponent(QUERY)}` });
      if (!response.ok) {
        lastError = `${url} -> HTTP ${response.status}`;
        continue;
      }
      const raw = (await response.json()) as { elements: OsmElement[] };
      if (!Array.isArray(raw.elements)) {
        lastError = `${url} -> unexpected payload`;
        continue;
      }
      mkdirSync(path.dirname(CACHE), { recursive: true });
      writeFileSync(CACHE, JSON.stringify(raw) + "\n");
      return { elements: raw.elements, fetched: url };
    } catch (error) {
      lastError = `${url} -> ${(error as Error).message}`;
    }
  }
  throw new Error(`Overpass unavailable (${lastError}); keeping existing data.`);
}

async function build(refresh: boolean): Promise<void> {
  const stations = JSON.parse(readFileSync(STATIONS, "utf8")) as Station[];
  const { elements, fetched } = await loadOsm(refresh);

  const codes = new Set(stations.map((s) => s.code));
  if (codes.size !== stations.length) throw new Error("data/stations.json has duplicate codes");

  const nearest = (lat: number, lon: number): { station: Station; meters: number } => {
    let best = stations[0];
    let bestD = Number.POSITIVE_INFINITY;
    for (const s of stations) {
      const d = haversine(s.lat, s.lon, lat, lon);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return { station: best, meters: bestD };
  };

  const entrances = elements.filter((e) => {
    const t = e.tags || {};
    return t.railway === "subway_entrance" || (t.entrance && t.public_transport) || (t.railway === "station" && t.entrance);
  });

  // --- exits -----------------------------------------------------------------
  const byStation = new Map<string, { label: string | null; meters: number; lat: number; lon: number; name: string }[]>();
  let dropped = 0;
  for (const e of entrances) {
    const c = coords(e);
    if (!c) continue;
    const t = e.tags || {};
    const { station, meters } = nearest(c[0], c[1]);
    if (meters > ENTRANCE_RADIUS) {
      dropped++;
      continue;
    }
    const list = byStation.get(station.code) ?? [];
    list.push({ label: exitLabel(t), meters, lat: c[0], lon: c[1], name: englishName(t) });
    byStation.set(station.code, list);
  }

  let exitStations = 0;
  for (const station of stations) {
    delete station.exits;
    delete station.landmark;
    const list = byStation.get(station.code);
    if (!list) continue;

    const accepted: typeof list = [];
    const seenLabels = new Set<string>();
    for (const item of list.sort((a, b) => a.meters - b.meters)) {
      if (item.label && seenLabels.has(item.label)) continue;
      if (accepted.some((a) => haversine(a.lat, a.lon, item.lat, item.lon) < 12)) continue;
      if (item.label) seenLabels.add(item.label);
      accepted.push(item);
    }

    const used = new Set<string>();
    const labels = accepted.map((item) => {
      if (item.label) return item.label;
      // Stable, non-numeric labels for entrances OSM leaves unnamed.
      for (const letter of "ABCDEFGHIJKLMNOP") {
        const label = `Entrance ${letter}`;
        if (!seenLabels.has(label)) {
          seenLabels.add(label);
          return label;
        }
      }
      return null;
    }).filter((label): label is string => {
      if (!label || used.has(label)) return false;
      used.add(label);
      return true;
    });

    const numeric = (label: string): number => {
      const match = /^Exit\s+([0-9]+)/.exec(label);
      return match ? Number(match[1]) : 999;
    };
    labels.sort((a, b) => numeric(a) - numeric(b) || a.localeCompare(b));
    if (labels.length) {
      station.exits = labels.slice(0, MAX_EXITS);
      exitStations++;
    }
  }

  // --- landmark + places pool ------------------------------------------------
  interface Candidate extends Place {
    fame: number;
    score: number;
    landmarkScore: number;
    kept?: boolean;
  }

  const candidates: Candidate[] = [];
  for (const e of elements) {
    const t = e.tags || {};
    const c = coords(e);
    if (!c) continue;
    const kind = kindOf(t);
    if (!kind) continue;
    const name = englishName(t);
    if (!isUsablePlace(t, kind, name)) continue;
    const { station, meters } = nearest(c[0], c[1]);
    if (meters > PLACE_RADIUS) continue;
    const fame = (t.wikidata ? 2 : 0) + (t.wikipedia ? 1 : 0);
    candidates.push({
      id: `osm-${e.type}-${e.id}`,
      name,
      ...(thaiName(t) && thaiName(t) !== name ? { nameTh: thaiName(t) } : {}),
      kind,
      lat: c[0],
      lon: c[1],
      stationCode: station.code,
      meters: Math.round(meters),
      fame,
      score: weightOf(name, kind) + fame * 6 - meters / 40,
      landmarkScore: weightOf(name, kind) + fame * 8 - meters / 30 + (kind === "airport" ? 40 : 0),
    });
  }

  // Curated places are added after the OSM pool; their station is recomputed
  // from real coordinates, and an OSM entry with the same name+spot wins.
  for (const item of CURATED) {
    const { station, meters } = nearest(item.lat, item.lon);
    if (meters > PLACE_RADIUS) continue;
    candidates.push({
      id: `curated-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      name: item.name,
      nameTh: item.nameTh,
      kind: item.kind,
      lat: item.lat,
      lon: item.lon,
      stationCode: station.code,
      meters: Math.round(meters),
      fame: 0,
      score: weightOf(item.name, item.kind) + 100,
      landmarkScore: weightOf(item.name, item.kind) + 30,
    });
  }

  // --- places.json -----------------------------------------------------------
  const STOPWORDS = new Set(["the", "of", "and", "at", "in", "center", "centre", "bangkok"]);
  const tokens = (name: string): Set<string> =>
    new Set(name.toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOPWORDS.has(w)));
  const overlap = (a: Set<string>, b: Set<string>): number => {
    if (!a.size || !b.size) return 0;
    let shared = 0;
    for (const token of a) if (b.has(token)) shared++;
    return shared / Math.min(a.size, b.size);
  };
  const used: { key: string; tokens: Set<string>; lat: number; lon: number }[] = [];
  const places: Place[] = [];
  for (const p of candidates.sort((a, b) => b.score - a.score)) {
    const key = p.name.toLowerCase().replace(/\s+/g, " ").trim();
    const pTokens = tokens(p.name);
    const duplicate = used.some((u) =>
      u.key === key ? true : haversine(u.lat, u.lon, p.lat, p.lon) < 500 && overlap(u.tokens, pTokens) >= 0.6,
    );
    if (duplicate) continue;
    used.push({ key, tokens: pTokens, lat: p.lat, lon: p.lon });
    p.kept = true;
    places.push({ id: p.id, name: p.name, ...(p.nameTh ? { nameTh: p.nameTh } : {}), kind: p.kind, lat: p.lat, lon: p.lon, stationCode: p.stationCode, meters: p.meters });
    if (places.length >= MAX_PLACES) break;
  }

  // --- one landmark per station, from the deduped place list -----------------
  let landmarkStations = 0;
  for (const station of stations) {
    const near = candidates
      .filter(
        (p) => p.kept && p.stationCode === station.code && p.meters <= (p.kind === "airport" ? PLACE_RADIUS : LANDMARK_RADIUS),
      )
      .sort((a, b) => b.landmarkScore - a.landmarkScore);
    if (near.length) {
      station.landmark = near[0].name;
      landmarkStations++;
    }
  }

  const byKind: Record<string, number> = {};
  for (const p of places) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  const unknown = places.filter((p) => !codes.has(p.stationCode));
  if (unknown.length) throw new Error(`places reference unknown stations: ${unknown.map((p) => p.stationCode).join(", ")}`);

  writeFileSync(STATIONS, JSON.stringify(stations, null, 2) + "\n");
  writeFileSync(
    PLACES,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "OpenStreetMap contributors (Overpass API, ODbL 1.0) plus OSM Nominatim lookups for curated entries",
        places,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(`OSM: ${elements.length} elements from ${fetched}`);
  console.log(`stations: ${stations.length}, with exits ${exitStations}, with landmark ${landmarkStations}`);
  console.log(`entrances dropped beyond ${ENTRANCE_RADIUS} m: ${dropped}`);
  console.log(`places: ${places.length} ${JSON.stringify(byKind)}`);
}

// Run the real build (the cache path is synchronous; the network path uses fetch).
void build(process.argv.includes("--refresh"));
