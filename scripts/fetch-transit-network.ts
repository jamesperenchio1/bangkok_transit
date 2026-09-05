/**
 * One-off fetch of Bangkok's rail network geometry from BMA's public ArcGIS REST
 * API. Run manually (not part of `npm run build`/CI) whenever the network changes
 * (new line/station openings) - this data does not change day to day.
 *
 * Usage: node --experimental-strip-types scripts/fetch-transit-network.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE =
  "https://cityplangis.bangkok.go.th/arcgis/rest/services/bma/Basemap/MapServer";
const STATIONS_LAYER = 1; // "สถานีรถไฟฟ้า"
const LINES_LAYER = 3; // "รถไฟฟ้า"

const OUT_DIR = path.join(import.meta.dirname, "..", "data", "raw");

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function main() {
  // The service's native storage SR is UTM zone 47N (wkid 32647), but requesting
  // f=geojson (below) always gets ArcGIS Server to reproject output to WGS84
  // (GeoJSON spec requires lon/lat degrees) - verified against a live sample
  // (coordinates come back as ~100.x/13.x, not UTM meters), so no manual
  // reprojection is needed here.
  const layerMeta = await fetchJson(`${BASE}/${STATIONS_LAYER}?f=json`);
  console.log(
    `Native storage SR wkid=${layerMeta?.extent?.spatialReference?.wkid} ` +
      `(irrelevant - fetching as f=geojson below, which is always WGS84)`,
  );

  const stations = await fetchJson(
    `${BASE}/${STATIONS_LAYER}/query?where=1=1&outFields=*&f=geojson`,
  );
  const lines = await fetchJson(
    `${BASE}/${LINES_LAYER}/query?where=1=1&outFields=*&f=geojson`,
  );

  console.log(`Fetched ${stations.features?.length ?? 0} station features`);
  console.log(`Fetched ${lines.features?.length ?? 0} line-geometry features`);

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    path.join(OUT_DIR, "bma-stations.geojson"),
    JSON.stringify(stations, null, 2),
  );
  await writeFile(
    path.join(OUT_DIR, "bma-lines.geojson"),
    JSON.stringify(lines, null, 2),
  );
  console.log(`Wrote data/raw/bma-stations.geojson and data/raw/bma-lines.geojson`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
