import { describe, expect, it } from "vitest";
import { isValidArrivals, type Arrivals } from "@/lib/bts";
import { buildArrivalsDocument, carryOverPlatforms } from "@/lib/arrivals-document";

/**
 * The published document is a contract between the poller (writer) and the
 * browser (reader). The display-only `carried_from` field must survive that
 * trip intact and must not become a way to inflate the document.
 */
const NOW = Date.UTC(2026, 9, 15, 10);
const iso = (ms: number) => new Date(ms).toISOString().replace("Z", "");

function reading(ageMs: number, etas: number[]): Arrivals {
  return {
    station: { code: "CEN", name_en: "Siam", name_th: "สยาม", line_color: "#76b729" },
    platforms: [
      {
        platform: "1",
        line_color: "",
        line_id: 1,
        direction: "เคหะฯ | Kheha",
        direction_key: "E23",
        trains: etas.map((eta, i) => ({ train_no: `${i}`, destination: "x", destination_key: "x", eta_minutes: eta, status: "" })),
      },
    ],
    near_end_of_service: false,
    service_active: true,
    next_service: "",
    server_time: "",
    timestamp: iso(NOW - ageMs),
  };
}

describe("arrivals document contract", () => {
  const carried = carryOverPlatforms(reading(120_000, [6]), reading(0, []), NOW);

  it("a carried platform is still a valid reading", () => {
    expect(carried.platforms[0].carried_from).toBe(iso(NOW - 120_000));
    expect(isValidArrivals(carried)).toBe(true);
  });

  it("carried_from survives publishing and a JSON round trip", () => {
    const { document } = buildArrivalsDocument({ CEN: carried }, ["CEN"], true, NOW);
    const parsed = JSON.parse(JSON.stringify(document)) as typeof document;
    expect(parsed.arrivals.CEN.platforms[0].carried_from).toBe(iso(NOW - 120_000));
    expect(parsed.arrivals.CEN.platforms[0].trains).toHaveLength(1);
  });

  it("carrying twice keeps pointing at the original reading, not the intermediate one", () => {
    const again = carryOverPlatforms(carried, reading(-60_000, []), NOW + 60_000);
    expect(again.platforms[0].carried_from).toBe(iso(NOW - 120_000));
  });

  it("an oversized carried_from is rejected like any other oversized field", () => {
    const bad = structuredClone(carried);
    bad.platforms[0].carried_from = "x".repeat(201);
    expect(isValidArrivals(bad)).toBe(false);
  });
});
