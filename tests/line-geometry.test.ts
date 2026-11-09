import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GEOMETRY_RETRY_DELAYS_MS,
  haversineMeters,
  stationLineSegments,
  trackBetween,
  type LatLon,
  type LineSegments,
} from "@/lib/line-geometry";
import { stationsByCode } from "@/data/stations";
import sequences from "@/data/line-sequences.json";

const geometry: LineSegments = JSON.parse(readFileSync("public/line-geometry.json", "utf8"));
const at = (code: string) => stationsByCode.get(code)!;

describe("haversineMeters", () => {
  it("measures real distances", () => {
    // Siam -> Chit Lom is roughly 1 km.
    const d = haversineMeters([at("CEN").lat, at("CEN").lon], [at("E1").lat, at("E1").lon]);
    expect(d).toBeGreaterThan(700);
    expect(d).toBeLessThan(1300);
  });
});

describe("trackBetween", () => {
  it("follows the curved track and meets both station markers exactly", () => {
    const track = trackBetween(geometry, "sukhumvit", at("N8"), at("N7"));
    expect(track.length).toBeGreaterThan(2);
    expect(track[0]).toEqual([at("N8").lat, at("N8").lon]);
    expect(track.at(-1)).toEqual([at("N7").lat, at("N7").lon]);
  });

  it("falls back to a straight hop when there's no geometry", () => {
    expect(trackBetween({}, "sukhumvit", at("N8"), at("N7"))).toHaveLength(2);
  });

  it("has geometry for every line", () => {
    for (const line of ["sukhumvit", "silom", "gold", "blue", "purple", "yellow", "pink", "arl", "srtDarkRed", "srtLightRed"]) {
      expect(geometry[line]?.length, line).toBeGreaterThan(0);
    }
  });
});

/** Metres from a point to the nearest point on a polyline (edges, not just vertices: the GIS track has long straight chords). */
function distanceToTrack(p: LatLon, poly: LatLon[]): number {
  const k = Math.cos((p[0] * Math.PI) / 180);
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const [a, b] = [poly[i], poly[i + 1]];
    const dx = (b[1] - a[1]) * k;
    const dy = b[0] - a[0];
    const t = Math.max(0, Math.min(1, (((p[1] - a[1]) * k) * dx + (p[0] - a[0]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, haversineMeters(p, [a[0] + dy * t, a[1] + (b[1] - a[1]) * t]));
  }
  return best;
}

describe("the committed track is one connected line per line", () => {
  // public/line-geometry.json is BMA's GIS track, kept as separate pieces
  // (scripts/build-line-geometry.ts does not stitch them). That is only safe
  // while the pieces actually meet and run through every station: a re-fetch
  // that drops or shifts a piece would leave a visible break on the map.
  const STATION_ON_TRACK_M = 60;
  const PIECES_TOUCH_M = 40;
  const here = (code: string): LatLon => [stationsByCode.get(code)!.lat, stationsByCode.get(code)!.lon];

  it("puts every station on its own line's track", () => {
    const off: string[] = [];
    for (const [line, segments] of Object.entries(sequences as Record<string, string[][]>)) {
      for (const code of new Set(segments.flat())) {
        const d = Math.min(...geometry[line].map((piece) => distanceToTrack(here(code), piece)));
        if (d > STATION_ON_TRACK_M) off.push(`${line}/${code} ${Math.round(d)}m`);
      }
    }
    expect(off).toEqual([]);
  });

  it("joins every pair of adjacent stations: on one piece, or on pieces that chain together", () => {
    // Blue is the case for chains: its two halves meet through four tiny
    // fragments near Bang Pho, so "touching" has to be followed transitively.
    const touch = (pa: LatLon[], pb: LatLon[]) =>
      [pa[0], pa.at(-1)!].some((end) => distanceToTrack(end, pb) <= PIECES_TOUCH_M) ||
      [pb[0], pb.at(-1)!].some((end) => distanceToTrack(end, pa) <= PIECES_TOUCH_M);
    const componentOf = (line: string) => {
      const pieces = geometry[line];
      const id = pieces.map((_, i) => i);
      const find = (i: number): number => (id[i] === i ? i : (id[i] = find(id[i])));
      pieces.forEach((pa, i) => pieces.forEach((pb, j) => j > i && touch(pa, pb) && (id[find(i)] = find(j))));
      return (piece: LatLon[]) => find(pieces.indexOf(piece));
    };

    const broken: string[] = [];
    for (const [line, segments] of Object.entries(sequences as Record<string, string[][]>)) {
      const component = componentOf(line);
      const holding = (code: string) =>
        geometry[line].filter((piece) => distanceToTrack(here(code), piece) <= STATION_ON_TRACK_M).map(component);
      for (const codes of segments) {
        codes.slice(1).forEach((to, i) => {
          const a = holding(codes[i]);
          if (!holding(to).some((c) => a.includes(c))) broken.push(`${line} ${codes[i]}->${to}`);
        });
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("stationLineSegments (the stand-in drawn before the curves arrive)", () => {
  const standIn = stationLineSegments();

  it("has every line, one polyline per service segment", () => {
    for (const [line, segments] of Object.entries(sequences as Record<string, string[][]>)) {
      expect(standIn[line]?.map((p) => p.length), line).toEqual(segments.map((codes) => codes.length));
    }
  });

  it("runs through every station in order, so no adjacent pair is left unconnected", () => {
    for (const [line, segments] of Object.entries(sequences as Record<string, string[][]>)) {
      segments.forEach((codes, i) => {
        const poly = standIn[line][i];
        codes.forEach((code, j) => {
          expect(poly[j], `${line} ${code}`).toEqual([stationsByCode.get(code)!.lat, stationsByCode.get(code)!.lon]);
        });
      });
    }
  });
});

describe("loadLineGeometryInBackground", () => {
  const curved: LineSegments = { silom: [[[13.7, 100.5], [13.8, 100.6]]] };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function load() {
    return import("@/lib/line-geometry");
  }

  it("hands over the curves, and remembers them for the map to read synchronously", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(curved));
    const { loadLineGeometryInBackground, loadedLineGeometry } = await load();
    expect(loadedLineGeometry()).toBeNull();
    const got = vi.fn();
    loadLineGeometryInBackground(got);
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toHaveBeenCalledWith(curved);
    expect(loadedLineGeometry()).toEqual(curved);
  });

  it("retries a failed download instead of leaving the map without curves", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("nope", { status: 503 }))
      .mockResolvedValue(Response.json(curved));
    const { loadLineGeometryInBackground } = await load();
    const got = vi.fn();
    loadLineGeometryInBackground(got);
    await vi.advanceTimersByTimeAsync(0);
    expect(got).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(GEOMETRY_RETRY_DELAYS_MS[0]);
    expect(got).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(GEOMETRY_RETRY_DELAYS_MS[1]);
    expect(got).toHaveBeenCalledWith(curved);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("gives up after the last delay, and stops when asked", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const { loadLineGeometryInBackground } = await load();
    const got = vi.fn();
    loadLineGeometryInBackground(got);
    await vi.advanceTimersByTimeAsync(GEOMETRY_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) + 1_000);
    expect(fetch).toHaveBeenCalledTimes(GEOMETRY_RETRY_DELAYS_MS.length + 1);
    expect(got).not.toHaveBeenCalled();

    fetch.mockClear();
    const stop = loadLineGeometryInBackground(got);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
