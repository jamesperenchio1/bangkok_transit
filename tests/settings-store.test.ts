import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "@/lib/settings-store";
import { findPath } from "@/lib/transit-graph";

describe("parseSettings", () => {
  it("returns the defaults for nothing, garbage, or the wrong shape", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("42")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("null")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid saved choices and ignores wrongly typed ones", () => {
    const parsed = parseSettings(
      JSON.stringify({ showLabels: false, autoZoom: "yes", hiddenLines: ["gold", 7], unknown: true }),
    );
    expect(parsed.showLabels).toBe(false);
    expect(parsed.autoZoom).toBe(DEFAULT_SETTINGS.autoZoom);
    expect(parsed.hiddenLines).toEqual(["gold"]);
    expect(parsed).not.toHaveProperty("unknown");
  });

  it("defaults leave the map exactly as it was before settings existed", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      showLabels: true,
      showTrains: true,
      showLocation: true,
      autoZoom: true,
      hiddenLines: [],
      fewerChanges: false,
      avoidWalking: false,
    });
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
    // Same trip here (the walk is unavoidable), so the same honest time.
    expect(avoiding!.minutes).toBe(plain!.minutes);
  });

  it("fewer-changes never adds changes", () => {
    const plain = findPath("W1", "E1")!;
    const fewer = findPath("W1", "E1", { fewerChanges: true })!;
    expect(fewer.changes).toBeLessThanOrEqual(plain.changes);
  });
});
