import { describe, expect, it } from "vitest";
import { stationsByCode } from "@/data/stations";
import { findPath } from "@/lib/transit-graph";
import { DEFAULT_ALERT_SETTINGS, alertTargets, dueTarget, type AlertSettings } from "@/lib/stop-alert";

const settings = (patch: Partial<AlertSettings> = {}): AlertSettings => ({ ...DEFAULT_ALERT_SETTINGS, enabled: true, ...patch });
const at = (code: string, accuracy = 20) => {
  const s = stationsByCode.get(code)!;
  return { lat: s.lat, lon: s.lon, accuracy };
};

describe("alertTargets", () => {
  const path = findPath("N8", "CEN")!; // N8 N7 N6 N5 N4 N3 N2 N1 CEN

  it("always rings at the destination, and one stop before by default", () => {
    const codes = alertTargets(path, settings()).map((t) => [t.station.code, t.kind, t.stopsLeft]);
    expect(codes).toEqual([
      ["CEN", "arrive", 0],
      ["N1", "approach", 1],
    ]);
  });

  it("rings only on arrival when set to 0 stops before", () => {
    expect(alertTargets(path, settings({ stationsBefore: 0 })).map((t) => t.station.code)).toEqual(["CEN"]);
  });

  it("supports 2 and 3 stops before", () => {
    expect(alertTargets(path, settings({ stationsBefore: 3 })).map((t) => t.station.code)).toEqual(["CEN", "N3"]);
  });

  it("never rings at the boarding station", () => {
    const short = findPath("N1", "CEN")!; // one stop
    expect(alertTargets(short, settings({ stationsBefore: 1 })).map((t) => t.station.code)).toEqual(["CEN"]);
  });

  it("adds line changes when asked, but not otherwise", () => {
    const withChange = findPath("W1", "E1")!; // changes at Siam
    expect(alertTargets(withChange, settings({ stationsBefore: 0 })).map((t) => t.kind)).toEqual(["arrive"]);
    const kinds = alertTargets(withChange, settings({ stationsBefore: 0, atChanges: true })).map((t) => t.kind);
    expect(kinds).toContain("change");
  });

  it("has nothing to ring for a one-station route", () => {
    expect(alertTargets({ legs: [path.legs[0]], stops: 0, changes: 0, walkMeters: 0, minutes: 0 }, settings())).toEqual([]);
  });
});

describe("dueTarget", () => {
  const path = findPath("N8", "CEN")!;
  const targets = alertTargets(path, settings());

  it("fires when the fix is at a target station", () => {
    expect(dueTarget(targets, at("N1"), new Set())?.station.code).toBe("N1");
    expect(dueTarget(targets, at("CEN"), new Set())?.station.code).toBe("CEN");
  });

  it("does nothing mid-route or when far away", () => {
    expect(dueTarget(targets, at("N5"), new Set())).toBeNull();
    expect(dueTarget(targets, { lat: 13.9, lon: 100.7, accuracy: 10 }, new Set())).toBeNull();
  });

  it("rings each target once", () => {
    const n1 = targets.find((t) => t.station.code === "N1")!;
    expect(dueTarget(targets, at("N1"), new Set([n1.legIndex]))).toBeNull();
  });

  it("ignores a fix too vague to trust", () => {
    expect(dueTarget(targets, at("CEN", 5000), new Set())).toBeNull();
  });
});
