import { describe, expect, it } from "vitest";
import faresJson from "@/data/fares.json";
import { stations } from "@/data/stations";
import { computeFare, fareForStops, type FareData } from "@/lib/fares";
import { findPath } from "@/lib/transit-graph";

const data = faresJson as FareData;
const path = (a: string, b: string) => {
  const p = findPath(a, b);
  if (!p) throw new Error(`no route ${a}-${b}`);
  return p;
};

describe("fares", () => {
  it("prices a Blue Line ride by stations travelled and caps long trips", () => {
    const blue = data.operators.mrt!;
    expect(fareForStops(blue, 1)).toBe(17);
    expect(fareForStops(blue, 12)).toBe(44);
    expect(fareForStops(blue, 30)).toBe(44);
    expect(fareForStops(blue, 0)).toBeNull();
  });

  it("stop fares never decrease with distance and stay plausible", () => {
    for (const op of Object.values(data.operators)) {
      if (!op) continue;
      op.stopFares.forEach((f, i) => {
        expect(f).toBeGreaterThanOrEqual(10);
        expect(f).toBeLessThanOrEqual(100);
        if (i > 0) expect(f).toBeGreaterThanOrEqual(op.stopFares[i - 1]);
      });
    }
  });

  it("only references real lines", () => {
    const known = new Set(stations.flatMap((s) => s.lines.map((l) => l.line)));
    for (const op of Object.values(data.operators)) for (const l of op?.lines ?? []) expect(known.has(l)).toBe(true);
  });

  it("is complete for a priced single-operator trip", () => {
    const p = path("BL01", "BL05");
    const fare = computeFare(p, data)!;
    expect(fare.complete).toBe(true);
    expect(fare.segments).toHaveLength(1);
    expect(fare.total).toBe(fareForStops(data.operators.mrt!, p.stops));
  });

  it("is honest, not NaN, when an operator has no table", () => {
    const fare = computeFare(path("N8", "N4"), data)!;
    expect(fare.complete).toBe(false);
    expect(fare.total).toBe(0);
    expect(Number.isNaN(fare.total)).toBe(false);
  });

  it("a walk-only route has no fare", () => {
    expect(computeFare(path("N8", "BL28"), data)).toBeNull(); // Mo Chit -> Chatuchak Park is a walk
  });

  it("splits fares at a walk and sums only priced segments", () => {
    const fare = computeFare(path("N9", "BL10"), data)!; // BTS ride, walk, then MRT Blue
    expect(fare.segments.map((s) => s.operator)).toEqual(["bts", "mrt"]);
    expect(fare.complete).toBe(false);
    expect(fare.total).toBe(fare.segments[1].fare);
  });

  it("returns null with no route or no ride", () => {
    expect(computeFare(null, data)).toBeNull();
  });
});
