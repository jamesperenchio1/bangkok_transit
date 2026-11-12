import { describe, expect, it } from "vitest";
import { stations, stationsByCode } from "@/data/stations";
import { findPath } from "@/lib/transit-graph";
import {
  ENDPOINT_COLOR,
  googleToMapLibreZoom,
  labelText,
  lineTracks,
  mapLibreToGoogleZoom,
  routeBounds,
  routeFitPadding,
  routeParts,
  stationLineColor,
  stationVisuals,
} from "@/lib/map-data";
import { stationLineSegments } from "@/lib/line-geometry";
import { trainScale } from "@/lib/train-model";

const at = (code: string) => stationsByCode.get(code)!;

describe("stationVisuals", () => {
  it("draws every station with no route and nothing hidden", () => {
    const all = stationVisuals(new Set(), null, null, false);
    expect(all).toHaveLength(stations.length);
    expect(all.every((v) => !v.dimmed && v.labelOpacity === 1)).toBe(true);
  });

  it("marks the route ends: green start fill, green ring colour, lowest sort key", () => {
    const visuals = stationVisuals(new Set(["W1", "CEN", "E1"]), "W1", "E1", true);
    const start = visuals.find((v) => v.code === "W1")!;
    const end = visuals.find((v) => v.code === "E1")!;
    const middle = visuals.find((v) => v.code === "CEN")!;
    const other = visuals.find((v) => v.code === "N24")!;
    expect(start.fillColor).toBe(ENDPOINT_COLOR);
    expect(start.isStart).toBe(true);
    expect(end.isDestination).toBe(true);
    expect(end.strokeColor).toBe(ENDPOINT_COLOR);
    expect(start.sortKey).toBe(0);
    expect(middle.sortKey).toBe(1);
    expect(other.dimmed).toBe(true);
    expect(other.labelOpacity).toBeLessThan(1);
    expect(other.sortKey).toBeGreaterThanOrEqual(2);
  });

  it("drops a station only when every line through it is hidden, never one on the route", () => {
    const visuals = stationVisuals(new Set(["W1"]), null, null, true, ["silom"]);
    const codes = new Set(visuals.map((v) => v.code));
    expect(codes.has("W1")).toBe(true); // on the route
    expect(codes.has("S10")).toBe(false); // silom only
    expect(codes.has("CEN")).toBe(true); // an interchange keeps its other line
    // An interchange takes the colour of a line that is still shown.
    const first = at("CEN").lines[0].line;
    expect(stationLineColor(at("CEN"), [first])).not.toBe(stationLineColor(at("CEN")));
  });
});

describe("shared geometry", () => {
  it("draws every line from the straight stand-in track", () => {
    const tracks = lineTracks(stationLineSegments());
    expect(new Set(tracks.map((t) => t.line)).size).toBeGreaterThan(8);
    expect(tracks.every((t) => t.points.length >= 2)).toBe(true);
  });

  it("makes one part per leg of a route, walks dashed", () => {
    const path = findPath("W1", "E4")!;
    const parts = routeParts(path, stationLineSegments());
    expect(parts).toHaveLength(path.legs.length - 1);
    expect(parts.every((p) => p.points.length >= 2)).toBe(true);
    const [[west, south], [east, north]] = routeBounds(path);
    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(north);
  });
});

describe("labelText", () => {
  const siam = at("CEN");
  it("follows the app language, or a fixed one", () => {
    expect(labelText(siam, "en", "ui", false).primary).toBe(siam.nameEn);
    expect(labelText(siam, "th", "ui", false).primary).toBe(siam.nameTh);
    expect(labelText(siam, "th", "en", false).primary).toBe(siam.nameEn);
  });
  it("shows both languages, and the operator's code only when asked", () => {
    const both = labelText(siam, "en", "both", true);
    expect(both.primary).toBe(siam.nameEn);
    expect(both.secondary).toBe(siam.nameTh);
    expect(both.code).toBe(siam.displayCode ?? siam.code);
    expect(labelText(siam, "en", "ui", false).code).toBeUndefined();
  });
  it("shows the official code, not the internal id", () => {
    const blue = at("BL07");
    expect(labelText(blue, "en", "ui", true).code).toBe(blue.displayCode ?? blue.code);
  });
});

describe("camera helpers", () => {
  it("converts between Google's zoom scale and MapLibre's", () => {
    expect(googleToMapLibreZoom(12)).toBe(11);
    expect(mapLibreToGoogleZoom(googleToMapLibreZoom(15))).toBe(15);
  });

  it("leaves room for the route sheet, but never pads the whole map away", () => {
    const closed = routeFitPadding(false, 800, 700, 800);
    expect(closed).toEqual({ top: 40, left: 40, right: 40, bottom: 40 });
    // The sheet covers the bottom 70% of an 800 px window (560 px) plus 24 px of air, but the
    // padding never exceeds what leaves 120 px of map to fit into: 700 - 120.
    expect(routeFitPadding(true, 800, 700, 800).bottom).toBe(580);
    // A short map: the sheet would cover 60 px (+24), capped to leave 120 px of the 200.
    expect(routeFitPadding(true, 300, 200, 800).bottom).toBe(80);
    // A very short map cannot give up even that much; the floor is 40.
    expect(routeFitPadding(true, 300, 100, 800).bottom).toBe(40);
  });
});

describe("trainScale", () => {
  it("grows with zoom between the stops, and scales with the size setting", () => {
    expect(trainScale(5, 1)).toBeCloseTo(0.5);
    expect(trainScale(9, 1)).toBeCloseTo(0.5);
    expect(trainScale(10.5, 1)).toBeCloseTo(0.575);
    expect(trainScale(17, 1)).toBeCloseTo(1);
    expect(trainScale(30, 1)).toBeCloseTo(1);
    expect(trainScale(12, 1.3)).toBeCloseTo(0.65 * 1.3);
  });
});
