/**
 * Extracts the REAL curved track geometry from data/raw/bma-lines.geojson
 * (BMA's GIS data - see scripts/fetch-transit-network.ts) into
 * data/line-geometry.json, keyed by our LineKey. This is what
 * components/TransitMap.tsx draws for each line - straight station-to-
 * station segments (derived from data/line-sequences.json) look nothing
 * like the real track, which curves along roads/rivers between stops.
 *
 * A line can map to multiple GIS features (built in phases, or with a
 * branch) and each feature can be a LineString or a MultiLineString - all
 * of it is flattened into a list of independent coordinate "segments" per
 * line. Segments are NOT stitched into one continuous path (the source data
 * doesn't guarantee they'd line up end-to-end), so a line renders as however
 * many disjoint segments its source features contain - visually this is
 * indistinguishable from one continuous line since they physically connect
 * on the ground.
 *
 * Run: node --experimental-strip-types scripts/build-line-geometry.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const OPERATIONAL = "โครงข่ายปัจจุบันที่เปิดให้บริการแล้ว";

type LatLon = [number, number];

interface GisLineFeature {
  type: "Feature";
  geometry:
    | { type: "LineString"; coordinates: [number, number][] }
    | { type: "MultiLineString"; coordinates: [number, number][][] };
  properties: { COLOR_E: string; STATUS: string };
}

const features: GisLineFeature[] = JSON.parse(
  readFileSync(path.join(ROOT, "data", "raw", "bma-lines.geojson"), "utf8"),
).features;

// GIS COLOR_E -> our LineKey. Dark Red + Light Red (two branches of one SRT
// system) both map to "srtRed". Orange Line is excluded - every feature is
// STATUS "under construction" (not open, not on the reference map).
const COLOR_TO_LINE_KEY: Record<string, string> = {
  "green line": "sukhumvit",
  "dark green line": "silom",
  "gold line": "gold",
  "yellow line": "yellow",
  "pink line": "pink",
  "blue line": "blue",
  "purple line": "purple",
  "airport rail link": "arl",
  "dark red line": "srtRed",
  "light red line": "srtRed",
};

const segmentsByLine: Record<string, LatLon[][]> = {};

function addSegment(lineKey: string, coords: [number, number][]) {
  (segmentsByLine[lineKey] ??= []).push(coords.map(([lon, lat]) => [lat, lon] as LatLon));
}

for (const f of features) {
  if (f.properties.STATUS !== OPERATIONAL) continue;
  const lineKey = COLOR_TO_LINE_KEY[f.properties.COLOR_E.toLowerCase()];
  if (!lineKey) continue;

  if (f.geometry.type === "LineString") {
    addSegment(lineKey, f.geometry.coordinates);
  } else {
    for (const part of f.geometry.coordinates) addSegment(lineKey, part);
  }
}

writeFileSync(
  path.join(ROOT, "data", "line-geometry.json"),
  JSON.stringify(segmentsByLine),
);

for (const [line, segments] of Object.entries(segmentsByLine)) {
  const points = segments.reduce((n, s) => n + s.length, 0);
  console.log(`${line}: ${segments.length} segment(s), ${points} points`);
}
