/**
 * Refreshes data/fares.json from official, public fare data. Run monthly by
 * .github/workflows/update-fares.yml:
 *
 *   node --experimental-strip-types scripts/scrape-fares.ts [--dry-run] [--gtfs-dir=DIR]
 *
 * Sources (all fetched here, never by the app - fares ship as static data):
 *  - BTS (Sukhumvit, Silom, Gold), MRT Purple, Airport Rail Link, MRT Yellow
 *    and Pink: the station-to-station fare rules in the Namtang GTFS feed that
 *    Thailand's transport policy office (สนข./OTP) publishes under CC-BY 4.0,
 *    https://namtang-api.otp.go.th/download/namtang-gtfs.zip. Same feed (and the
 *    same stop-to-station matching) as scripts/build-hop-times.ts.
 *  - SRT Red Line: the adult fare matrix on SRTET's own fare page.
 *  - MRT Blue: NOT taken from the feed. The feed still carries the pre-July-2026
 *    Blue fares (45 baht maximum); the Royal Gazette table of 26 May 2026 (17-44
 *    baht by stations travelled), reproduced by Thai PBS Verify, is current.
 *    Once the feed catches up this can move to it.
 *
 * Guards - on any failure the file is left untouched and the exit code is
 * non-zero, so the workflow fails (and emails the owner) instead of shipping
 * garbage to production:
 *  - every source must be fetchable and parse to a complete, plausible table
 *    (fares 10-100 baht, same-station = lowest fare, never decreasing with
 *    stops in a way the source itself contradicts);
 *  - a system may not lose more than 10% of the pairs it had;
 *  - no fare may move by more than MAX_CHANGE from the committed value.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const FILE = path.join(ROOT, "data", "fares.json");
const MAX_CHANGE = 0.3;
const MAX_LOST_PAIRS = 0.1;
// 600 m like build-hop-times.ts: large stations have several entrances, so a feed stop can sit a couple of hundred metres from our point.
const MAX_MATCH_METERS = 600;
const DRY_RUN = process.argv.includes("--dry-run");
const GTFS_URL = "https://namtang-api.otp.go.th/download/namtang-gtfs.zip";
const SRTET_URL = "https://www.srtet.co.th/th/fare-information";
const BLUE_URL = "https://www.thaipbs.or.th/verify/en/content/13302";

export interface FareSystem {
  name: string;
  nameTh: string;
  /** Lines this system prices. A ride on a line outside the list is unpriced. */
  lines: string[];
  effective: string | null;
  source: string;
  /** Fare in baht for a ride between two stations, keyed "A|B" with the codes sorted. */
  pairs?: Record<string, number>;
  /** Fare by stations travelled (index 0 = one station); used where only that table is published. */
  stopFares?: number[];
}
interface FareFile {
  retrievedAt: string;
  note: string;
  systems: Record<string, FareSystem>;
}
interface StationRow {
  code: string;
  nameEn: string;
  nameTh: string;
  lat: number;
  lon: number;
}

const stations: StationRow[] = JSON.parse(readFileSync(path.join(ROOT, "data", "stations.json"), "utf8"));
const sequences: Record<string, string[][]> = JSON.parse(readFileSync(path.join(ROOT, "data", "line-sequences.json"), "utf8"));
const byCode = new Map(stations.map((s) => [s.code, s]));

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const codesOf = (lines: string[]) => [...new Set(lines.flatMap((l) => sequences[l].flat()))];

function haversine(a: [number, number], b: [number, number]): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Minimal RFC 4180 reader (quoted fields, "" escapes). For the small files with free text. */
function readCsv(file: string): Record<string, string>[] {
  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/** The two big fare files are all-numeric quoted fields, so a plain split is exact and fast. */
function readSimple(file: string): { header: string[]; rows: string[][] } {
  const lines = readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const split = (l: string) => l.split(",").map((f) => f.replace(/^"|"$/g, ""));
  return { header: split(lines[0]), rows: lines.slice(1).map(split) };
}

async function text(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { "user-agent": "bangkok-transit-fare-check" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

function plain(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

async function gtfsDir(): Promise<string> {
  const given = process.argv.find((a) => a.startsWith("--gtfs-dir="))?.slice("--gtfs-dir=".length);
  if (given) return given;
  const dir = mkdtempSync(path.join(tmpdir(), "namtang-"));
  const res = await fetch(GTFS_URL, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`${GTFS_URL}: HTTP ${res.status}`);
  writeFileSync(path.join(dir, "g.zip"), Buffer.from(await res.arrayBuffer()));
  execFileSync("unzip", ["-o", "-q", path.join(dir, "g.zip"), "stops.txt", "routes.txt", "fare_attributes.txt", "fare_rules.txt", "feed_info.txt", "-d", dir]);
  return dir;
}

// --- GTFS systems ---

interface GtfsSpec {
  key: string;
  name: string;
  nameTh: string;
  lines: string[];
  agency: string;
  /** Route short name, or null for fares the feed leaves attached to no route. */
  route: string | null;
}
const GTFS_SYSTEMS: GtfsSpec[] = [
  { key: "bts", name: "BTS", nameTh: "บีทีเอส", lines: ["sukhumvit", "silom", "gold"], agency: "BTSC", route: null },
  { key: "purple", name: "MRT Purple", nameTh: "MRT สายสีม่วง", lines: ["purple"], agency: "BEM", route: "Purple" },
  { key: "arl", name: "Airport Rail Link", nameTh: "แอร์พอร์ต เรล ลิงก์", lines: ["arl"], agency: "SRTET", route: "ARL" },
  { key: "yellow", name: "MRT Yellow", nameTh: "MRT สายสีเหลือง", lines: ["yellow"], agency: "MRTA", route: "Yellow" },
  { key: "pink", name: "MRT Pink", nameTh: "MRT สายสีชมพู", lines: ["pink"], agency: "MRTA", route: "Pink" },
];

/**
 * The Gold Line is run by Krungthep Thanakom, not BTS, and charges a flat fare:
 * 17 baht from 1 January 2026, up from 16 (announced mid-December 2025: Prachachat
 * news-1937086, Daily News 5407119, Nation 40059831). The Namtang feed still
 * carries 16, so the feed's Gold pairs are overridden here, and a feed that
 * has caught up is noticed rather than silently re-trusted.
 */
const GOLD_FLAT_FARE = 17;
function applyGoldFare(pairs: Map<string, number>): void {
  const gold = new Set(codesOf(["gold"]));
  for (const key of [...pairs.keys()]) {
    const [a, b] = key.split("|");
    if (!gold.has(a) || !gold.has(b)) continue;
    if (pairs.get(key) !== GOLD_FLAT_FARE) console.warn(`gold    ${key}: feed says ${pairs.get(key)}, using the announced flat ${GOLD_FLAT_FARE}`);
    pairs.set(key, GOLD_FLAT_FARE);
  }
}

function gtfsSystems(dir: string): Record<string, FareSystem> {
  const feed = readCsv(path.join(dir, "feed_info.txt"))[0];
  const routes = readCsv(path.join(dir, "routes.txt"));
  const feedStops = new Map(readCsv(path.join(dir, "stops.txt")).map((s) => [s.stop_id, s]));
  const attrs = readSimple(path.join(dir, "fare_attributes.txt"));
  const price = new Map<string, number>();
  const fareAgency = new Map<string, string>();
  const [fi, pi, ai] = ["fare_id", "price", "agency_id"].map((h) => attrs.header.indexOf(h));
  for (const r of attrs.rows) {
    price.set(r[fi], Number(r[pi]));
    fareAgency.set(r[fi], r[ai]);
  }
  const rules = readSimple(path.join(dir, "fare_rules.txt"));
  const [ri, oi, di, fi2] = ["route_id", "origin_id", "destination_id", "fare_id"].map((h) => rules.header.indexOf(h));

  const out: Record<string, FareSystem> = {};
  for (const spec of GTFS_SYSTEMS) {
    const routeIds = new Set(
      spec.route === null ? [""] : routes.filter((r) => r.agency_id === spec.agency && r.route_short_name === spec.route).map((r) => r.route_id),
    );
    if (routeIds.size === 0) throw new Error(`${spec.key}: no feed route for ${spec.agency} "${spec.route}"`);

    const codes = codesOf(spec.lines);
    const stationOfStop = new Map<string, string>();
    const match = (stopId: string): string => {
      const cached = stationOfStop.get(stopId);
      if (cached) return cached;
      const s = feedStops.get(stopId);
      if (!s) throw new Error(`${spec.key}: fare rule names unknown stop ${stopId}`);
      const at: [number, number] = [Number(s.stop_lat), Number(s.stop_lon)];
      const [best] = codes
        .map((code) => ({ code, m: haversine(at, [byCode.get(code)!.lat, byCode.get(code)!.lon]) }))
        .sort((a, b) => a.m - b.m);
      if (best.m > MAX_MATCH_METERS) throw new Error(`${spec.key}: feed stop "${s.stop_name}" is ${Math.round(best.m)} m from the nearest station`);
      stationOfStop.set(stopId, best.code);
      return best.code;
    };

    const seen = new Map<string, number>();
    let conflicts = 0;
    for (const r of rules.rows) {
      if (!routeIds.has(r[ri]) || fareAgency.get(r[fi2]) !== spec.agency) continue;
      const p = price.get(r[fi2]);
      if (p === undefined || !(p > 0)) continue;
      const a = match(r[oi]);
      const b = match(r[di]);
      if (a === b) continue;
      const key = pairKey(a, b);
      const was = seen.get(key);
      // A pair seen twice (two feed stops for one station, or A->B vs B->A) that
      // disagrees takes the higher figure, which is the one a rider is charged
      // if the lower one is a data slip. Counted so a bad feed is noticed.
      if (was !== undefined && was !== p) conflicts++;
      seen.set(key, Math.max(was ?? 0, p));
    }
    if (spec.key === "bts") applyGoldFare(seen);
    const pairs = Object.fromEntries([...seen.entries()].sort(([x], [y]) => (x < y ? -1 : 1)));
    console.log(`${spec.key.padEnd(7)} ${Object.keys(pairs).length} pairs, ${Math.min(...seen.values())}-${Math.max(...seen.values())} baht, ${conflicts} disagreeing pairs resolved upward`);
    if (conflicts > Math.max(5, seen.size * 0.05)) throw new Error(`${spec.key}: ${conflicts} disagreeing pairs - the feed looks broken`);
    out[spec.key] = {
      name: spec.name,
      nameTh: spec.nameTh,
      lines: spec.lines,
      effective: null,
      source: `${GTFS_URL} (OTP Namtang GTFS, CC-BY 4.0, feed ${feed?.feed_version ?? "?"})`,
      pairs,
    };
  }
  return out;
}

// --- SRT Red Line: the matrix on SRTET's fare page ---

/** SRTET calls the Bang Sue Grand station "Krung Thep Aphiwat"; our data uses its newer name. */
const RED_ALIASES: Record<string, string> = { กรุงเทพอภิวัฒน์: "RD04" };

async function redLine(): Promise<FareSystem> {
  const html = await text(SRTET_URL);
  const table = html.match(/<table[\s\S]*?<\/table>/)?.[0];
  if (!table) throw new Error("red: no fare table on the SRTET page");
  const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => [...m[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => plain(c[1]).trim()));
  const header = rows[0].slice(1);
  const redCodes = codesOf(["srtDarkRed", "srtLightRed"]);
  const codeOf = (name: string): string => {
    const code = RED_ALIASES[name] ?? redCodes.find((c) => byCode.get(c)!.nameTh === name);
    if (!code) throw new Error(`red: station "${name}" on the SRTET page matches none of ours`);
    return code;
  };
  const pairs = new Map<string, number>();
  for (const row of rows.slice(1)) {
    if (row.length !== header.length + 1) continue;
    const from = codeOf(row[0]);
    row.slice(1).forEach((cell, i) => {
      const to = codeOf(header[i]);
      const p = Number(cell);
      if (from === to) return;
      if (!Number.isFinite(p)) throw new Error(`red: bad fare "${cell}" (${row[0]} -> ${header[i]})`);
      pairs.set(pairKey(from, to), Math.max(pairs.get(pairKey(from, to)) ?? 0, p));
    });
  }
  if (pairs.size !== (redCodes.length * (redCodes.length - 1)) / 2) throw new Error(`red: ${pairs.size} pairs, expected a full matrix of ${redCodes.length} stations`);
  console.log(`red     ${pairs.size} pairs, ${Math.min(...pairs.values())}-${Math.max(...pairs.values())} baht`);
  return {
    name: "SRT Red Line",
    nameTh: "รถไฟฟ้าสายสีแดง",
    lines: ["srtDarkRed", "srtLightRed"],
    effective: null,
    source: SRTET_URL,
    pairs: Object.fromEntries([...pairs.entries()].sort(([x], [y]) => (x < y ? -1 : 1))),
  };
}

// --- MRT Blue: Royal Gazette table, by stations travelled ---

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

async function blueLine(): Promise<FareSystem> {
  const t = plain(await text(BLUE_URL));
  const found = new Map<number, number>();
  for (const m of t.matchAll(/(\d{1,2}) stations?(?: or more)?: (\d{2,3}) baht/g)) {
    // Keep the first full run only: the page repeats a shortened version in a caption.
    if (!found.has(Number(m[1]))) found.set(Number(m[1]), Number(m[2]));
  }
  const stopFares: number[] = [];
  for (let n = 1; found.has(n); n++) stopFares.push(found.get(n)!);
  const date = t.match(/effective (?:from )?(?:on )?([A-Z][a-z]+) (\d{1,2}), (\d{4})/);
  const month = date ? MONTHS.indexOf(date[1]) + 1 : 0;
  if (!date || month === 0) throw new Error("blue: effective date not found");
  console.log(`blue    ${stopFares.length} fares by stations travelled, ${stopFares[0]}-${stopFares.at(-1)} baht`);
  return {
    name: "MRT Blue",
    nameTh: "MRT สายสีน้ำเงิน",
    lines: ["blue"],
    effective: `${date[3]}-${String(month).padStart(2, "0")}-${String(Number(date[2])).padStart(2, "0")}`,
    source: BLUE_URL,
    stopFares,
  };
}

// --- Guards and output ---

function validate(key: string, sys: FareSystem, previous: FareSystem | undefined): void {
  const values = sys.pairs ? Object.values(sys.pairs) : (sys.stopFares ?? []);
  if (values.length < 5) throw new Error(`${key}: only ${values.length} fares`);
  for (const f of values) if (!Number.isFinite(f) || f < 10 || f > 100) throw new Error(`${key}: implausible fare ${f}`);
  if (sys.stopFares) sys.stopFares.forEach((f, i) => i > 0 && f < sys.stopFares![i - 1] && (() => { throw new Error(`${key}: fares decrease at ${i + 1} stations`); })());
  for (const k of Object.keys(sys.pairs ?? {})) {
    const [a, b] = k.split("|");
    if (!byCode.has(a) || !byCode.has(b)) throw new Error(`${key}: unknown station in ${k}`);
  }
  if (!previous) return;
  if (sys.pairs && previous.pairs) {
    const lost = Object.keys(previous.pairs).filter((k) => !(k in sys.pairs!)).length;
    if (lost > Object.keys(previous.pairs).length * MAX_LOST_PAIRS) throw new Error(`${key}: lost ${lost} of ${Object.keys(previous.pairs).length} pairs`);
    for (const [k, was] of Object.entries(previous.pairs)) {
      const now = sys.pairs[k];
      if (now !== undefined && Math.abs(now - was) / was > MAX_CHANGE) throw new Error(`${key}: ${k} moved ${was} -> ${now} (over ${MAX_CHANGE * 100}%)`);
    }
  }
  if (sys.stopFares && previous.stopFares) {
    sys.stopFares.slice(0, previous.stopFares.length).forEach((now, i) => {
      const was = previous.stopFares![i];
      if (Math.abs(now - was) / was > MAX_CHANGE) throw new Error(`${key}: ${i + 1} stations moved ${was} -> ${now} (over ${MAX_CHANGE * 100}%)`);
    });
  }
}

/** One line per pair, so a monthly change reads as a small, reviewable diff. */
function format(file: FareFile): string {
  const systems = Object.entries(file.systems).map(([key, s]) => {
    const { pairs, stopFares, ...rest } = s;
    const head = JSON.stringify(rest, null, 2).slice(0, -2).replace(/^/gm, "    ").slice(4);
    const body = pairs
      ? `,\n      "pairs": {\n${Object.entries(pairs).map(([k, v]) => `        "${k}": ${v}`).join(",\n")}\n      }`
      : `,\n      "stopFares": ${JSON.stringify(stopFares)}`;
    return `    ${JSON.stringify(key)}: ${head}${body}\n    }`;
  });
  return `{\n  "retrievedAt": ${JSON.stringify(file.retrievedAt)},\n  "note": ${JSON.stringify(file.note)},\n  "systems": {\n${systems.join(",\n")}\n  }\n}\n`;
}

async function main(): Promise<void> {
  const stored: FareFile | null = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : null;
  // A file in an older shape has nothing to compare against.
  const previous = stored?.systems ? stored : null;
  const systems: Record<string, FareSystem> = {};
  const failures: string[] = [];
  const attempt = async (name: string, run: () => Promise<Record<string, FareSystem>> | Record<string, FareSystem>) => {
    try {
      Object.assign(systems, await run());
    } catch (err) {
      failures.push(`${name}: ${(err as Error).message}`);
    }
  };
  await attempt("gtfs", async () => gtfsSystems(await gtfsDir()));
  await attempt("red", async () => ({ srtRed: await redLine() }));
  await attempt("blue", async () => ({ blue: await blueLine() }));

  for (const [key, sys] of Object.entries(systems)) {
    try {
      validate(key, sys, previous?.systems?.[key]);
    } catch (err) {
      failures.push((err as Error).message);
    }
  }
  for (const key of ["bts", "blue", "purple", "arl", "srtRed", "yellow", "pink"]) {
    if (!systems[key] && !failures.length) failures.push(`${key}: missing`);
  }
  if (failures.length > 0) {
    console.error(`Fare scrape failed, data/fares.json left unchanged:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }

  const next: FareFile = {
    retrievedAt: previous?.retrievedAt ?? "",
    note: "Written by scripts/scrape-fares.ts - do not edit by hand. Pair keys are station codes, sorted.",
    systems: Object.fromEntries(["bts", "blue", "purple", "arl", "srtRed", "yellow", "pink"].map((k) => [k, systems[k]])),
  };
  // Only a real change moves the date (and the diff).
  const same = previous && format({ ...next, retrievedAt: "" }) === format({ ...previous, retrievedAt: "" });
  if (same) return void console.log("No fare changes.");
  next.retrievedAt = new Date().toISOString().slice(0, 10);
  if (DRY_RUN) return void console.log("Dry run: would update data/fares.json");
  writeFileSync(FILE, format(next));
  console.log("Updated data/fares.json");
}

main();
