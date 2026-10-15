import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { haversineMeters, trackBetween, type LineSegments } from "@/lib/line-geometry";
import { stationsByCode } from "@/data/stations";

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
    for (const line of ["sukhumvit", "silom", "gold", "blue", "purple", "yellow", "pink", "arl", "srtRed"]) {
      expect(geometry[line]?.length, line).toBeGreaterThan(0);
    }
  });
});
