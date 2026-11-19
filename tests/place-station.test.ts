import { describe, expect, it } from "vitest";
import { stationsByCode } from "@/data/stations";
import { nearestStations } from "@/lib/nearest-station";
import { chooseStationForPlace } from "@/lib/place-station";
import { walkEstimate } from "@/lib/transit-graph";

// Central World: the case that started this. It sits 490 m from Chit Lom and
// 521 m from Siam, so "nearest" alone picks Chit Lom - but a rider coming up
// the Silom line reaches Siam without changing, and walks the rest.
const CENTRAL_WORLD = { lat: 13.7466, lon: 100.5393 };

describe("nearestStations", () => {
  it("returns the same station nearestStation does, first", () => {
    const [first] = nearestStations(CENTRAL_WORLD.lat, CENTRAL_WORLD.lon, { limit: 3 });
    expect(first.station.code).toBe("E1");
    expect(first.meters).toBeGreaterThan(400);
    expect(first.meters).toBeLessThan(600);
  });

  it("orders by distance, limits the count and honours a radius", () => {
    const all = nearestStations(CENTRAL_WORLD.lat, CENTRAL_WORLD.lon, { limit: 3 });
    expect(all).toHaveLength(3);
    expect(all[0].meters).toBeLessThanOrEqual(all[1].meters);
    expect(all[1].meters).toBeLessThanOrEqual(all[2].meters);
    expect(all.map((s) => s.station.code)).toContain("CEN");

    const close = nearestStations(CENTRAL_WORLD.lat, CENTRAL_WORLD.lon, { withinMeters: 500 });
    expect(close.length).toBeGreaterThan(0);
    expect(close.every((s) => s.meters <= 500)).toBe(true);
    expect(close.map((s) => s.station.code)).not.toContain("CEN");
  });
});

describe("walkEstimate", () => {
  it("charges the walking-transfer overhead plus the walk", () => {
    expect(walkEstimate(0)).toBe(3);
    expect(walkEstimate(750)).toBe(13);
    // A slower rider spends longer on the same metres.
    expect(walkEstimate(750, 50)).toBeGreaterThan(walkEstimate(750, 75));
  });
});

describe("chooseStationForPlace", () => {
  it("routes Central World through Siam from the Silom line, not the nearest station", () => {
    // Sala Daeng (S2): one Silom-line ride to Siam, no change; Chit Lom needs
    // a change at Siam plus a hop for 31 m less walking.
    const choice = chooseStationForPlace("S2", CENTRAL_WORLD);
    expect(choice.station.code).toBe("CEN");
    expect(choice.meters).toBeGreaterThan(nearestStations(CENTRAL_WORLD.lat, CENTRAL_WORLD.lon)[0].meters);
  });

  it("still picks the nearest station when it is also the quickest", () => {
    // Asok (E4) is on the Sukhumvit line with Chit Lom: riding on beats
    // riding one stop further and walking back.
    const choice = chooseStationForPlace("E4", CENTRAL_WORLD);
    expect(choice.station.code).toBe("E1");
  });

  it("falls back to the nearest station with no origin to compare from", () => {
    const choice = chooseStationForPlace(null, CENTRAL_WORLD);
    expect(choice.station.code).toBe("E1");
    expect(choice.minutes).toBe(walkEstimate(choice.meters));
  });

  it("falls back to the nearest station when no route reaches any candidate", () => {
    // An origin that does not exist cannot be routed from.
    const choice = chooseStationForPlace("NOPE", CENTRAL_WORLD);
    expect(choice.station.code).toBe("E1");
  });

  it("counts the walk in the total it compares on", () => {
    const choice = chooseStationForPlace("S2", CENTRAL_WORLD);
    // Station-to-station minutes plus the walk, never just the ride.
    expect(choice.minutes).toBeGreaterThan(walkEstimate(choice.meters));
    expect(stationsByCode.get(choice.station.code)).toBe(choice.station);
  });
});
