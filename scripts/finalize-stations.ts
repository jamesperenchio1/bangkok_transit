/**
 * Merges the 75 new-line station drafts (data/raw/new-line-stations.json) into
 * data/stations.json, combining any pair that are the same physical station
 * (e.g. MRT Blue's Tao Poon + MRT Purple's Tao Poon, ~10m apart in the raw
 * data - genuinely one interchange building) into a single record with both
 * lines. Run after fill-english-names.ts.
 *
 * Run: node --experimental-strip-types scripts/finalize-stations.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");

interface NewStation {
  code: string;
  nameEn: string;
  nameTh: string;
  lines: { line: string; name: string; color: string }[];
  hasLiveArrivals: boolean;
  lat: number;
  lon: number;
}

const drafts: NewStation[] = JSON.parse(
  readFileSync(path.join(ROOT, "data", "raw", "new-line-stations.json"), "utf8"),
);
const existing = JSON.parse(
  readFileSync(path.join(ROOT, "data", "stations.json"), "utf8"),
);

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

// Merge same-physical-station drafts (same Thai name, within ~50m) into one
// record with a combined lines[] array - only real duplicates, not proximity
// transfers between distinct stations (those are handled at graph-build time).
const merged: NewStation[] = [];
const used = new Set<number>();
for (let i = 0; i < drafts.length; i++) {
  if (used.has(i)) continue;
  const group = [drafts[i]];
  used.add(i);
  for (let j = i + 1; j < drafts.length; j++) {
    if (used.has(j)) continue;
    if (
      drafts[i].nameTh === drafts[j].nameTh &&
      haversineMeters([drafts[i].lon, drafts[i].lat], [drafts[j].lon, drafts[j].lat]) < 50
    ) {
      group.push(drafts[j]);
      used.add(j);
    }
  }
  const primary = group[0];
  merged.push({
    ...primary,
    lines: group.flatMap((g) => g.lines),
  });
  if (group.length > 1) {
    console.log(
      `Merged ${group.length} duplicate entries for "${primary.nameTh}" -> ${primary.code} (${group.map((g) => g.lines[0].line).join("+")})`,
    );
  }
}

const final = [...existing, ...merged];
writeFileSync(
  path.join(ROOT, "data", "stations.json"),
  JSON.stringify(final, null, 2),
);
console.log(`\nFinal station count: ${final.length} (was ${existing.length}, added ${merged.length})`);
