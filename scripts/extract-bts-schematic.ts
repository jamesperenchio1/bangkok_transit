/**
 * Extracts the BTS route-map schematic geometry into data/canonical/bts-schematic.json.
 *
 * Run manually (`npm run extract-schematic`); the output is committed. Nothing here
 * executes at request time — bts.co.th is scraped once, not depended on in production.
 *
 * Two sources are joined:
 *
 *  1. bts.co.th/eng/routemap.html — renders a 4961px JPEG with 118 absolutely-positioned
 *     `<span class="station-pointer">` hotspots layered over it. Each hotspot carries
 *     `data-px`/`data-py` (a 1380x1380 coordinate space), `data-station-key`, both names,
 *     and `data-station-id`. Those coordinates are the schematic layout as plain data,
 *     which is what lets us draw our own SVG instead of shipping their image.
 *
 *  2. bts-api.topmile.com/stations — the authoritative catalog, whose `id` matches the
 *     page's `data-station-id` exactly. Only Sukhumvit and Silom appear here, and only
 *     those stations have live arrivals; Gold/Yellow/Pink return
 *     `{"detail":"this Line is unavailable"}` from /arrivals.
 */
import { promises as fs } from "fs";
import path from "path";

const ROUTEMAP_URL = "https://www.bts.co.th/eng/routemap.html";
const API_STATIONS_URL = "https://bts-api.topmile.com/stations";
const OUT_PATH = path.join(process.cwd(), "data", "canonical", "bts-schematic.json");

// The hotspots are positioned against the 1380x1380 rendering of the map image.
const CANVAS = 1380;

// Line ids are the operator's own, shared by both the page and the API.
const LINES = [
  { id: 1, key: "sukhumvit", nameEn: "Sukhumvit Line", nameTh: "สายสุขุมวิท", color: "#7AB420" },
  { id: 2, key: "silom", nameEn: "Silom Line", nameTh: "สายสีลม", color: "#00807D" },
  { id: 3, key: "gold", nameEn: "Gold Line", nameTh: "สายสีทอง", color: "#a88b34" },
  { id: 4, key: "yellow", nameEn: "Yellow Line", nameTh: "สายสีเหลือง", color: "#FAD53D" },
  { id: 5, key: "pink", nameEn: "Pink Line", nameTh: "สายสีชมพู", color: "#D76886" },
];

// Only these two lines serve /arrivals.
const LIVE_LINE_IDS = new Set([1, 2]);

// Siam is the Sukhumvit/Silom interchange. The page lists it only under Sukhumvit,
// but the Silom track physically runs through it, so it has to be spliced into
// Silom's sequence (between W1 and S1) for that polyline to render correctly.
const SHARED_CODE = "CEN";

// Sena Ruam: /arrivals/N6 returns real train data, but the station is absent from
// both the official map and the API catalog (it was planned between N5 and N7 and
// never built). Kept only so the API route accepts the code rather than 404ing.
const PHANTOM_CODES = ["N6"];

// Branches that leave the main trunk mid-line. Without this the Pink line's
// Muang Thong Thani spur would be drawn as one 893px segment from PK30 (the far
// east end) back across the map to MT01 — every other segment on every line is
// under 75px, so a jump that size is the tell. The spur actually leaves at PK10.
const BRANCHES: Record<string, { from: string; codes: string[] }[]> = {
  pink: [{ from: "PK10", codes: ["MT01", "MT02"] }],
};

interface Hotspot {
  code: string;
  x: number;
  y: number;
  lineId: number;
  nameEn: string;
  nameTh: string;
  apiStationId: number | null;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, k, v] of tag.matchAll(/data-([a-z-]+)="([^"]*)"/g)) out[k] = v;
  return out;
}

function px(value: string | undefined): number {
  return Number.parseInt((value ?? "").replace("px", ""), 10);
}

async function get(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120" },
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

function parseHotspots(html: string): Hotspot[] {
  const tags = html.match(/<span class="station-pointer"[^>]*>/g) ?? [];
  const spots: Hotspot[] = [];

  for (const tag of tags) {
    const a = attrs(tag);
    const code = (a["station-key"] ?? "").toUpperCase();
    const x = px(a["px"]);
    const y = px(a["py"]);
    const lineId = Number.parseInt(a["station-line-id"] ?? "", 10);

    if (!code || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(lineId)) {
      throw new Error(`unparseable station-pointer: ${tag}`);
    }

    spots.push({
      code,
      x,
      y,
      lineId,
      // Thai names on the page carry stray trailing whitespace.
      nameEn: (a["st-name-en"] ?? "").trim(),
      nameTh: (a["st-name-th"] ?? "").trim(),
      apiStationId: Number.parseInt(a["station-id"] ?? "", 10) || null,
    });
  }

  return spots;
}

async function main() {
  console.log("fetching route map + station catalog...");
  const [html, catalogRaw] = await Promise.all([get(ROUTEMAP_URL), get(API_STATIONS_URL)]);

  const spots = parseHotspots(html);
  if (spots.length < 100) throw new Error(`expected ~118 hotspots, got ${spots.length}`);

  // id -> code, used to confirm the join and to prove which stations carry live data.
  const catalog = JSON.parse(catalogRaw) as {
    lines: { id: number; stations: { id: number; code: string }[] }[];
  };
  const apiCodeById = new Map<number, string>();
  for (const line of catalog.lines) {
    for (const s of line.stations) apiCodeById.set(s.id, s.code.toUpperCase());
  }

  const byLine = new Map<number, Hotspot[]>();
  for (const spot of spots) {
    if (!byLine.has(spot.lineId)) byLine.set(spot.lineId, []);
    byLine.get(spot.lineId)!.push(spot);
  }

  // Splice Siam into the Silom sequence so its polyline runs through the interchange.
  const siam = spots.find((s) => s.code === SHARED_CODE);
  const silom = byLine.get(2);
  if (!siam) throw new Error(`${SHARED_CODE} (Siam) not found on the route map`);
  if (!silom) throw new Error("Silom line not found on the route map");
  const w1 = silom.findIndex((s) => s.code === "W1");
  silom.splice(w1 + 1, 0, siam);

  let joined = 0;
  const lines = LINES.map((line) => {
    const stations = (byLine.get(line.id) ?? []).map((s) => {
      const apiCode = s.apiStationId ? apiCodeById.get(s.apiStationId) : undefined;
      // Trust the join only when the API agrees on the code, so a silent id
      // reshuffle upstream surfaces as missing live data rather than wrong data.
      const live = apiCode === s.code;
      if (live) joined++;
      return {
        code: s.code,
        x: s.x,
        y: s.y,
        nameEn: s.nameEn,
        nameTh: s.nameTh,
        apiStationId: live ? s.apiStationId : null,
        hasLiveArrivals: live,
      };
    });

    if (!stations.length) throw new Error(`line ${line.id} (${line.key}) has no stations`);

    // Ordered code sequences for the renderer to stroke as polylines. Splitting
    // branches out here keeps the map component free of network topology.
    const branches = BRANCHES[line.key] ?? [];
    const branchCodes = new Set(branches.flatMap((b) => b.codes));
    const trunk = stations.map((s) => s.code).filter((c) => !branchCodes.has(c));
    const segments = [trunk, ...branches.map((b) => [b.from, ...b.codes])];

    for (const b of branches) {
      if (!trunk.includes(b.from)) {
        throw new Error(`branch junction ${b.from} is not on the ${line.key} trunk`);
      }
    }

    return { ...line, hasLiveArrivals: LIVE_LINE_IDS.has(line.id), segments, stations };
  });

  // Every real segment on this map is a short hop between neighbouring stations.
  // Anything much longer means a branch we failed to split, so fail loudly here
  // rather than shipping a line that slashes across the diagram.
  const MAX_SEGMENT_PX = 150;
  for (const line of lines) {
    const at = new Map(line.stations.map((s) => [s.code, s]));
    for (const seg of line.segments) {
      for (let i = 1; i < seg.length; i++) {
        const a = at.get(seg[i - 1])!;
        const b = at.get(seg[i])!;
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d > MAX_SEGMENT_PX) {
          throw new Error(
            `${line.key}: ${seg[i - 1]}->${seg[i]} spans ${Math.round(d)}px — likely an unsplit branch`
          );
        }
      }
    }
  }

  const liveCodes = [
    ...new Set([
      ...lines.flatMap((l) => l.stations.filter((s) => s.hasLiveArrivals).map((s) => s.code)),
      ...PHANTOM_CODES,
    ]),
  ].sort();

  const out = {
    // Provenance, so the next person knows this file is generated and from where.
    source: ROUTEMAP_URL,
    generatedAt: new Date().toISOString(),
    canvas: { width: CANVAS, height: CANVAS },
    liveCodes,
    lines,
  };

  await fs.writeFile(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`, "utf8");

  const total = lines.reduce((n, l) => n + l.stations.length, 0);
  console.log(`wrote ${OUT_PATH}`);
  console.log(`  ${lines.length} lines, ${total} station nodes (${joined} joined to the live API)`);
  console.log(`  ${liveCodes.length} live codes (incl. ${PHANTOM_CODES.length} phantom)`);
  for (const l of lines) console.log(`  ${l.key.padEnd(10)} ${l.stations.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
