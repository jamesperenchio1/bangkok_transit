/**
 * Builds data/line-sequences.json - the ordered per-line stop sequence the
 * routing graph (lib/transit-graph.ts) needs, since nothing in the source data
 * provides stop order/adjacency directly.
 *
 * BTS Sukhumvit/Silom and Gold/Yellow/Pink already carry official numbered
 * codes in physical stop order (verified by inspection) - sorted here with a
 * numeric-aware comparator. The one exception is N6 (Sena Ruam), added to the
 * BTS Sukhumvit line after the original numbering and appended at the end of
 * data/stations.json out of physical order - it sits between N7 and N5.
 * Blue/Purple/ARL/Red were already assigned codes in physical order by
 * scripts/build-stations.ts's geometric nearest-neighbor chaining, so a plain
 * numeric sort on those codes reproduces that order.
 *
 * Run: node --experimental-strip-types scripts/build-line-sequences.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Station } from "../data/stations.ts";

const ROOT = path.join(import.meta.dirname, "..");
const stations: Station[] = JSON.parse(
  readFileSync(path.join(ROOT, "data", "stations.json"), "utf8"),
);

function codeSortKey(code: string): [string, number] {
  const m = code.match(/^([A-Za-z]+)(\d+)$/);
  if (!m) return [code, 0];
  return [m[1], Number(m[2])];
}

const SUKHUMVIT_ORDER = [
  "N24", "N23", "N22", "N21", "N20", "N19", "N18", "N17", "N16", "N15",
  "N14", "N13", "N12", "N11", "N10", "N9", "N8", "N7", "N6", "N5", "N4",
  "N3", "N2", "N1", "CEN", "E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8",
  "E9", "E10", "E11", "E12", "E13", "E14", "E15", "E16", "E17", "E18",
  "E19", "E20", "E21", "E22", "E23",
];

// National Stadium -> Siam -> Bang Wa. Mixed prefixes (W/CEN/S) mean a plain
// alphabetic/numeric sort would misorder this one too.
const SILOM_ORDER = [
  "W1", "CEN", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10",
  "S11", "S12",
];

// PK01..PK30 is the main line in physical order; MT01/MT02 (Muang Thong Thani)
// are a branch spur off the main line, not an inline continuation - appended
// at the end here (as the pre-existing dataset already ordered them) since
// they're an unopened extension with no live relevance to routing today.
const PINK_ORDER = [
  "PK01", "PK02", "PK03", "PK04", "PK05", "PK06", "PK07", "PK08", "PK09",
  "PK10", "PK11", "PK12", "PK13", "PK14", "PK15", "PK16", "PK17", "PK18",
  "PK19", "PK20", "PK21", "PK22", "PK23", "PK24", "PK25", "PK26", "PK27",
  "PK28", "PK29", "PK30", "MT01", "MT02",
];

// Tao Poon (the Purple Line's northern terminus) got merged into the Blue
// Line's "BL31" record during finalize-stations.ts (same physical station,
// ~10m apart in the source data) - so it must be placed last here by code
// "BL31", not sorted alphabetically among the "PP" codes (which would put it
// first and badly misorder the line).
const PURPLE_ORDER = [
  "PP01", "PP02", "PP03", "PP04", "PP05", "PP06", "PP07", "PP08", "PP09",
  "PP10", "PP11", "PP12", "PP13", "PP14", "PP15", "BL31",
];

const EXPLICIT_ORDERS: Record<string, string[]> = {
  sukhumvit: SUKHUMVIT_ORDER,
  silom: SILOM_ORDER,
  pink: PINK_ORDER,
  purple: PURPLE_ORDER,
};

const lineKeys = [...new Set<string>(stations.flatMap((s) => s.lines.map((l) => l.line)))];

const sequences: Record<string, string[]> = {};
for (const line of lineKeys) {
  const codes = stations
    .filter((s) => s.lines.some((l) => l.line === line))
    .map((s) => s.code);

  if (EXPLICIT_ORDERS[line]) {
    const missing = codes.filter((c: string) => !EXPLICIT_ORDERS[line].includes(c));
    if (missing.length) throw new Error(`${line}: unordered codes ${missing}`);
    sequences[line] = EXPLICIT_ORDERS[line];
    continue;
  }

  // Gold/Yellow/Pink/Blue/Purple/ARL/Red all already carry codes in physical
  // stop order - a numeric-aware sort on the numeric suffix reproduces it.
  codes.sort((a: string, b: string) => {
    const [pa, na] = codeSortKey(a);
    const [pb, nb] = codeSortKey(b);
    return pa === pb ? na - nb : pa.localeCompare(pb);
  });
  sequences[line] = codes;
}

writeFileSync(
  path.join(ROOT, "data", "line-sequences.json"),
  JSON.stringify(sequences, null, 2),
);
for (const [line, codes] of Object.entries(sequences)) {
  console.log(`${line}: ${codes.length} stops - ${codes[0]} .. ${codes[codes.length - 1]}`);
}
