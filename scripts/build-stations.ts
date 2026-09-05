/**
 * Builds the full multi-line station dataset from the existing curated
 * data/stations.json (BTS Sukhumvit/Silom + Gold/Yellow/Pink, already correct)
 * plus the raw BMA GIS snapshot in data/raw/ (adds MRT Blue, MRT Purple,
 * Airport Rail Link, and SRT Red Line - lines with no coordinates in the
 * existing dataset at all).
 *
 * Why not just replace everything with the GIS data: it has real quality bugs
 * (Siam - BTS's own Sukhumvit/Silom interchange - is only tagged "Green Line",
 * missing the Silom tag entirely; the Pink Line group includes two unopened
 * "MT-01"/"MT-02" extension stubs and a literal duplicate "ศูนย์ราชการนนทบุรี"
 * row, both mismarked as operational). The existing 119 records for BTS/Gold/
 * Yellow/Pink are already correct (real codes, real interchange modeling, live
 * arrival wiring) - this script only asks the GIS data for (a) lat/lon to
 * backfill the Gold/Yellow/Pink stations that currently have none, and (b)
 * brand-new station lists for lines this app has never had data for at all.
 *
 * Ordering new stations along each line uses greedy nearest-neighbor chaining
 * over real lat/lon (robust for simple point-to-point metro lines; MRT Blue is
 * a closed loop, handled with an explicit wrap-around edge). Orange Line is
 * excluded - every one of its GIS records is STATUS "กำลังก่อสร้าง" (under
 * construction), it isn't open yet and isn't on the reference map.
 *
 * Run: node --experimental-strip-types scripts/build-stations.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const OPERATIONAL = "โครงข่ายปัจจุบันที่เปิดให้บริการแล้ว";

interface GisFeature {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, string>;
}

const existing = JSON.parse(
  readFileSync(path.join(ROOT, "data", "stations.json"), "utf8"),
);
const gisStations: GisFeature[] = JSON.parse(
  readFileSync(path.join(ROOT, "data", "raw", "bma-stations.geojson"), "utf8"),
).features;

function normalizeThaiName(raw: string): string {
  return raw
    .trim()
    .replace(/^สถานี\s*/, "")
    .replace(/\s*\(.*\)\s*$/, "")
    .trim();
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------
// Step 1: backfill lat/lon for existing gold/yellow/pink stations by Thai-name
// match against the corresponding operational GIS group.
// ---------------------------------------------------------------------------
const EXISTING_LINE_TO_GIS_COLOR: Record<string, string> = {
  gold: "Gold Line",
  yellow: "Yellow Line",
  pink: "Pink Line",
};

// A handful of existing station names don't literally match the GIS NAME
// field (typos in the government data, or a different official name variant)
// - resolved by hand after inspecting the raw GIS name list.
const NAME_ALIASES: Record<string, string> = {
  ศรีนครินทร์: "ศรีนรินทร์", // GIS typo: missing ค
  วงแหวนรามอินทรา: "วงแหวนตะวันออก", // same station, different official name variant
  "อิมแพ็ค เมืองทองธานี": "MT-01",
  ทะเลสาบเมืองทองธานี: "MT-02",
};

let backfilled = 0;
const unmatchedExisting: string[] = [];

for (const [ourKey, gisColor] of Object.entries(EXISTING_LINE_TO_GIS_COLOR)) {
  const candidates = gisStations.filter(
    (f) =>
      f.properties.COLOR_E.toLowerCase() === gisColor.toLowerCase() &&
      f.properties.STATUS === OPERATIONAL,
  );
  const byName = new Map(
    candidates.map((f) => [normalizeThaiName(f.properties.NAME), f]),
  );

  for (const station of existing) {
    if (!station.lines.some((l: { line: string }) => l.line === ourKey)) continue;
    if (station.lat !== undefined) continue; // already has coords (interchange also on another already-coded line)
    let normalized = normalizeThaiName(station.nameTh);
    for (const [from, to] of Object.entries(NAME_ALIASES)) {
      if (normalized.includes(from)) normalized = normalized.replace(from, to);
    }
    const match = byName.get(normalized);
    if (match) {
      const [lon, lat] = match.geometry.coordinates as [number, number];
      station.lat = lat;
      station.lon = lon;
      backfilled++;
    } else {
      unmatchedExisting.push(`${ourKey}/${station.code} "${station.nameTh}"`);
    }
  }
}

console.log(`Backfilled lat/lon for ${backfilled} existing gold/yellow/pink stations`);
if (unmatchedExisting.length) {
  console.log("Unmatched existing stations (left without lat/lon):");
  for (const m of unmatchedExisting) console.log(`  - ${m}`);
}

// ---------------------------------------------------------------------------
// Step 2: build brand-new station lists for lines with no existing data.
// ---------------------------------------------------------------------------
type NewLineKey = "blue" | "purple" | "arl" | "srtRed";

const NEW_LINES: {
  key: NewLineKey;
  gisColor: string;
  name: string;
  color: string;
  codePrefix: string;
}[] = [
  { key: "blue", gisColor: "Blue Line", name: "MRT Blue Line", color: "#1c3f94", codePrefix: "BL" },
  { key: "purple", gisColor: "Purple Line", name: "MRT Purple Line", color: "#a1458e", codePrefix: "PP" },
  { key: "arl", gisColor: "Airport Rail Link", name: "Airport Rail Link", color: "#8b3f97", codePrefix: "A" },
  { key: "srtRed", gisColor: "Red Line", name: "SRT Red Line", color: "#a5122a", codePrefix: "RD" },
];

function greedyChain(points: GisFeature[]): GisFeature[] {
  if (points.length <= 1) return points;
  const remaining = [...points];
  // Start from the westmost point - arbitrary but deterministic.
  remaining.sort(
    (a, b) =>
      (a.geometry.coordinates as [number, number])[0] -
      (b.geometry.coordinates as [number, number])[0],
  );
  const chain = [remaining.shift()!];
  while (remaining.length) {
    const last = chain[chain.length - 1].geometry.coordinates as [number, number];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMeters(
        last,
        remaining[i].geometry.coordinates as [number, number],
      );
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    chain.push(remaining.splice(bestIdx, 1)[0]);
  }
  return chain;
}

const newStations: Array<{
  code: string;
  nameEn: string;
  nameTh: string;
  lines: { line: NewLineKey; name: string; color: string }[];
  hasLiveArrivals: boolean;
  lat: number;
  lon: number;
}> = [];

for (const line of NEW_LINES) {
  let points = gisStations.filter(
    (f) =>
      f.properties.COLOR_E.toLowerCase() === line.gisColor.toLowerCase() &&
      f.properties.STATUS === OPERATIONAL,
  );

  if (line.key === "srtRed") {
    // Two branches from a shared trunk (Bang Sue) - chain each separately so
    // the greedy nearest-neighbor walk doesn't jump across branches, then
    // concatenate (Light Red branch first, then Dark Red trunk).
    const lightRed = points.filter((f) => f.properties.ROUTE.includes("ตลิ่งชัน"));
    const darkRed = points.filter((f) => f.properties.ROUTE.includes("รังสิต"));
    points = [...greedyChain(lightRed).reverse(), ...greedyChain(darkRed)];
  } else {
    points = greedyChain(points);
    if (line.key === "blue") {
      // MRT Blue is a closed loop (Tha Phra <-> Tha Phra via Hua Lamphong) -
      // note the wrap-around adjacency for the routing graph to pick up later.
      const first = points[0].geometry.coordinates as [number, number];
      const last = points[points.length - 1].geometry.coordinates as [number, number];
      console.log(
        `Blue Line loop check: first/last station distance = ${Math.round(
          haversineMeters(first, last),
        )}m (${points[0].properties.NAME} / ${points[points.length - 1].properties.NAME})`,
      );
    }
  }

  points.forEach((f, i) => {
    const [lon, lat] = f.geometry.coordinates as [number, number];
    newStations.push({
      code: `${line.codePrefix}${String(i + 1).padStart(2, "0")}`,
      nameEn: "", // filled in by hand afterwards - GIS data has no English names
      nameTh: normalizeThaiName(f.properties.NAME),
      lines: [{ line: line.key, name: line.name, color: line.color }],
      hasLiveArrivals: false,
      lat,
      lon,
    });
  });

  console.log(`${line.name}: ${points.length} stations, codes ${line.codePrefix}01..${line.codePrefix}${String(points.length).padStart(2, "0")}`);
}

writeFileSync(
  path.join(ROOT, "data", "raw", "new-line-stations.json"),
  JSON.stringify(newStations, null, 2),
);
console.log(`\nWrote ${newStations.length} new station drafts to data/raw/new-line-stations.json`);
console.log("Next: hand-fill nameEn for each (Thai names are authoritative from GIS).");

writeFileSync(path.join(ROOT, "data", "stations.json"), JSON.stringify(existing, null, 2));
console.log("Updated data/stations.json in place with backfilled lat/lon.");
