import { describe, expect, it } from "vitest";
import type { Arrivals } from "@/lib/bts";
import { estimateTrains } from "@/lib/live-trains";

// The upstream stamps payloads in UTC without a "Z".
const naive = (ms: number) => new Date(ms).toISOString().replace("Z", "");
const T0 = Date.UTC(2026, 10, 5, 11, 0, 0); // 18:00 in Bangkok

interface Sighting {
  train: string;
  eta: number;
}

/** One station's reading with one platform per entry: [direction_key, sightings]. */
function reading(code: string, readAt: number, platforms: [string, Sighting[]][]): Arrivals {
  return {
    station: { code, name_en: code, name_th: code, line_color: "#000" },
    platforms: platforms.map(([directionKey, trains], i) => ({
      platform: String(i + 1),
      line_color: "#000",
      line_id: 1,
      direction: directionKey,
      direction_key: directionKey,
      trains: trains.map((t) => ({
        train_no: t.train,
        destination: directionKey,
        destination_key: directionKey,
        eta_minutes: Math.round(t.eta),
        eta_precise: t.eta,
        status: "pending",
      })),
    })),
    near_end_of_service: false,
    service_active: true,
    next_service: "",
    server_time: "",
    timestamp: naive(readAt),
  };
}

function docOf(...readings: Arrivals[]): Record<string, Arrivals> {
  return Object.fromEntries(readings.map((r) => [r.station.code, r]));
}

// Toward Kheha (E23) on Sukhumvit trains run N10 -> N9 -> N8 -> N7.
const heading = (code: string, eta: number, train = "087") =>
  reading(code, T0, [["E23", [{ train, eta }]]]);

describe("estimateTrains", () => {
  it("places a train between the stop it left and the stop it is heading for", () => {
    const doc = docOf(heading("N9", 1), heading("N8", 3));
    const [train] = estimateTrains(doc, T0);
    expect(train).toMatchObject({ line: "sukhumvit", trainNo: "087", towardCode: "E23", fromCode: "N10", toCode: "N9" });
    expect(train.fraction).toBeGreaterThan(0);
    expect(train.fraction).toBeLessThan(1);
  });

  it("faces the way it is travelling, on the move and at a station", () => {
    const doc = docOf(heading("N9", 0.5), heading("N8", 1.5));
    // Between N9 and N8: facing along that hop.
    expect(estimateTrains(doc, T0 + 60_000)[0].heading).toEqual(["N9", "N8"]);
    // Stopped at N9: facing along the hop that leaves it.
    expect(estimateTrains(doc, T0 + 30_000)[0].heading).toEqual(["N9", "N8"]);
    // The other direction faces the other way along the same stretch.
    const toward = (code: string, eta: number) => reading(code, T0, [["N24", [{ train: "046", eta }]]]);
    expect(estimateTrains(docOf(toward("N9", 0.5), toward("N10", 1.5)), T0 + 60_000)[0].heading).toEqual(["N9", "N10"]);
  });

  it("says which stop it reaches next and when", () => {
    const doc = docOf(heading("N9", 0.5), heading("N8", 1.5));
    // On the way to N9 (due +30 s), then to N8 (due +90 s), then nothing more is known.
    expect(estimateTrains(doc, T0 + 10_000)[0].next).toEqual({ code: "N9", at: T0 + 30_000 });
    expect(estimateTrains(doc, T0 + 60_000)[0].next).toEqual({ code: "N8", at: T0 + 90_000 });
    expect(estimateTrains(doc, T0 + 100_000)).toEqual([]); // past the 90 s freshness limit
    const short = docOf(heading("N9", 0.2), heading("N8", 0.5));
    expect(estimateTrains(short, T0 + 60_000)[0].next).toBeNull();
  });

  it("at the last stop of the line, faces the way it arrived", () => {
    const doc = docOf(
      reading("N24", T0, [["N24", [{ train: "046", eta: 0.4 }]]]),
      reading("N23", T0, [["N24", [{ train: "046", eta: 0.2 }]]]),
    );
    expect(estimateTrains(doc, T0 + 40_000)[0]).toMatchObject({ fromCode: "N24", toCode: "N24", heading: ["N23", "N24"] });
  });

  it("moves along the track as the clock runs", () => {
    // Due at N9 in 6 s and at N8 in 84 s. (Readings count as live for 90 s,
    // so the whole walk-through stays inside one reading.)
    const doc = docOf(heading("N9", 0.1), heading("N8", 1.4));
    expect(estimateTrains(doc, T0 + 6_000)[0]).toMatchObject({ fromCode: "N9", toCode: "N9", fraction: 0 });
    // Leaves N9 after its 30 s stop (+36 s), so +60 s is halfway to N8.
    expect(estimateTrains(doc, T0 + 60_000)[0]).toMatchObject({ fromCode: "N9", toCode: "N8", fraction: 0.5 });
  });

  it("stands at each station for its dwell time, then pulls out", () => {
    const doc = docOf(heading("N9", 0.1), heading("N8", 1.4));
    // Still at the platform 25 s after arriving...
    expect(estimateTrains(doc, T0 + 31_000)[0]).toMatchObject({ fromCode: "N9", toCode: "N9", fraction: 0 });
    // ...and moving 10 s after it left.
    const moving = estimateTrains(doc, T0 + 46_000)[0];
    expect(moving).toMatchObject({ fromCode: "N9", toCode: "N8" });
    expect(moving.fraction).toBeGreaterThan(0);
    expect(moving.fraction).toBeLessThan(0.5);
  });

  it("stops at a station the feed skipped, rather than gliding through it", () => {
    // N9 then N7: N8 is missing, but the train still stands at it.
    const doc = docOf(heading("N9", 0.1), heading("N7", 1.4));
    const at = (ms: number) => estimateTrains(doc, T0 + ms)[0];
    const seen = [];
    for (let ms = 6_000; ms <= 90_000; ms += 1_000) {
      const t = at(ms);
      if (t && t.fromCode === t.toCode) seen.push(t.fromCode);
    }
    expect(new Set(seen)).toEqual(new Set(["N9", "N8", "N7"]));
  });

  it("orients trains by the platform's direction", () => {
    // Toward Khu Khot (N24) the same stations are visited in the other order.
    const toward = (code: string, eta: number) => reading(code, T0, [["N24", [{ train: "046", eta }]]]);
    const doc = docOf(toward("N9", 1), toward("N10", 3));
    expect(estimateTrains(doc, T0)[0]).toMatchObject({ towardCode: "N24", fromCode: "N8", toCode: "N9" });
  });

  it("treats the timestamp as UTC, not local time", () => {
    // Read as local time on a UTC+7 machine this would be seven hours old and dropped.
    expect(estimateTrains(docOf(heading("N9", 1), heading("N8", 3)), T0 + 5_000)).toHaveLength(1);
  });

  it("ignores readings that are no longer live", () => {
    const old = T0 - 5 * 60_000;
    const doc = docOf(reading("N9", old, [["E23", [{ train: "087", eta: 8 }]]]));
    expect(estimateTrains(doc, T0)).toEqual([]);
  });

  it("drops a train a little after its last sighting", () => {
    const doc = docOf(heading("N9", 0.2), heading("N8", 0.5)); // last sighting at +30 s
    expect(estimateTrains(doc, T0 + 60_000)).toHaveLength(1); // lingering at N8
    expect(estimateTrains(doc, T0 + 80_000)).toEqual([]);
  });

  it("does not guess where a train is when only a far-off stop knows about it", () => {
    // A single sighting ten minutes out at N5: the stations behind it say nothing.
    expect(estimateTrains(docOf(heading("N5", 10)), T0)).toEqual([]);
  });

  it("keeps trains of different numbers apart", () => {
    const doc = docOf(
      reading("N9", T0, [["E23", [{ train: "087", eta: 1 }, { train: "076", eta: 1.5 }]]]),
      reading("N8", T0, [["E23", [{ train: "087", eta: 3 }, { train: "076", eta: 5 }]]]),
    );
    expect(estimateTrains(doc, T0).map((t) => t.trainNo).sort()).toEqual(["076", "087"]);
  });

  it("draws a train once when it turns round at a terminus", () => {
    // Reaches N23 in 6 s and Khu Khot at 84 s, and is listed leaving
    // Khu Khot for Kheha in five.
    const doc = docOf(
      reading("N24", T0, [
        ["E23", [{ train: "046", eta: 5 }]],
        ["N24", [{ train: "046", eta: 1.4 }]],
      ]),
      reading("N23", T0, [["N24", [{ train: "046", eta: 0.1 }]]]),
    );
    const trains = estimateTrains(doc, T0 + 60_000);
    expect(trains).toHaveLength(1);
    expect(trains[0]).toMatchObject({ towardCode: "N24", fromCode: "N23", toCode: "N24", fraction: 0.5 });
  });

  it("shows a train waiting to leave its terminus once it is close", () => {
    const soon = docOf(reading("N24", T0, [["E23", [{ train: "094", eta: 2 }]]]));
    expect(estimateTrains(soon, T0)[0]).toMatchObject({ fromCode: "N24", toCode: "N24", fraction: 0 });
    const later = docOf(reading("N24", T0, [["E23", [{ train: "094", eta: 12 }]]]));
    expect(estimateTrains(later, T0)).toEqual([]);
  });

  it("handles the Silom line, which shares Siam with Sukhumvit", () => {
    const doc = docOf(
      reading("CEN", T0, [["S12", [{ train: "012", eta: 1 }]], ["N24", [{ train: "999", eta: 8 }]]]),
      reading("S1", T0, [["S12", [{ train: "012", eta: 3 }]]]),
    );
    const trains = estimateTrains(doc, T0 + 30_000);
    const silom = trains.find((t) => t.trainNo === "012");
    expect(silom).toMatchObject({ line: "silom", fromCode: "W1", toCode: "CEN" });
    // The Sukhumvit-bound train only has the one sighting, 8 minutes out, so it isn't placed.
    expect(trains.find((t) => t.trainNo === "999")).toBeUndefined();
  });

  it("skips platforms and stations it doesn't know", () => {
    const doc = docOf(
      reading("N9", T0, [["NOPE", [{ train: "001", eta: 1 }]]]),
      reading("ZZ", T0, [["E23", [{ train: "002", eta: 1 }]]]),
    );
    expect(estimateTrains(doc, T0)).toEqual([]);
  });
});
