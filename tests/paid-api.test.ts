import { describe, expect, it } from "vitest";
import { ARRIVALS_URL } from "@/lib/arrivals-url";
import type { ArrivalsDocument } from "@/lib/arrivals-document";
import type { Arrivals } from "@/lib/bts";
import {
  LIVE_ARRIVALS_URL, PAID_ENDPOINTS, apiIndex, arrivalsFacts, findStation, lineFacts, priceUsd, routeFacts, stationFacts,
} from "@/lib/paid-api";

const NOW = Date.UTC(2026, 10, 9, 8, 0, 0);
/** Upstream timestamps are UTC with no trailing Z. */
const stamp = (ageMs: number) => new Date(NOW - ageMs).toISOString().replace("Z", "");

function reading(code: string, ageMs: number): Arrivals {
  return {
    station: { code, name_en: code, name_th: code, line_color: "#76b729" },
    platforms: [],
    near_end_of_service: false,
    service_active: true,
    next_service: "",
    server_time: "09/11/2026 15:00",
    timestamp: stamp(ageMs),
  };
}
const doc = (arrivals: Record<string, Arrivals>, state: "ok" | "down" = "ok"): ArrivalsDocument => ({
  arrivals,
  total: Object.keys(arrivals).length,
  complete: true,
  status: { state, since: "2026-11-09T00:00:00.000Z", lastSuccessAt: null, incidents: [] },
});

describe("the price table", () => {
  it("quotes every endpoint in dollars, once, with a distinct route", () => {
    expect(PAID_ENDPOINTS.map((e) => e.id).sort()).toEqual(["arrivals", "line", "route", "station"]);
    for (const e of PAID_ENDPOINTS) {
      expect(e.price, e.id).toMatch(/^\$\d+\.\d{3}$/);
      expect(priceUsd(e), e.id).toBeGreaterThan(0);
      expect(priceUsd(e), e.id).toBeLessThan(1);
    }
    expect(new Set(PAID_ENDPOINTS.map((e) => e.route)).size).toBe(PAID_ENDPOINTS.length);
  });

  it("reads live arrivals from the same document the site does", () => {
    expect(LIVE_ARRIVALS_URL).toBe(ARRIVALS_URL);
  });
});

describe("arrivals", () => {
  it("serves a fresh reading with its age", () => {
    const r = arrivalsFacts(doc({ N8: reading("N8", 20_000) }), "N8", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.ageSeconds).toBe(20);
      expect(r.body.lastKnown).toBe(false);
    }
  });

  it("labels an older reading last-known, and drops one older than 30 minutes", () => {
    const old = arrivalsFacts(doc({ N8: reading("N8", 5 * 60_000) }), "N8", NOW);
    expect(old.ok && old.body.lastKnown).toBe(true);
    const gone = arrivalsFacts(doc({ N8: reading("N8", 31 * 60_000) }), "N8", NOW);
    expect(gone).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses (so the caller is not charged) when there is nothing to serve", () => {
    expect(arrivalsFacts(doc({}), undefined, NOW)).toMatchObject({ ok: false, status: 400 });
    expect(arrivalsFacts(doc({}), "NOPE", NOW)).toMatchObject({ ok: false, status: 404 });
    // An MRT station has no live feed at all.
    expect(arrivalsFacts(doc({}), "BL01", NOW)).toMatchObject({ ok: false, status: 404 });
    const down = arrivalsFacts(doc({}, "down"), "N8", NOW);
    expect(down).toMatchObject({ ok: false, status: 404 });
    if (!down.ok) expect(down.error).toContain("feed is down");
  });
});

describe("route, station and line facts", () => {
  it("plans a route between stations given by code or slug", () => {
    const r = routeFacts("N8", "siam-cen");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.minutes).toBeGreaterThan(0);
      expect((r.body.steps as string[])[0]).toBe("Start at Mo Chit.");
      expect(r.body.note).toContain("estimates");
    }
  });

  it("explains a bad request instead of guessing", () => {
    expect(routeFacts(undefined, "N8")).toMatchObject({ ok: false, status: 400 });
    expect(routeFacts("N8", "N8")).toMatchObject({ ok: false, status: 400 });
    expect(routeFacts("N8", "nowhere")).toMatchObject({ ok: false, status: 404 });
  });

  it("finds a station by slug, by code, in any case", () => {
    expect(findStation("siam-cen")?.code).toBe("CEN");
    expect(findStation("CEN")?.code).toBe("CEN");
    expect(findStation("cen")?.code).toBe("CEN");
    expect(findStation("x".repeat(500))).toBeUndefined();
    expect(findStation("")).toBeUndefined();
  });

  it("describes a station and a line", () => {
    const s = stationFacts("siam-cen")!;
    expect(s.nameEn).toBe("Siam");
    expect(s.lines.length).toBe(2);
    expect(s.neighbours.length).toBeGreaterThan(0);
    expect(stationFacts("nope")).toBeNull();
    const l = lineFacts("bts-sukhumvit-line")!;
    expect(l.stationCount).toBeGreaterThan(40);
    expect(l.terminalStations.length).toBe(2);
    expect(lineFacts("nope")).toBeNull();
  });
});

describe("the free index", () => {
  it("lists every endpoint with its price, and says plainly when payments are test money", () => {
    const idx = apiIndex({ network: "eip155:84532", payTo: "0x941eb61c0052da28d09e39f7ddc946a9631a5eeb", facilitator: "https://x402.org/facilitator", testnet: true });
    expect(idx.endpoints.map((e) => e.price)).toEqual(PAID_ENDPOINTS.map((e) => e.price));
    expect(idx.payments.notice).toContain("TEST MODE");
    const live = apiIndex({ network: "eip155:8453", payTo: "0x941eb61c0052da28d09e39f7ddc946a9631a5eeb", facilitator: "https://f.example", testnet: false });
    expect(live.payments.notice).not.toContain("TEST");
  });
});
