import { describe, expect, it } from "vitest";
import faresJson from "@/data/fares.json";
import { stations } from "@/data/stations";
import { computeFare, fareFor, pairKey, type FareData } from "@/lib/fares";
import { findPath } from "@/lib/transit-graph";

const data = faresJson as unknown as FareData;
const path = (a: string, b: string) => {
  const p = findPath(a, b);
  if (!p) throw new Error(`no route ${a}-${b}`);
  return p;
};
const codes = new Set(stations.map((s) => s.code));

describe("fare data", () => {
  it("has every system and only real lines and stations", () => {
    expect(Object.keys(data.systems).sort()).toEqual(["arl", "blue", "bts", "pink", "purple", "srtRed", "yellow"]);
    const lines = new Set(stations.flatMap((s) => s.lines.map((l) => l.line)));
    for (const sys of Object.values(data.systems)) {
      for (const l of sys.lines) expect(lines.has(l)).toBe(true);
      for (const k of Object.keys(sys.pairs ?? {})) {
        const [a, b] = k.split("|");
        expect(codes.has(a) && codes.has(b) && a < b).toBe(true);
      }
    }
  });

  it("keeps fares plausible", () => {
    for (const sys of Object.values(data.systems)) {
      for (const f of [...Object.values(sys.pairs ?? {}), ...(sys.stopFares ?? [])]) {
        expect(f).toBeGreaterThanOrEqual(10);
        expect(f).toBeLessThanOrEqual(100);
      }
    }
  });

  it("prices (nearly) every station pair on each line", () => {
    // The feed has no figure for a station that was never built (N6), and the
    // Gold Line is priced only within itself.
    for (const key of ["arl", "srtRed", "purple", "yellow", "pink"]) {
      const sys = data.systems[key];
      const n = new Set(Object.keys(sys.pairs!).flatMap((k) => k.split("|"))).size;
      expect(Object.keys(sys.pairs!).length).toBe((n * (n - 1)) / 2);
    }
  });

  it("Blue Line is the July 2026 table: 17-44 by stations, capped", () => {
    const blue = data.systems.blue;
    expect(blue.stopFares).toEqual([17, 20, 22, 25, 27, 29, 32, 34, 37, 39, 42, 44]);
    expect(fareFor(blue, "BL01", "BL02", 1)).toBe(17);
    expect(fareFor(blue, "BL01", "BL30", 30)).toBe(44);
    expect(fareFor(blue, "BL01", "BL01", 0)).toBeNull();
  });
});

describe("computeFare", () => {
  it("prices a BTS ride between two stations", () => {
    const fare = computeFare(path("CEN", "E1"), data)!;
    expect(fare.complete).toBe(true);
    expect(fare.segments).toHaveLength(1);
    expect(fare.total).toBe(data.systems.bts.pairs![pairKey("CEN", "E1")]);
  });

  it("treats a through-ride from Sukhumvit onto Silom at Siam as one BTS fare", () => {
    const fare = computeFare(path("N2", "S6"), data)!;
    expect(fare.segments.map((s) => s.system)).toEqual(["bts"]);
    expect(fare.total).toBe(data.systems.bts.pairs![pairKey("N2", "S6")]);
  });

  it("is symmetric", () => {
    expect(computeFare(path("E4", "N8"), data)!.total).toBe(computeFare(path("N8", "E4"), data)!.total);
  });

  it("charges each system on a trip that changes operator, and sums them", () => {
    const fare = computeFare(path("N9", "BL10"), data)!; // BTS, walk to MRT Blue
    expect(fare.segments.map((s) => s.system)).toEqual(["bts", "blue"]);
    expect(fare.complete).toBe(true);
    expect(fare.total).toBe(fare.segments[0].fare! + fare.segments[1].fare!);
  });

  it("prices the other systems", () => {
    for (const [a, b, system] of [
      ["A01", "A08", "arl"],
      ["PP01", "PP05", "purple"],
      ["YL01", "YL10", "yellow"],
      ["PK01", "PK10", "pink"],
      ["RD03", "RD13", "srtRed"],
    ] as const) {
      const fare = computeFare(path(a, b), data)!;
      expect(fare.segments[0].system).toBe(system);
      expect(fare.complete).toBe(true);
      expect(fare.total).toBeGreaterThan(0);
    }
  });

  describe("transfer discounts riders reported missing", () => {
    it("charges one entry fee on Blue <-> Purple at Tao Poon: Bang Sue -> Wong Sawang is 23, not 40", () => {
      const fare = computeFare(path("BL30", "PP14"), data)!;
      expect(fare.segments.map((s) => s.system)).toEqual(["blue", "purple"]);
      expect(fare.segments.map((s) => s.discount)).toEqual([0, 14]);
      expect(fare.total).toBe(23);
      expect(fare.discount).toBe(14);
      expect(computeFare(path("PP14", "BL30"), data)!.total).toBe(23);
    });

    it("takes 15 baht off the Yellow ride after Blue at Lat Phrao, same EMV card", () => {
      const fare = computeFare(path("BL25", "YL02"), data)!; // Ratchadaphisek -> Lat Phrao, walk, Ladprao -> Phawana
      expect(fare.segments.map((s) => s.system)).toEqual(["blue", "yellow"]);
      const yellow = data.systems.yellow.pairs!["YL01|YL02"];
      expect(fare.segments[1]).toMatchObject({ discount: 15, fare: yellow - 15 });
      expect(fare.total).toBe(fare.segments[0].fare! + yellow - 15);
    });

    it("gives no discount the other way round, or at an unrelated change", () => {
      expect(computeFare(path("YL02", "BL25"), data)!.discount).toBe(0);
      // BTS -> Blue is a different operator and pays both entry fees.
      expect(computeFare(path("N9", "BL10"), data)!.discount).toBe(0);
    });

    it("never takes a fare below zero or discounts one it could not price", () => {
      const cheap: FareData = {
        ...data,
        systems: { ...data.systems, yellow: { ...data.systems.yellow, pairs: { "YL01|YL02": 9 } } },
      };
      expect(computeFare(path("BL25", "YL02"), cheap)!.segments[1].fare).toBe(0);
      const unpriced: FareData = { ...data, systems: { ...data.systems, yellow: { ...data.systems.yellow, pairs: {} } } };
      const fare = computeFare(path("BL25", "YL02"), unpriced)!;
      expect(fare.segments[1]).toMatchObject({ fare: null, discount: 0 });
    });
  });

  it("is honest, never NaN, when a fare is missing", () => {
    const partial: FareData = { ...data, systems: { ...data.systems, bts: { ...data.systems.bts, pairs: {} } } };
    const fare = computeFare(path("CEN", "E1"), partial)!;
    expect(fare.complete).toBe(false);
    expect(fare.total).toBe(0);
    expect(Number.isNaN(fare.total)).toBe(false);
  });

  it("returns null with no route, no data, or only a walk", () => {
    expect(computeFare(null, data)).toBeNull();
    expect(computeFare(path("CEN", "E1"), null)).toBeNull();
    expect(computeFare(path("N8", "BL28"), data)).toBeNull(); // Mo Chit -> Chatuchak Park is a walk
  });
});
