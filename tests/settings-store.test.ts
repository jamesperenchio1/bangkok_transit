import { describe, expect, it } from "vitest";
import { CHOICES, DEFAULT_SETTINGS, RANGES, parseSettings } from "@/lib/settings-store";
import { findPath, linesInTheWay } from "@/lib/transit-graph";
import { routeHops, trainOnRoute } from "@/lib/live-trains";

describe("parseSettings", () => {
  it("returns the defaults for nothing, garbage, or the wrong shape", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("42")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("null")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid saved choices and ignores wrongly typed ones", () => {
    const parsed = parseSettings(
      JSON.stringify({ showLabels: false, autoZoom: "yes", hiddenLines: ["gold", 7], theme: "dark", units: "parsecs", unknown: true }),
    );
    expect(parsed.showLabels).toBe(false);
    expect(parsed.autoZoom).toBe(DEFAULT_SETTINGS.autoZoom);
    expect(parsed.hiddenLines).toEqual(["gold"]);
    expect(parsed.theme).toBe("dark");
    expect(parsed.units).toBe("metric"); // not an allowed value
    expect(parsed).not.toHaveProperty("unknown");
  });

  it("clamps numbers into their range", () => {
    const parsed = parseSettings(JSON.stringify({ textSize: 9000, walkSpeed: -5, alertVolume: 0, upcomingCount: 2.0 }));
    expect(parsed.textSize).toBe(RANGES.textSize![1]);
    expect(parsed.walkSpeed).toBe(RANGES.walkSpeed![0]);
    expect(parsed.alertVolume).toBe(RANGES.alertVolume![0]);
    expect(parsed.upcomingCount).toBe(2);
  });

  it("every default is inside its own allowed choices / range", () => {
    for (const [key, allowed] of Object.entries(CHOICES)) {
      expect(allowed).toContain((DEFAULT_SETTINGS as unknown as Record<string, string>)[key]);
    }
    for (const [key, [min, max]] of Object.entries(RANGES) as [string, [number, number]][]) {
      const v = (DEFAULT_SETTINGS as unknown as Record<string, number>)[key];
      expect(v).toBeGreaterThanOrEqual(min);
      expect(v).toBeLessThanOrEqual(max);
    }
  });

  it("defaults leave the map as it was before settings existed (trains off the route aside)", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      showLabels: true,
      showTrains: true,
      showLocation: true,
      autoZoom: true,
      hiddenLines: [],
      fewerChanges: false,
      avoidWalking: false,
      lineWidth: 4,
      routeWidth: 5,
      walkSpeed: 75,
      changeMinutes: 5,
      upcomingCount: 3,
      textSize: 100,
      theme: "system",
    });
  });

  it("does not share the default arrays (mutating a parsed copy can't change the defaults)", () => {
    const a = parseSettings(null);
    a.hiddenLines.push("gold");
    expect(DEFAULT_SETTINGS.hiddenLines).toEqual([]);
  });
});

describe("findPath preferences", () => {
  it("are off by default: no options gives the same route as empty options", () => {
    expect(findPath("N8", "BL22")).toEqual(findPath("N8", "BL22", {}));
  });

  it("never inflate the minutes shown, and still find a route that needs a walk", () => {
    const plain = findPath("N8", "BL22");
    const avoiding = findPath("N8", "BL22", { avoidWalking: true, fewerChanges: true });
    expect(avoiding).not.toBeNull();
    expect(avoiding!.minutes).toBe(plain!.minutes);
  });

  it("fewer-changes never adds changes", () => {
    const plain = findPath("W1", "E1")!;
    const fewer = findPath("W1", "E1", { fewerChanges: true })!;
    expect(fewer.changes).toBeLessThanOrEqual(plain.changes);
  });

  it("a slower walking speed or a longer change makes the trip longer, a faster one shorter", () => {
    const base = findPath("N8", "BL22")!.minutes;
    expect(findPath("N8", "BL22", { walkSpeed: 40 })!.minutes).toBeGreaterThanOrEqual(base);
    expect(findPath("N8", "BL22", { walkSpeed: 120 })!.minutes).toBeLessThanOrEqual(base);
    const change = findPath("W1", "E1")!;
    if (change.changes > 0) {
      expect(findPath("W1", "E1", { changeMinutes: 15 })!.minutes).toBeGreaterThan(change.minutes);
    }
  });

  it("a line turned off for routes is never ridden", () => {
    // Siam to Chit Lom is one Sukhumvit hop: with that line off there is no way between them
    // (a walking transfer does not connect them), and the router says so rather than riding it.
    expect(findPath("CEN", "E1")).not.toBeNull();
    expect(findPath("CEN", "E1", { unusedLines: ["sukhumvit"] })).toBeNull();
  });

  it("goes round a line that is off when there is another way", () => {
    const base = findPath("W1", "BL22");
    expect(base).not.toBeNull();
    const rides = (p: NonNullable<typeof base>) => new Set(p.legs.map((l) => l.line).filter(Boolean));
    // Pick a line the best route rides, turn it off, and require any route found to avoid it.
    for (const line of rides(base!)) {
      const detour = findPath("W1", "BL22", { unusedLines: [line!] });
      if (detour) expect(rides(detour).has(line)).toBe(false);
    }
  });

  it("names the lines in the way when they are the only reason there is no route", () => {
    expect(linesInTheWay("CEN", "E1", {})).toEqual([]); // nothing turned off
    expect(linesInTheWay("CEN", "E1", { unusedLines: ["sukhumvit"] })).toEqual(["sukhumvit"]);
    // Turning off a line the trip does not need is not the reason for anything.
    expect(linesInTheWay("CEN", "E1", { unusedLines: ["gold"] })).toEqual([]);
    // Unconnected stations stay "no route" however the lines are set.
    expect(linesInTheWay("CEN", "CEN", { unusedLines: ["sukhumvit"] })).toEqual([]);
  });

  it("hidden-on-the-map and unused-for-routes are separate settings", () => {
    const parsed = parseSettings(JSON.stringify({ hiddenLines: ["gold"], unusedLines: ["blue", 5], avoidLines: ["silom"] }));
    expect(parsed.hiddenLines).toEqual(["gold"]);
    expect(parsed.unusedLines).toEqual(["blue"]);
    // The old soft "lines to avoid" setting is gone, not silently turned into a ban.
    expect(parsed).not.toHaveProperty("avoidLines");
  });
});

describe("routeHops / trainOnRoute", () => {
  const path = findPath("N8", "N5")!;
  const hops = routeHops(path.legs);

  it("lists the directed hops of the ride legs", () => {
    expect([...hops]).toEqual(["N8>N7", "N7>N6", "N6>N5"]);
  });

  it("a train heading along the route is on it; one heading the other way, or elsewhere, is not", () => {
    expect(trainOnRoute({ heading: ["N7", "N6"] }, hops)).toBe(true);
    expect(trainOnRoute({ heading: ["N6", "N7"] }, hops)).toBe(false);
    expect(trainOnRoute({ heading: ["E4", "E5"] }, hops)).toBe(false);
  });

  it("with no route every train counts", () => {
    expect(trainOnRoute({ heading: ["E4", "E5"] }, null)).toBe(true);
  });

  it("a walking leg breaks the chain: no hop spans a walk", () => {
    const withWalk = findPath("N8", "BL22")!;
    for (const hop of routeHops(withWalk.legs)) {
      const [a, b] = hop.split(">");
      expect(withWalk.legs.some((l, i) => i > 0 && l.mode === "ride" && withWalk.legs[i - 1].station.code === a && l.station.code === b)).toBe(true);
    }
  });
});
