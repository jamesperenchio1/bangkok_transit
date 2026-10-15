import { describe, expect, it } from "vitest";
import { ageMs, isValidArrivals, MAX_SHOW_AGE_MS, type Arrivals } from "@/lib/bts";
import { buildArrivalsDocument, mergeArrivals, type UpstreamStatus } from "@/lib/arrivals-document";

const NOW = Date.UTC(2026, 9, 15, 10);
function reading(code: string, ageMsAgo: number): Arrivals {
  return {
    station: { code, name_en: code, name_th: code, line_color: "#76b729" },
    platforms: [{ platform: "1", line_color: "", line_id: 1, direction: "a | b", direction_key: "E23", trains: [] }],
    near_end_of_service: false,
    service_active: true,
    next_service: "",
    server_time: "",
    timestamp: new Date(NOW - ageMsAgo).toISOString().replace("Z", ""),
  };
}
const down: UpstreamStatus = { state: "down", since: "x", lastSuccessAt: null, incidents: [] };

describe("ageMs", () => {
  it("treats a naive timestamp as UTC", () => {
    expect(ageMs("2026-10-15T09:59:00", NOW)).toBe(60_000);
    expect(ageMs("2026-10-15T09:59:00Z", NOW)).toBe(60_000);
    expect(ageMs("nonsense", NOW)).toBe(Infinity);
  });
});

describe("isValidArrivals", () => {
  it("accepts a well-formed payload", () => {
    expect(isValidArrivals(reading("N8", 0))).toBe(true);
  });

  it("rejects a 200 response with no platforms (stations outside coverage)", () => {
    const { platforms: _platforms, ...rest } = reading("N8", 0);
    expect(isValidArrivals(rest)).toBe(false);
  });

  it("rejects oversized payloads so upstream can't bloat the shared document", () => {
    const big = reading("N8", 0);
    big.platforms = Array.from({ length: 11 }, () => big.platforms[0]);
    expect(isValidArrivals(big)).toBe(false);
    const longName = reading("N8", 0);
    longName.platforms[0].direction = "x".repeat(201);
    expect(isValidArrivals(longName)).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isValidArrivals(null)).toBe(false);
    expect(isValidArrivals("x")).toBe(false);
  });
});

describe("mergeArrivals", () => {
  it("keeps previous readings, overrides with fresh ones, drops expired ones", () => {
    const previous = { A: reading("A", 60_000), B: reading("B", MAX_SHOW_AGE_MS + 1) };
    const fresh = { A: reading("A", 0) };
    const merged = mergeArrivals(previous, fresh, NOW);
    expect(Object.keys(merged)).toEqual(["A"]);
    expect(merged.A).toBe(fresh.A);
  });
});

describe("buildArrivalsDocument", () => {
  it("caches briefly while filling and longer once complete", () => {
    expect(buildArrivalsDocument({ A: reading("A", 0) }, ["A", "B"], false, NOW).cacheControl).toBe(
      "public, max-age=0, s-maxage=2",
    );
    const done = buildArrivalsDocument({ A: reading("A", 0) }, ["A", "B"], true, NOW);
    expect(done.document.complete).toBe(true);
    expect(done.cacheControl).toBe("public, max-age=0, s-maxage=10");
  });

  it("isn't complete without a single fresh reading, unless upstream is down", () => {
    const stale = { A: reading("A", 5 * 60_000) };
    expect(buildArrivalsDocument(stale, ["A"], true, NOW).document.complete).toBe(false);
    const res = buildArrivalsDocument(stale, ["A"], false, NOW, undefined, down);
    expect(res.document.complete).toBe(true);
    expect(res.cacheControl).toBe("public, max-age=0, s-maxage=30");
    expect(res.document.status).toBe(down);
  });

  it("drops entries one edge lifetime before they expire", () => {
    const nearlyExpired = { A: reading("A", MAX_SHOW_AGE_MS - 5_000) };
    expect(buildArrivalsDocument(nearlyExpired, ["A"], true, NOW).document.arrivals).toEqual({});
  });

  it("only publishes codes it was asked for", () => {
    const res = buildArrivalsDocument({ A: reading("A", 0), Z: reading("Z", 0) }, ["A"], true, NOW);
    expect(Object.keys(res.document.arrivals)).toEqual(["A"]);
    expect(res.document.total).toBe(1);
  });
});
