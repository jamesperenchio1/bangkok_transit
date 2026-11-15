import { describe, expect, it } from "vitest";
import { revealParts } from "@/lib/route-reveal";
import type { RoutePart } from "@/lib/map-data";

const parts: RoutePart[] = [
  { line: "BTS_SUKHUMVIT", walk: false, points: [[13, 100], [13, 100.01]] },
  { line: "", walk: true, points: [[13, 100.01], [13, 100.02]] },
] as RoutePart[];

describe("revealParts", () => {
  it("returns everything at 1 and nothing at 0", () => {
    expect(revealParts(parts, 1)).toBe(parts);
    expect(revealParts(parts, 0).every((p) => p.points.length === 0)).toBe(true);
  });
  it("draws leg by leg, origin first", () => {
    const half = revealParts(parts, 0.5);
    expect(half[0].points).toHaveLength(2);
    expect(half[1].points).toHaveLength(0);
    const quarter = revealParts(parts, 0.25);
    expect(quarter[0].points[1][1]).toBeCloseTo(100.005, 5);
  });
});
