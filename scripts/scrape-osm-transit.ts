#!/usr/bin/env tsx
/**
 * scripts/scrape-osm-transit.ts
 *
 * Scrapes Bangkok transit station data from OpenStreetMap via Overpass API.
 * Fills in missing stations (MRT Yellow, Pink lines; Silom gaps) and keeps
 * existing station IDs stable so the routing graph doesn't break.
 *
 * Usage:
 *   npm run scrape            — merge OSM data into data/canonical/
 *   npm run scrape -- --dry-run   — preview changes, write nothing
 *   npm run scrape -- --fresh     — bypass 24h response cache
 */

import fs from "fs/promises";
import https from "https";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OsmNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

interface OsmRelation {
  type: "relation";
  id: number;
  tags: Record<string, string>;
  members: Array<{
    type: "node" | "way" | "relation";
    ref: number;
    role: string;
  }>;
}

interface OsmWay {
  type: "way";
  id: number;
  geometry: { lat: number; lon: number }[];
}

interface Station {
  id: string;
  nameEn: string;
  nameTh: string;
  codes: string[];
  lineIds: string[];
  lat: number;
  lng: number;
  isInterchange: boolean;
  adjacentStationIds: string[];
}

interface Line {
  id: string;
  operatorId: string;
  nameEn: string;
  nameTh: string;
  shortName: string;
  color: string;
  textColor: string;
  mode: string;
  status: string;
  openingDate?: string;
  stationIds: string[];
}

// ---------------------------------------------------------------------------
// Line registry — maps our internal IDs to OSM name/tag patterns
// ---------------------------------------------------------------------------

const LINE_REGISTRY: Record<
  string,
  { patterns: string[]; prefix: string }
> = {
  "bts-sukhumvit": { patterns: ["sukhumvit", "สุขุมวิท"], prefix: "bts" },
  "bts-silom":     { patterns: ["silom", "สีลม"], prefix: "bts" },
  "bts-gold":      { patterns: ["gold line", "สีทอง"], prefix: "bts" },
  "mrt-blue":      { patterns: ["blue line", "สีน้ำเงิน", "chaloem ratchamongkhon"], prefix: "mrt" },
  "mrt-purple":    { patterns: ["purple line", "สีม่วง", "chalong ratchadham"], prefix: "mrt" },
  "mrt-yellow":    { patterns: ["yellow line", "สีเหลือง", "eastern bangkok monorail"], prefix: "mrt" },
  "mrt-pink":      { patterns: ["pink line", "สีชมพู", "northern bangkok monorail"], prefix: "mrt" },
  "arl-city":      { patterns: ["airport rail link", "แอร์พอร์ต เรล"], prefix: "arl" },
  "srt-dark-red":  { patterns: ["dark red", "สีแดงเข้ม", "red line north", "rangsit"], prefix: "srt" },
  "srt-light-red": { patterns: ["light red", "สีแดงอ่อน", "red line west", "taling chan"], prefix: "srt" },
  "brt-sathorn":   { patterns: ["bangkok brt", "brt sathorn"], prefix: "brt" },
};

// Roles that identify a stop node (not a platform or track)
const STOP_ROLES = new Set(["stop", "stop_entry_only", "stop_exit_only"]);

// Bangkok bounding box — south, west, north, east
const BBOX = "13.4,100.2,14.1,101.0";

const RELATIONS_QUERY = `[out:json][timeout:90];
(
  relation["route"="subway"](${BBOX});
  relation["route"="light_rail"](${BBOX});
  relation["route"="monorail"](${BBOX});
  relation["route"="rail"]["name"~"(ARL|Airport Rail|SRT|Red Line|รถไฟฟ้า)"](${BBOX});
  relation["route"="bus"]["network"~"(BRT|Bangkok BRT)"](${BBOX});
);
out body;`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATA_DIR   = path.join(process.cwd(), "data/canonical");
const CACHE_DIR  = path.join(process.cwd(), ".scraper-cache");
const OVERPASS   = "https://overpass-api.de/api/interpreter";

const USER_AGENT = "BangkokTransitApp/1.0 (open-source transit guide; contact via GitHub)";

type OverpassResponse = { elements: (OsmNode | OsmRelation | OsmWay)[] };

// Lines we pull real track geometry for (scope: BTS Skytrain only — see AGENTS.md)
const GEOMETRY_LINE_IDS = new Set(["bts-sukhumvit", "bts-silom", "bts-gold"]);

function httpsPost(path: string, body: string): Promise<OverpassResponse> {
  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(body, "utf-8");
    const opts = {
      hostname: "overpass-api.de",
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": bodyBuf.length,
        "User-Agent": USER_AGENT,
      },
    };
    const req = https.request(opts, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from Overpass`));
        res.resume();
        return;
      }
      let raw = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error(`Invalid JSON: ${raw.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    req.setTimeout(120_000, () => req.destroy(new Error("Timeout")));
    req.write(bodyBuf);
    req.end();
  });
}

function httpsGet(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "GET" }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        res.resume();
        return;
      }
      let raw = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error(`Invalid JSON response (first 200 chars): ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(120_000, () => {
      req.destroy(new Error("Request timed out after 120s"));
    });
    req.end();
  });
}

async function fetchOverpass(
  query: string,
  cacheKey: string,
  fresh: boolean
): Promise<OverpassResponse> {
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);

  if (!fresh) {
    try {
      const raw = await fs.readFile(cachePath, "utf-8");
      const { ts, data } = JSON.parse(raw) as { ts: number; data: OverpassResponse };
      const ageH = (Date.now() - ts) / 3_600_000;
      if (ageH < 24) {
        console.log(`  Cache hit: ${cacheKey} (${ageH.toFixed(1)}h old)`);
        return data;
      }
    } catch {
      // no cache or stale — fall through to fetch
    }
  }

  console.log(`  Fetching ${cacheKey} from Overpass API…`);
  let attempt = 0;
  while (true) {
    try {
      const data = await httpsPost("/api/interpreter", `data=${encodeURIComponent(query)}`);
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(cachePath, JSON.stringify({ ts: Date.now(), data }));
      return data;
    } catch (err) {
      attempt++;
      if (attempt >= 3) throw err;
      const wait = attempt * 10_000;
      console.log(`  Overpass error (attempt ${attempt}), retrying in ${wait / 1000}s…`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

function matchLineId(rel: OsmRelation): string | null {
  const tags = rel.tags ?? {};
  const haystack = [
    tags.name,
    tags["name:en"],
    tags["name:th"],
    tags.ref,
    tags.operator,
    tags.network,
    tags.colour,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const [lineId, { patterns }] of Object.entries(LINE_REGISTRY)) {
    for (const p of patterns) {
      if (haystack.includes(p.toLowerCase())) return lineId;
    }
  }
  return null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b(station|bts|mrt|arl|srt)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanNameEn(raw: string): string {
  return raw
    .replace(/\s+(Station|BTS Station|MRT Station|ARL Station)$/i, "")
    .trim();
}

function cleanNameTh(raw: string): string {
  // Remove leading "สถานี" (station) prefix
  return raw.replace(/^สถานี\s*/, "").trim();
}

// ---------------------------------------------------------------------------
// Line geometry — stitches a route relation's member ways into one ordered
// [lat, lng] path, so the map can draw the real track instead of straight
// lines between station dots.
// ---------------------------------------------------------------------------

const EPSILON = 1e-5; // ~1m, tolerance for matching way endpoints

function pointsEqual(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return Math.abs(a.lat - b.lat) < EPSILON && Math.abs(a.lon - b.lon) < EPSILON;
}

/**
 * Stitches an ordered list of way geometries into a single continuous path.
 * Route relations list member ways in travel order by mapping convention,
 * but individual ways aren't guaranteed to be drawn "forwards" — so each
 * way is oriented to connect to the end of the chain so far before appending.
 */
function stitchWays(ways: OsmWay[]): [number, number][] {
  const chain: { lat: number; lon: number }[] = [];

  for (const way of ways) {
    const geom = way.geometry;
    if (!geom || geom.length === 0) continue;

    if (chain.length === 0) {
      chain.push(...geom);
      continue;
    }

    const tail = chain[chain.length - 1];
    if (pointsEqual(tail, geom[0])) {
      chain.push(...geom.slice(1));
    } else if (pointsEqual(tail, geom[geom.length - 1])) {
      chain.push(...[...geom].reverse().slice(1));
    } else {
      // Discontinuity (gap in OSM mapping) — append as-is, best effort.
      chain.push(...geom);
    }
  }

  return chain.map((p) => [+p.lat.toFixed(6), +p.lon.toFixed(6)] as [number, number]);
}

async function fetchLineGeometry(
  lineRelations: Map<string, OsmRelation>,
  fresh: boolean
): Promise<Map<string, [number, number][]>> {
  const result = new Map<string, [number, number][]>();

  for (const [lineId, rel] of lineRelations) {
    if (!GEOMETRY_LINE_IDS.has(lineId)) continue;

    const wayIds: number[] = [];
    const seen = new Set<number>();
    for (const m of rel.members) {
      if (m.type !== "way") continue;
      if (seen.has(m.ref)) continue;
      seen.add(m.ref);
      wayIds.push(m.ref);
    }
    if (wayIds.length === 0) {
      console.log(`  ${lineId}: no way members, skipping geometry`);
      continue;
    }

    const query = `[out:json][timeout:90];\nway(id:${wayIds.join(",")});\nout geom;`;
    const data = await fetchOverpass(query, `geometry-${lineId}`, fresh);

    // Preserve relation member order, not Overpass response order.
    const wayById = new Map<number, OsmWay>();
    for (const el of data.elements) {
      if (el.type === "way") wayById.set((el as OsmWay).id, el as OsmWay);
    }
    const orderedWays = wayIds.map((id) => wayById.get(id)).filter((w): w is OsmWay => !!w);

    const path = stitchWays(orderedWays);
    if (path.length >= 2) {
      result.set(lineId, path);
      console.log(`  ${lineId}: ${path.length} track points from ${orderedWays.length} ways`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const fresh  = process.argv.includes("--fresh");

  console.log("Bangkok Transit — OSM scraper");
  if (dryRun) console.log("DRY RUN — no files will be written\n");

  // Load existing canonical data
  const existingStations: Station[] = JSON.parse(
    await fs.readFile(path.join(DATA_DIR, "stations.json"), "utf-8")
  );
  const existingLines: Line[] = JSON.parse(
    await fs.readFile(path.join(DATA_DIR, "lines.json"), "utf-8")
  );

  // ---------- Step 1: fetch route relations ----------
  console.log("\n[1/4] Fetching route relations…");
  const relData = await fetchOverpass(RELATIONS_QUERY, "relations", fresh);
  const relations = relData.elements.filter(
    (e): e is OsmRelation => e.type === "relation"
  );
  console.log(`  Found ${relations.length} relations`);

  // ---------- Step 2: match relations to our lines ----------
  console.log("\n[2/4] Matching relations to lines…");

  // Group by line ID; keep the relation with most stop members per line
  const lineRelations = new Map<string, OsmRelation>();
  const unmatched: string[] = [];

  for (const rel of relations) {
    const lineId = matchLineId(rel);
    if (!lineId) {
      const name = rel.tags?.name ?? rel.tags?.["name:en"] ?? `relation/${rel.id}`;
      unmatched.push(name);
      continue;
    }
    const stops = rel.members.filter(
      m => m.type === "node" && STOP_ROLES.has(m.role)
    ).length;
    const existing = lineRelations.get(lineId);
    const existingStops = existing
      ? existing.members.filter(m => m.type === "node" && STOP_ROLES.has(m.role)).length
      : -1;
    if (stops > existingStops) lineRelations.set(lineId, rel);
  }

  for (const [lineId, rel] of lineRelations) {
    const stopCount = rel.members.filter(
      m => m.type === "node" && STOP_ROLES.has(m.role)
    ).length;
    console.log(`  ${lineId}: ${stopCount} stops (relation ${rel.id})`);
  }
  if (unmatched.length > 0) {
    console.log(`  Unmatched (skipped):`);
    for (const n of unmatched.slice(0, 8)) console.log(`    - ${n}`);
    if (unmatched.length > 8) console.log(`    … and ${unmatched.length - 8} more`);
  }

  // Collect stop node IDs and their ordered position per line
  const lineStopNodeIds = new Map<string, number[]>();
  const allStopNodeIds = new Set<number>();

  for (const [lineId, rel] of lineRelations) {
    let stopMembers = rel.members
      .filter(m => m.type === "node" && STOP_ROLES.has(m.role))
      .map(m => m.ref);

    // Fallback: use platform nodes if no stop nodes found
    if (stopMembers.length === 0) {
      stopMembers = rel.members
        .filter(m => m.type === "node" && m.role === "platform")
        .map(m => m.ref);
      if (stopMembers.length > 0) {
        console.log(`  Note: ${lineId} using platform nodes as fallback`);
      }
    }

    // Deduplicate while preserving order
    const seen = new Set<number>();
    const ordered: number[] = [];
    for (const id of stopMembers) {
      if (!seen.has(id)) {
        seen.add(id);
        ordered.push(id);
        allStopNodeIds.add(id);
      }
    }
    if (ordered.length > 0) lineStopNodeIds.set(lineId, ordered);
  }

  if (allStopNodeIds.size === 0) {
    console.log("\nNo stop nodes found — nothing to update. Exiting.");
    return;
  }

  // ---------- Step 3: fetch node details ----------
  console.log(`\n[3/4] Fetching ${allStopNodeIds.size} stop node details…`);
  const nodeIds = Array.from(allStopNodeIds).join(",");
  const NODES_QUERY = `[out:json][timeout:60];\nnode(id:${nodeIds});\nout body;`;
  const nodeData = await fetchOverpass(NODES_QUERY, "stop-nodes", fresh);
  const nodeMap = new Map<number, OsmNode>();
  for (const el of nodeData.elements) {
    if (el.type === "node") nodeMap.set((el as OsmNode).id, el as OsmNode);
  }
  console.log(`  Retrieved ${nodeMap.size} nodes`);

  // ---------- Step 4: fetch real track geometry (BTS only) ----------
  console.log("\n[4/4] Fetching BTS line track geometry…");
  const lineGeometry = await fetchLineGeometry(lineRelations, fresh);

  // ---------- Merge with existing data ----------
  console.log("\nMerging with existing data…");

  // Build lookup maps over existing stations
  const stationsById  = new Map<string, Station>(existingStations.map(s => [s.id, s]));
  const stationsByNorm = new Map<string, Station>(
    existingStations.map(s => [normName(s.nameEn), s])
  );

  const updatedLines = existingLines.map(l => ({ ...l }));
  const lineMap = new Map(updatedLines.map(l => [l.id, l]));

  let newCount = 0;
  let coordUpdateCount = 0;

  for (const [lineId, nodeIds] of lineStopNodeIds) {
    const config = LINE_REGISTRY[lineId];
    if (!config) continue;

    const resolvedIds: string[] = [];

    for (const nodeId of nodeIds) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;

      const rawNameEn = node.tags?.["name:en"] ?? node.tags?.name ?? "";
      const rawNameTh = node.tags?.["name:th"] ?? "";
      const ref       = node.tags?.ref ?? "";

      if (!rawNameEn && !rawNameTh) continue;

      const nameEn = cleanNameEn(rawNameEn);
      const nameTh = cleanNameTh(rawNameTh);

      // Try exact then fuzzy match against existing stations
      let match = stationsByNorm.get(normName(nameEn));
      if (!match && nameEn) {
        // Try without trailing suffixes
        const stripped = normName(nameEn).replace(/\s*(station|bts|mrt|arl)$/, "").trim();
        match = stationsByNorm.get(stripped);
      }

      if (match) {
        // Station already exists — update coords if OSM is meaningfully different
        const dLat = Math.abs(match.lat - node.lat);
        const dLng = Math.abs(match.lng - node.lon);
        if (dLat > 0.0005 || dLng > 0.0005) {
          match.lat = +node.lat.toFixed(6);
          match.lng = +node.lon.toFixed(6);
          coordUpdateCount++;
        }
        // Ensure this line is listed
        if (!match.lineIds.includes(lineId)) {
          match.lineIds.push(lineId);
        }
        resolvedIds.push(match.id);
      } else {
        // New station — generate a stable ID
        const stationId = `${config.prefix}-${slugify(nameEn || nameTh)}`;

        if (stationsById.has(stationId)) {
          // Already created in this run (e.g., interchange)
          const s = stationsById.get(stationId)!;
          if (!s.lineIds.includes(lineId)) s.lineIds.push(lineId);
          resolvedIds.push(stationId);
        } else {
          const station: Station = {
            id: stationId,
            nameEn: nameEn || nameTh,
            nameTh: nameTh || nameEn,
            codes: ref ? [ref] : [],
            lineIds: [lineId],
            lat: +node.lat.toFixed(6),
            lng: +node.lon.toFixed(6),
            isInterchange: false,
            adjacentStationIds: [],
          };
          stationsById.set(stationId, station);
          stationsByNorm.set(normName(station.nameEn), station);
          newCount++;
          resolvedIds.push(stationId);
          console.log(`  + ${stationId}  (${nameEn || nameTh})`);
        }
      }
    }

    // Update line stationIds — smart merge to never lose existing stations
    const line = lineMap.get(lineId);
    if (line && resolvedIds.length > 0) {
      const old = line.stationIds.length;

      if (resolvedIds.length > old) {
        // OSM has more stations — its list is clearly more complete, use it
        line.stationIds = resolvedIds;
      } else {
        // OSM has equal or fewer — keep existing list but splice in any new stations
        const existingSet = new Set(line.stationIds);
        const genuinelyNew = resolvedIds.filter(id => !existingSet.has(id));

        if (genuinelyNew.length > 0) {
          const newIdSet = new Set(genuinelyNew);
          const result = [...line.stationIds];
          let i = 0;

          while (i < resolvedIds.length) {
            if (!newIdSet.has(resolvedIds[i])) { i++; continue; }

            // Found the start of a consecutive run of new stations
            const runStart = i;
            while (i < resolvedIds.length && newIdSet.has(resolvedIds[i])) i++;
            const runEnd = i;

            const newRun = resolvedIds.slice(runStart, runEnd);
            const prevAnchor = runStart > 0 ? resolvedIds[runStart - 1] : null;
            const nextAnchor = runEnd < resolvedIds.length ? resolvedIds[runEnd] : null;

            // Find the best insertion point using OSM neighbor anchors
            let insertAt = result.length;
            if (prevAnchor) {
              const idx = result.indexOf(prevAnchor);
              if (idx !== -1) insertAt = idx + 1;
            } else if (nextAnchor) {
              const idx = result.indexOf(nextAnchor);
              if (idx !== -1) insertAt = idx;
            }

            result.splice(insertAt, 0, ...newRun);
          }

          line.stationIds = result;
        }
      }

      if (old !== line.stationIds.length) {
        console.log(`  ${lineId}: ${old} → ${line.stationIds.length} stations`);
      }
    }
  }

  // Build final arrays (existing order + new stations at the end)
  const finalStations = [
    ...existingStations.map(s => stationsById.get(s.id) ?? s),
    ...Array.from(stationsById.values()).filter(
      s => !existingStations.some(e => e.id === s.id)
    ),
  ];
  const finalLines = updatedLines;

  // ---------- Summary ----------
  console.log("\n=== Summary ===");
  console.log(`  New stations added:         ${newCount}`);
  console.log(`  Station coords updated:     ${coordUpdateCount}`);
  console.log(`  Total stations:             ${finalStations.length}`);
  console.log(`  Line geometries fetched:    ${lineGeometry.size}`);

  if (dryRun) {
    console.log("\nDry run — no files written.");
    return;
  }

  await fs.writeFile(
    path.join(DATA_DIR, "stations.json"),
    JSON.stringify(finalStations, null, 2) + "\n"
  );
  await fs.writeFile(
    path.join(DATA_DIR, "lines.json"),
    JSON.stringify(finalLines, null, 2) + "\n"
  );
  console.log("\ndata/canonical/stations.json updated");
  console.log("data/canonical/lines.json updated");

  if (lineGeometry.size > 0) {
    // Merge into any existing geometry file rather than overwriting other lines.
    let existingGeometry: Record<string, [number, number][]> = {};
    try {
      existingGeometry = JSON.parse(
        await fs.readFile(path.join(DATA_DIR, "line_geometry.json"), "utf-8")
      );
    } catch {
      // no existing file yet
    }
    const mergedGeometry = { ...existingGeometry, ...Object.fromEntries(lineGeometry) };
    await fs.writeFile(
      path.join(DATA_DIR, "line_geometry.json"),
      JSON.stringify(mergedGeometry, null, 2) + "\n"
    );
    console.log("data/canonical/line_geometry.json updated");
  }
}

main().catch(err => {
  console.error("\nScraper failed:", err);
  process.exit(1);
});
