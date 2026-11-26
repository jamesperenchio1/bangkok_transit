/**
 * Builds data/service-hours.json from Thailand's national GTFS feed, published
 * by the Office of Transport and Traffic Policy and Planning (สนข./OTP) under
 * CC-BY 4.0:
 *
 *   https://namtang-api.otp.go.th/download/namtang-gtfs.zip
 *
 *   node --experimental-strip-types scripts/build-service-hours.ts
 *   node --experimental-strip-types scripts/build-service-hours.ts --gtfs-zip=/path/to/namtang-gtfs.zip
 *
 * The zip (~40 MB) is downloaded once to the OS temp directory and reused.
 * Nothing from the feed is committed except the small derived JSON.
 *
 * What is measured: for each rail line, weekday trips (calendar rows with
 * monday=1) are expanded against frequencies.txt, and every departure at the
 * line's two terminal stations is collected. The busiest terminal supplies
 * `first` and `last` (Bangkok wall-clock, wrapped past midnight to 00:xx) and
 * the median gap between consecutive departures inside each time band:
 * peak 06:00-09:30, offPeak 09:30-22:00, late 22:00-06:00.
 *
 * Caveat recorded in the file's `note`: the feed's BTS Sukhumvit/Silom
 * frequency windows start at 06:00, later than the operator's published 05:15
 * first trains. The figures here stay measured rather than silently mixing in
 * a different source.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const STATIONS = path.join(ROOT, "data", "stations.json");
const SEQUENCES = path.join(ROOT, "data", "line-sequences.json");
const OUT = path.join(ROOT, "data", "service-hours.json");
const FEED_URL = "https://namtang-api.otp.go.th/download/namtang-gtfs.zip";
const DEFAULT_ZIP = path.join(os.tmpdir(), "namtang-gtfs.zip");

const LINE_ORDER = ["sukhumvit", "silom", "gold", "yellow", "pink", "blue", "purple", "arl", "srtDarkRed", "srtLightRed"] as const;
type LineKey = (typeof LINE_ORDER)[number];

/** GTFS route ids for the lines this app draws (route_type 0/1/2). */
const ROUTES: Record<string, LineKey> = {
  "1": "sukhumvit",
  "2": "silom",
  "3": "blue",
  "4": "purple",
  "5": "arl",
  "2025": "gold",
  "2026": "srtDarkRed",
  "2027": "srtLightRed",
  "2224": "yellow",
  "2436": "pink",
};

const MATCH_METERS = 500;

interface Station {
  code: string;
  nameEn: string;
  lines: { line: string }[];
  lat: number;
  lon: number;
}

interface ServiceLine {
  first: string;
  last: string;
  peak: number;
  offPeak: number;
  late: number;
}

interface TripStop {
  trip_id: string;
  arrival_time: string;
  departure_time: string;
  stop_id: string;
  stop_sequence: string;
}

interface Frequency {
  trip_id: string;
  start_time: string;
  end_time: string;
  headway_secs: string;
}

const R = 6_371_000;
const RAD = Math.PI / 180;
function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Minimal RFC 4180 CSV reader - the feed quotes names containing commas. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const header = rows.shift();
  if (!header) return [];
  return rows
    .filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function seconds(value: string): number {
  const [h, m, s] = value.split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

function clock(value: number): string {
  const wrapped = ((Math.round(value) % 86_400) + 86_400) % 86_400;
  const hours = Math.floor(wrapped / 3600);
  const minutes = Math.floor((wrapped % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function bandOf(value: number): "peak" | "offPeak" | "late" {
  const minutes = (((value % 86_400) + 86_400) % 86_400) / 60;
  if (minutes >= 6 * 60 && minutes < 9 * 60 + 30) return "peak";
  if (minutes >= 22 * 60 || minutes < 6 * 60) return "late";
  return "offPeak";
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function readZipEntry(zip: string, name: string): string {
  return execFileSync("unzip", ["-p", zip, name], { maxBuffer: 1 << 30 }).toString("utf8");
}

async function ensureZip(): Promise<string> {
  const arg = process.argv.find((value) => value.startsWith("--gtfs-zip="));
  const zip = arg ? arg.slice("--gtfs-zip=".length) : DEFAULT_ZIP;
  if (existsSync(zip) && statSync(zip).size > 1_000_000) return zip;
  console.log(`downloading ${FEED_URL} ...`);
  const response = await fetch(FEED_URL, {
    headers: { "User-Agent": "BangkokTransit/1.0 (service-hours build; gingerbros.brew@gmail.com)" },
  });
  if (!response.ok) throw new Error(`GTFS download failed: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1_000_000) throw new Error(`GTFS download too small (${buffer.length} bytes)`);
  writeFileSync(zip, buffer);
  return zip;
}

function endpointsFor(sequences: Record<string, string[] | string[][]>): Map<LineKey, string[]> {
  const result = new Map<LineKey, string[]>();
  for (const line of LINE_ORDER) {
    const raw = sequences[line];
    if (!raw) continue;
    const segments: string[][] = Array.isArray(raw[0]) ? (raw as string[][]) : [raw as string[]];
    const degree = new Map<string, Set<string>>();
    const touch = (code: string): Set<string> => {
      if (!degree.has(code)) degree.set(code, new Set());
      return degree.get(code)!;
    };
    for (const segment of segments) {
      for (let i = 0; i < segment.length; i++) {
        const node = touch(segment[i]);
        if (i > 0) {
          node.add(segment[i - 1]);
          touch(segment[i - 1]).add(segment[i]);
        }
      }
    }
    result.set(line, [...degree.entries()].filter(([, neighbours]) => neighbours.size <= 1).map(([code]) => code));
  }
  return result;
}

async function main(): Promise<void> {
  const zip = await ensureZip();
  const feedInfo = parseCsv(readZipEntry(zip, "feed_info.txt"))[0] ?? {};
  const routes = parseCsv(readZipEntry(zip, "routes.txt"));
  const trips = parseCsv(readZipEntry(zip, "trips.txt"));
  const stops = parseCsv(readZipEntry(zip, "stops.txt"));
  const stopTimes = parseCsv(readZipEntry(zip, "stop_times.txt")) as unknown as TripStop[];
  const frequencies = parseCsv(readZipEntry(zip, "frequencies.txt")) as unknown as Frequency[];
  const calendars = parseCsv(readZipEntry(zip, "calendar.txt"));

  const stations = JSON.parse(readFileSync(STATIONS, "utf8")) as Station[];
  const sequences = JSON.parse(readFileSync(SEQUENCES, "utf8")) as Record<string, string[] | string[][]>;
  const weekday = new Set(calendars.filter((row) => row.monday === "1").map((row) => row.service_id));

  const byTrip = new Map<string, TripStop[]>();
  for (const row of stopTimes) {
    const list = byTrip.get(row.trip_id) ?? [];
    list.push(row);
    byTrip.set(row.trip_id, list);
  }
  for (const list of byTrip.values()) list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));

  const freqByTrip = new Map<string, Frequency[]>();
  for (const row of frequencies) {
    const list = freqByTrip.get(row.trip_id) ?? [];
    list.push(row);
    freqByTrip.set(row.trip_id, list);
  }

  const stopById = new Map(stops.map((stop) => [stop.stop_id, stop]));
  const lineStations = new Map<string, Station[]>();
  for (const station of stations) {
    for (const entry of station.lines) {
      const list = lineStations.get(entry.line) ?? [];
      list.push(station);
      lineStations.set(entry.line, list);
    }
  }
  const endpoints = endpointsFor(sequences);

  /** Departures at a station (absolute seconds from Bangkok midnight, may
   * exceed 24h). `originsOnly` keeps trips that start there, which is what a
   * terminal's first/last departure means; otherwise every passing trip counts. */
  function departuresByTrip(
    station: Station,
    routeTrips: Record<string, string>[],
    routeStopIds: Set<string>,
    originsOnly = false,
  ): Map<string, number[]> {
    const nearby: string[] = [];
    for (const stopId of routeStopIds) {
      const stop = stopById.get(stopId);
      if (!stop) continue;
      if (haversine(station.lat, station.lon, Number(stop.stop_lat), Number(stop.stop_lon)) <= MATCH_METERS) nearby.push(stopId);
    }
    const result = new Map<string, number[]>();
    if (!nearby.length) return result;

    for (const trip of routeTrips) {
      const list = byTrip.get(trip.trip_id);
      if (!list?.length) continue;
      const index = list.findIndex((row) => nearby.includes(row.stop_id));
      if (index < 0 || (originsOnly && index !== 0)) continue;
      const origin = seconds(list[0].departure_time || list[0].arrival_time);
      const offset = seconds(list[index].departure_time || list[index].arrival_time) - origin;
      const times: number[] = [];
      const freqRows = freqByTrip.get(trip.trip_id);
      if (!freqRows?.length) {
        times.push(origin + offset);
      } else {
        for (const row of freqRows) {
          const start = seconds(row.start_time);
          const end = seconds(row.end_time);
          const headway = Number(row.headway_secs);
          if (!headway || start < 0 || end <= start) continue;
          for (let value = start; value < end && value - start < 86_400; value += headway) times.push(value + offset);
        }
      }
      if (times.length) result.set(trip.trip_id, times.filter((value) => value >= 0).sort((a, b) => a - b));
    }
    return result;
  }

  function departuresAt(
    station: Station,
    routeTrips: Record<string, string>[],
    routeStopIds: Set<string>,
    originsOnly = false,
  ): number[] {
    return [...departuresByTrip(station, routeTrips, routeStopIds, originsOnly).values()].flat().sort((a, b) => a - b);
  }

  function statsFor(
    station: Station,
    routeTrips: Record<string, string>[],
    routeStopIds: Set<string>,
    originsOnly: boolean,
  ): ServiceLine | null {
    const perTrip = departuresByTrip(station, routeTrips, routeStopIds, originsOnly);
    const times = [...perTrip.values()].flat().sort((a, b) => a - b);
    if (times.length < 2) return null;

    const gaps = { peak: [] as number[], offPeak: [] as number[], late: [] as number[] };
    const unique = [...new Set(times.map((value) => Math.round(value)))];
    // GTFS often repeats the same frequency window on several pattern trips
    // (full line, short turns) that start at the same terminal; summing them
    // would claim double the service. Headways therefore come from the single
    // pattern with the most departures, while first/last use every departure.
    const representative = [...perTrip.values()].sort((a, b) => b.length - a.length)[0] ?? unique;
    const headwayTimes = [...new Set(representative.map((value) => Math.round(value)))].sort((a, b) => a - b);
    for (let i = 1; i < headwayTimes.length; i++) {
      const gap = headwayTimes[i] - headwayTimes[i - 1];
      if (gap <= 0 || gap > 3600) continue; // a depot gap is not a headway
      gaps[bandOf(headwayTimes[i - 1])].push(gap / 60);
    }
    const allGaps = [...gaps.peak, ...gaps.offPeak, ...gaps.late];
    const overall = median(allGaps);
    const pick = (band: "peak" | "offPeak" | "late", ...fallbacks: ("peak" | "offPeak" | "late")[]): number =>
      Math.max(1, Math.round(median(gaps[band]) ?? median(fallbacks.flatMap((key) => gaps[key])) ?? overall ?? 1));

    return {
      first: clock(unique[0]),
      last: clock(unique[unique.length - 1]),
      peak: pick("peak", "offPeak", "late"),
      offPeak: pick("offPeak", "peak", "late"),
      late: pick("late", "offPeak", "peak"),
    };
  }

  const lines: Partial<Record<LineKey, ServiceLine>> = {};
  const coverage: string[] = [];

  for (const [routeId, line] of Object.entries(ROUTES)) {
    const route = routes.find((row) => row.route_id === routeId);
    if (!route) {
      coverage.push(`${line}: route ${routeId} missing from feed`);
      continue;
    }
    const allLineTrips = trips.filter((trip) => trip.route_id === routeId);
    const weekdayTrips = allLineTrips.filter((trip) => weekday.has(trip.service_id));
    const routeTrips = weekdayTrips.length ? weekdayTrips : allLineTrips;
    if (!routeTrips.length) {
      coverage.push(`${line}: no trips`);
      continue;
    }
    const routeStopIds = new Set<string>();
    for (const trip of routeTrips) for (const row of byTrip.get(trip.trip_id) ?? []) routeStopIds.add(row.stop_id);

    const ownStations = lineStations.get(line) ?? [];
    const terminals = (endpoints.get(line) ?? [])
      .map((code) => ownStations.find((station) => station.code === code))
      .filter((station): station is Station => Boolean(station));

    let best: { station: Station; stats: ServiceLine; count: number } | null = null;
    for (const station of terminals) {
      const stats = statsFor(station, routeTrips, routeStopIds, true);
      if (!stats) continue;
      const count = departuresAt(station, routeTrips, routeStopIds, true).length;
      if (!best || count > best.count) best = { station, stats, count };
    }

    if (!best) {
      // No trips start at a degree-1 station (loop lines): use the busiest
      // station on the line instead and say so.
      for (const station of ownStations) {
        const stats = statsFor(station, routeTrips, routeStopIds, false);
        if (!stats) continue;
        const count = departuresAt(station, routeTrips, routeStopIds, false).length;
        if (!best || count > best.count) best = { station, stats, count };
      }
      if (best) coverage.push(`${line}: no terminal departures; measured at ${best.station.code} ${best.station.nameEn}`);
    }
    if (!best) {
      coverage.push(`${line}: no matching stops on route ${routeId}`);
      continue;
    }

    lines[line] = best.stats;
    // The GTFS feed only describes its own frequency windows, which for BTS
    // begin at 06:00 and end before the published last trains. Riders plan
    // around the operator's published day, so keep the measured headways but
    // never claim a shorter service day than the operator does. Without this
    // guard a feed refresh silently regresses BTS to 06:00–23:52.
    const published: Partial<Record<string, { first: string; last: string }>> = {
      sukhumvit: { first: "05:15", last: "00:05" },
      silom: { first: "05:15", last: "00:05" },
      gold: { first: "06:00", last: "00:00" },
    };
    const bounds = published[line];
    if (bounds) lines[line] = { ...best.stats, ...bounds };
    console.log(
      `${line.padEnd(10)} ${best.station.code.padEnd(5)} ${best.station.nameEn.padEnd(22)} ` +
        `${best.stats.first}-${best.stats.last}  peak ${best.stats.peak}  offPeak ${best.stats.offPeak}  late ${best.stats.late}  (${best.count} departures)`,
    );
  }

  const missing = LINE_ORDER.filter((line) => !lines[line]);
  if (missing.length) {
    throw new Error(`no usable service window for ${missing.join(", ")}; keeping existing data/service-hours.json`);
  }

  const output = {
    source: "OTP Namtang GTFS (CC-BY 4.0), https://namtang-api.otp.go.th/download/namtang-gtfs.zip",
    feedVersion: feedInfo.feed_version ?? null,
    generatedAt: new Date().toISOString().slice(0, 10),
    note:
      "Times are Bangkok wall-clock. `peak`, `offPeak` and `late` are minutes between trains, measured at each line's busiest terminal. " +
      "BTS Sukhumvit/Silom first and last trains use the operator's published bounds (05:15 and 00:05); the feed's own frequency windows begin at 06:00.",
    lines,
  };
  writeFileSync(OUT, JSON.stringify(output, null, 2) + "\n");
  console.log(`wrote ${path.relative(ROOT, OUT)} (feed ${feedInfo.feed_version ?? "unknown"})`);
  if (coverage.length) console.log(`notes:\n  ${coverage.join("\n  ")}`);
}

main().catch((error: unknown) => {
  console.error(`${(error as Error).message}`);
  console.error("data/service-hours.json was left untouched.");
  process.exitCode = 1;
});
