/**
 * Builds data/hop-times.json - scheduled minutes between adjacent stations -
 * from the Namtang GTFS feed that Thailand's Office of Transport and Traffic
 * Policy and Planning (สนข./OTP) publishes under CC-BY 4.0:
 *
 *   https://namtang-api.otp.go.th/download/namtang-gtfs.zip
 *
 * lib/transit-graph.ts uses these figures in place of its distance/speed
 * formula for the lines listed in LINES below. The feed is ~40 MB and is not
 * committed; download and unzip it anywhere, then:
 *
 *   node --experimental-strip-types scripts/build-hop-times.ts <unzipped-dir>
 *
 * Why only some lines. The feed has a timed trip for every urban line, but
 * not all of it is measured data: Yellow has exactly 3 min between every pair
 * of stops (72 min end to end for ~30 km) and Pink has 0 min between stops
 * with a flat 1 min dwell (28 min for ~35 km, i.e. ~75 km/h with 30 stops).
 * Those are placeholders, so they stay on the formula. Light Red is left on
 * the feed's SRT Light Red trips are measured (4 / 7 / 5 min hops that differ by
 * direction and track the real spacing) and match SRTET's own timetable, so it
 * is included. Purple is flat 2 min a hop, which is plausible for a line with
 * near-uniform spacing, so it is kept. If OTP fixes a placeholder line, add it to LINES and re-run.
 *
 * How feed stops become our station codes. The feed has its own stop ids, and
 * MRT/ARL/SRT codes here are locally assigned (see AGENTS.md), so ids can't be
 * matched. Instead each feed stop is matched to the nearest station *on the
 * same line* by coordinates. Matching fails loudly if a stop is far from
 * every station or two stops of one trip collapse onto one station.
 *
 * What a figure means. For two consecutive stops A then B on a trip, the hop
 * is arrival(B) - departure(A): pure running time, in minutes. Each line also
 * gets one `dwell` (median stop time at intermediate stops), which the router
 * adds per stop. Where the feed skips a station we list (Sukhumvit's N6 Sena
 * Ruam, which was never built, is in line-sequences.json), the run is split
 * between the hops in proportion to their straight-line length. A hop seen on
 * several trips (both directions, short-turn patterns) takes the median.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const OUT = path.join(ROOT, "data", "hop-times.json");

/**
 * A feed stop further than this from every station of its line is an error.
 * Generous on purpose: some coordinates in data/stations.json are off (PP06
 * Tha It is ~475 m from the feed's "Bang Rak Noi Tha It"), so the match is
 * also required to be unambiguous, see AMBIGUITY.
 */
const MAX_MATCH_METERS = 600;
/** The nearest station must be at least this many times closer than the runner-up. */
const AMBIGUITY = 2;
/** The feed may skip at most this many app stations between two stops. */
const MAX_SKIPPED = 2;
/** A trip whose stops all share one time carries no information (Pink). */
const MIN_RUN_MIN = 0.1;

interface LineSpec {
  line: string;
  agency: string;
  shortName: string;
  /** Substring of route_long_name, for lines that share a short name. */
  longName?: string;
}

// Selected by name rather than route_id: the ids are auto-assigned and can be
// renumbered between feed versions.
const LINES: LineSpec[] = [
  { line: "sukhumvit", agency: "BTSC", shortName: "Sukhumvit" },
  { line: "silom", agency: "BTSC", shortName: "Silom" },
  { line: "gold", agency: "BTSC", shortName: "Gold" },
  { line: "blue", agency: "BEM", shortName: "Blue" },
  { line: "purple", agency: "BEM", shortName: "Purple" },
  { line: "arl", agency: "SRTET", shortName: "ARL" },
  { line: "srtDarkRed", agency: "SRTET", shortName: "Red", longName: "Dark Red" },
  { line: "srtLightRed", agency: "SRTET", shortName: "Red", longName: "Light Red" },
];

type Row = Record<string, string>;

/** Minimal RFC 4180 reader: quoted fields, "" escapes, commas inside quotes. */
function readCsv(file: string): Row[] {
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
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
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

function seconds(time: string): number {
  const [h, m, s] = time.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

function haversine(a: [number, number], b: [number, number]): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b[0] - a[0]) / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const round = (n: number) => Math.round(n * 100) / 100;

interface Station {
  code: string;
  lat: number;
  lon: number;
  lines: { line: string }[];
}

function main() {
  const dir = process.argv[2];
  if (!dir || !existsSync(path.join(dir, "stop_times.txt"))) {
    console.error("usage: node --experimental-strip-types scripts/build-hop-times.ts <unzipped GTFS dir>");
    process.exit(2);
  }

  const stations: Station[] = JSON.parse(readFileSync(path.join(ROOT, "data", "stations.json"), "utf8"));
  const sequences: Record<string, string[][]> = JSON.parse(
    readFileSync(path.join(ROOT, "data", "line-sequences.json"), "utf8"),
  );
  const byCode = new Map(stations.map((s) => [s.code, s]));
  const pos = (code: string): [number, number] => [byCode.get(code)!.lat, byCode.get(code)!.lon];

  const feedInfo = readCsv(path.join(dir, "feed_info.txt"))[0];
  const routes = readCsv(path.join(dir, "routes.txt"));
  const trips = readCsv(path.join(dir, "trips.txt"));
  const feedStops = new Map(readCsv(path.join(dir, "stops.txt")).map((s) => [s.stop_id, s]));

  const tripsByRoute = new Map<string, string[]>();
  for (const t of trips) {
    if (!tripsByRoute.has(t.route_id)) tripsByRoute.set(t.route_id, []);
    tripsByRoute.get(t.route_id)!.push(t.trip_id);
  }
  const stopTimes = new Map<string, Row[]>();
  for (const st of readCsv(path.join(dir, "stop_times.txt"))) {
    if (!stopTimes.has(st.trip_id)) stopTimes.set(st.trip_id, []);
    stopTimes.get(st.trip_id)!.push(st);
  }

  const lines: Record<string, { dwell: number; hops: Record<string, number> }> = {};
  let failed = false;

  for (const spec of LINES) {
    const routeIds = routes
      .filter(
        (r) =>
          r.agency_id === spec.agency &&
          r.route_short_name === spec.shortName &&
          (!spec.longName || r.route_long_name.includes(spec.longName)),
      )
      .map((r) => r.route_id);
    if (!routeIds.length) {
      console.error(`${spec.line}: no feed route matches ${spec.agency} "${spec.shortName}"`);
      failed = true;
      continue;
    }

    const segments = sequences[spec.line];
    const lineCodes = [...new Set(segments.flat())];
    const nearest = (stopId: string): string => {
      const s = feedStops.get(stopId)!;
      const at: [number, number] = [Number(s.stop_lat), Number(s.stop_lon)];
      const ranked = lineCodes.map((code) => ({ code, m: haversine(at, pos(code)) })).sort((a, b) => a.m - b.m);
      const [first, second] = ranked;
      if (first.m > MAX_MATCH_METERS) {
        throw new Error(`${spec.line}: feed stop "${s.stop_name}" is ${Math.round(first.m)} m from the nearest station`);
      }
      if (second && second.m < first.m * AMBIGUITY) {
        throw new Error(`${spec.line}: feed stop "${s.stop_name}" is ambiguous between ${first.code} and ${second.code}`);
      }
      return first.code;
    };

    /** App codes strictly between a and b along whichever segment joins them most closely. */
    const between = (a: string, b: string): string[] | null => {
      let best: string[] | null = null;
      for (const seg of segments) {
        seg.forEach((codeA, i) => {
          if (codeA !== a) return;
          seg.forEach((codeB, j) => {
            if (codeB !== b || i === j) return;
            const slice = i < j ? seg.slice(i, j + 1) : seg.slice(j, i + 1).reverse();
            if (!best || slice.length < best.length) best = slice;
          });
        });
      }
      return best;
    };

    const observations = new Map<string, number[]>();
    const dwells: number[] = [];
    let used = 0;
    let skippedTrips = 0;

    for (const tripId of routeIds.flatMap((id) => tripsByRoute.get(id) ?? [])) {
      const rows = (stopTimes.get(tripId) ?? []).sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
      if (rows.length < 2) continue;
      const codes = rows.map((r) => nearest(r.stop_id));
      if (new Set(codes).size !== codes.length && spec.line !== "blue") {
        throw new Error(`${spec.line}: trip ${tripId} maps two feed stops onto one station`);
      }
      const runs = rows.slice(1).map((r, i) => (seconds(r.arrival_time) - seconds(rows[i].departure_time)) / 60);
      if (runs.every((m) => m < MIN_RUN_MIN)) {
        skippedTrips++;
        continue;
      }
      used++;
      rows.slice(1, -1).forEach((r) => dwells.push((seconds(r.departure_time) - seconds(r.arrival_time)) / 60));

      runs.forEach((run, i) => {
        const chain = between(codes[i], codes[i + 1]);
        if (!chain || chain.length - 2 > MAX_SKIPPED) {
          throw new Error(`${spec.line}: trip ${tripId} goes ${codes[i]} -> ${codes[i + 1]}, which are not neighbours in line-sequences.json`);
        }
        const lengths = chain.slice(1).map((c, k) => haversine(pos(chain[k]), pos(c)));
        const total = lengths.reduce((s, m) => s + m, 0);
        chain.slice(1).forEach((c, k) => {
          const key = [chain[k], c].sort().join("|");
          if (!observations.has(key)) observations.set(key, []);
          observations.get(key)!.push((run * lengths[k]) / total);
        });
      });
    }

    const hops: Record<string, number> = {};
    for (const key of [...observations.keys()].sort()) hops[key] = round(median(observations.get(key)!));
    lines[spec.line] = { dwell: round(median(dwells)), hops };

    const missing: string[] = [];
    for (const seg of segments) {
      for (let i = 0; i < seg.length - 1; i++) {
        const key = [seg[i], seg[i + 1]].sort().join("|");
        if (!(key in hops)) missing.push(key);
      }
    }
    const unexpected = missing;
    console.log(
      `${spec.line.padEnd(9)} routes ${routeIds.join(",")}  trips used ${used} (skipped ${skippedTrips})  ` +
        `hops ${Object.keys(hops).length}  dwell ${lines[spec.line].dwell}  ` +
        `${unexpected.length ? `MISSING ${unexpected.join(" ")}` : "complete"}`,
    );
    if (unexpected.length) failed = true;
  }

  if (failed) {
    console.error("Not writing data/hop-times.json: fix the problems above.");
    process.exit(1);
  }

  const out = {
    source: "สำนักงานนโยบายและแผนการขนส่งและจราจร (OTP), Namtang GTFS, CC-BY 4.0",
    url: "https://namtang-api.otp.go.th/download/namtang-gtfs.zip",
    feedVersion: feedInfo?.feed_version ?? "unknown",
    unit: "minutes of running time between adjacent stations; dwell is added per stop by the router",
    lines,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}

main();
