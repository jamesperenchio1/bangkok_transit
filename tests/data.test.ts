import { describe, expect, it } from "vitest";
import { liveStations, stations, stationsByCode, type LineKey } from "@/data/stations";
import lineSequences from "@/data/line-sequences.json";
import interchanges from "@/data/interchanges.json";
import { haversineMeters } from "@/lib/line-geometry";
import { LINE_COLORS } from "@/lib/line-colors";

/**
 * The station data and line sequences are hand-maintained and the routing
 * graph trusts them completely, so these invariants are what stands between
 * a typo and a wrong route.
 */

const sequences = lineSequences as Record<LineKey, string[][]>;
const meters = (a: string, b: string) => {
  const sa = stationsByCode.get(a)!;
  const sb = stationsByCode.get(b)!;
  return haversineMeters([sa.lat, sa.lon], [sb.lat, sb.lon]);
};
const shareLine = (a: string, b: string) =>
  stationsByCode.get(a)!.lines.some((la) => stationsByCode.get(b)!.lines.some((lb) => la.line === lb.line));

// Real hops longer than 4 km: the Airport Rail Link and SRT Red Line run
// long stretches between stations. Anything else that long is a data error.
const LONG_HOPS = new Set([
  "A03-A04", "A04-A05", "A05-A06", "A06-A07",
  "RD01-RD02", "RD02-RD03", "RD04-RD01", "RD11-RD12",
]);

describe("stations", () => {
  it("has unique codes", () => {
    expect(new Set(stations.map((s) => s.code)).size).toBe(stations.length);
  });

  it("has real coordinates inside Greater Bangkok", () => {
    for (const s of stations) {
      expect(s.lat, s.code).toBeGreaterThan(13.4);
      expect(s.lat, s.code).toBeLessThan(14.2);
      expect(s.lon, s.code).toBeGreaterThan(100.2);
      expect(s.lon, s.code).toBeLessThan(100.9);
    }
  });

  it("has an English and a Thai name, each in its own script", () => {
    for (const s of stations) {
      expect(s.nameEn, s.code).toMatch(/^[\x20-\x7e]+$/);
      expect(s.nameTh, s.code).toMatch(/[฀-๿]/);
    }
  });

  it("marks exactly the 61 BTS Sukhumvit/Silom stations as live", () => {
    expect(liveStations).toHaveLength(61);
    for (const s of liveStations) {
      expect(s.lines.every((l) => l.line === "sukhumvit" || l.line === "silom"), s.code).toBe(true);
    }
  });

  it("only uses lines that have a brand color", () => {
    for (const s of stations) for (const l of s.lines) expect(LINE_COLORS[l.line], s.code).toBeDefined();
  });
});

describe("line sequences", () => {
  it("only references existing stations, on the line they claim", () => {
    for (const [line, segments] of Object.entries(sequences) as [LineKey, string[][]][]) {
      for (const code of segments.flat()) {
        const s = stationsByCode.get(code);
        expect(s, `${line}: ${code}`).toBeDefined();
        expect(s!.lines.map((l) => l.line), `${line}: ${code}`).toContain(line);
      }
    }
  });

  it("puts every station on every line it serves", () => {
    for (const s of stations) {
      for (const { line } of s.lines) {
        expect(sequences[line].flat(), `${s.code} on ${line}`).toContain(s.code);
      }
    }
  });

  it("connects each line's segments into one piece", () => {
    for (const [line, segments] of Object.entries(sequences)) {
      const [first, ...rest] = segments;
      const seen = new Set(first);
      for (const segment of rest) {
        expect(segment.some((c) => seen.has(c)), `${line} branch ${segment[0]}`).toBe(true);
        segment.forEach((c) => seen.add(c));
      }
    }
  });

  it("has no implausibly long hop between adjacent stops", () => {
    for (const [line, segments] of Object.entries(sequences)) {
      for (const segment of segments) {
        for (let i = 0; i < segment.length - 1; i++) {
          const hop = `${segment[i]}-${segment[i + 1]}`;
          const reverse = `${segment[i + 1]}-${segment[i]}`;
          const limit = LONG_HOPS.has(hop) || LONG_HOPS.has(reverse) ? 12_000 : 4_000;
          expect(meters(segment[i], segment[i + 1]), `${line} ${hop}`).toBeLessThan(limit);
        }
      }
    }
  });
});

describe("interchanges", () => {
  it("joins distinct stations on different lines within a short walk", () => {
    for (const { a, b } of interchanges) {
      expect(stationsByCode.has(a), a).toBe(true);
      expect(stationsByCode.has(b), b).toBe(true);
      expect(shareLine(a, b), `${a}-${b}`).toBe(false);
      expect(meters(a, b), `${a}-${b}`).toBeLessThan(600);
    }
  });

  it("doesn't miss any station pair close enough to obviously be one", () => {
    const listed = new Set(interchanges.flatMap(({ a, b }) => [`${a}-${b}`, `${b}-${a}`]));
    for (let i = 0; i < stations.length; i++) {
      for (let j = i + 1; j < stations.length; j++) {
        const [a, b] = [stations[i].code, stations[j].code];
        if (shareLine(a, b) || meters(a, b) > 300) continue;
        expect(listed.has(`${a}-${b}`), `${a}-${b} is ${Math.round(meters(a, b))} m apart`).toBe(true);
      }
    }
  });
});
