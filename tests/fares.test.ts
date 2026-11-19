import { describe, expect, it } from "vitest";
import faresJson from "@/data/fares.json";
import { stations } from "@/data/stations";
import rulesJson from "@/data/fare-rules.json";
import { computeFare, fareFor, pairKey, ruleActive, type FareData, type FareRule } from "@/lib/fares";
import { findPath } from "@/lib/transit-graph";

const rules = rulesJson.rules as FareRule[];
const data = { ...(faresJson as unknown as FareData), rules };
/** A fixed day so a rule that expires cannot change what these tests expect. */
const DAY = new Date("2026-11-13T05:00:00Z");
const fareAt = (p: ReturnType<typeof findPath>, d: FareData | null, now: Date = DAY) => computeFare(p, d, now);
const path = (a: string, b: string) => {
  const p = findPath(a, b);
  if (!p) throw new Error(`no route ${a}-${b}`);
  return p;
};
const codes = new Set(stations.map((s) => s.code));

describe("fare data", () => {
  it("has every system and only real lines and stations", () => {
    expect(Object.keys(data.systems).sort()).toEqual(["arl", "blue", "bts", "pink", "purple", "srtRed", "yellow"]);
    const lines = new Set(stations.flatMap((s) => s.lines.map((l) => l.line)));
    for (const sys of Object.values(data.systems)) {
      for (const l of sys.lines) expect(lines.has(l)).toBe(true);
      for (const k of Object.keys(sys.pairs ?? {})) {
        const [a, b] = k.split("|");
        expect(codes.has(a) && codes.has(b) && a < b).toBe(true);
      }
    }
  });

  it("keeps fares plausible", () => {
    for (const sys of Object.values(data.systems)) {
      for (const f of [...Object.values(sys.pairs ?? {}), ...(sys.stopFares ?? [])]) {
        expect(f).toBeGreaterThanOrEqual(10);
        expect(f).toBeLessThanOrEqual(100);
      }
    }
  });

  it("prices (nearly) every station pair on each line", () => {
    // The Gold Line is priced only within itself.
    for (const key of ["arl", "srtRed", "purple", "yellow", "pink"]) {
      const sys = data.systems[key];
      const n = new Set(Object.keys(sys.pairs!).flatMap((k) => k.split("|"))).size;
      expect(Object.keys(sys.pairs!).length).toBe((n * (n - 1)) / 2);
    }
  });

  it("Gold Line is a flat 17 baht (Krungthep Thanakom, from 1 January 2026)", () => {
    const gold = Object.entries(data.systems.bts.pairs!).filter(([k]) => k.split("|").every((c) => c.startsWith("G")));
    expect(gold.length).toBe(3);
    for (const [, fare] of gold) expect(fare).toBe(17);
  });

  it("Blue Line is the July 2026 table: 17-44 by stations, capped", () => {
    const blue = data.systems.blue;
    expect(blue.stopFares).toEqual([17, 20, 22, 25, 27, 29, 32, 34, 37, 39, 42, 44]);
    expect(fareFor(blue, "BL01", "BL02", 1)).toBe(17);
    expect(fareFor(blue, "BL01", "BL30", 30)).toBe(44);
    expect(fareFor(blue, "BL01", "BL01", 0)).toBeNull();
  });
});

describe("computeFare", () => {
  it("prices a BTS ride between two stations", () => {
    const fare = fareAt(path("CEN", "E1"), data)!;
    expect(fare.complete).toBe(true);
    expect(fare.segments).toHaveLength(1);
    expect(fare.total).toBe(data.systems.bts.pairs![pairKey("CEN", "E1")]);
  });

  it("treats a through-ride from Sukhumvit onto Silom at Siam as one BTS fare", () => {
    const fare = fareAt(path("N2", "S6"), data)!;
    expect(fare.segments.map((s) => s.system)).toEqual(["bts"]);
    expect(fare.total).toBe(data.systems.bts.pairs![pairKey("N2", "S6")]);
  });

  it("is symmetric", () => {
    expect(fareAt(path("E4", "N8"), data)!.total).toBe(fareAt(path("N8", "E4"), data)!.total);
  });

  it("charges each system on a trip that changes operator, and sums them", () => {
    const fare = fareAt(path("N9", "BL10"), data)!; // BTS, walk to MRT Blue
    expect(fare.segments.map((s) => s.system)).toEqual(["bts", "blue"]);
    expect(fare.complete).toBe(true);
    expect(fare.total).toBe(fare.segments[0].fare! + fare.segments[1].fare!);
  });

  it("prices the other systems", () => {
    for (const [a, b, system] of [
      ["A01", "A08", "arl"],
      ["PP01", "PP05", "purple"],
      ["YL01", "YL10", "yellow"],
      ["PK01", "PK10", "pink"],
      ["RD03", "RD13", "srtRed"],
    ] as const) {
      const fare = fareAt(path(a, b), data)!;
      expect(fare.segments[0].system).toBe(system);
      expect(fare.complete).toBe(true);
      expect(fare.total).toBeGreaterThan(0);
    }
  });

  describe("transfer discounts riders reported missing", () => {
    it("charges one entry fee on Blue <-> Purple at Tao Poon: Bang Sue -> Wong Sawang is 23, not 40", () => {
      const fare = fareAt(path("BL30", "PP14"), data)!;
      expect(fare.segments.map((s) => s.system)).toEqual(["blue", "purple"]);
      expect(fare.segments.map((s) => s.discount)).toEqual([0, 14]);
      expect(fare.total).toBe(23);
      expect(fare.discount).toBe(14);
      expect(fareAt(path("PP14", "BL30"), data)!.total).toBe(23);
    });

    it("takes 15 baht off the Yellow ride after Blue at Lat Phrao, same EMV card", () => {
      const fare = fareAt(path("BL25", "YL02"), data)!; // Ratchadaphisek -> Lat Phrao, walk, Ladprao -> Phawana
      expect(fare.segments.map((s) => s.system)).toEqual(["blue", "yellow"]);
      const yellow = data.systems.yellow.pairs!["YL01|YL02"];
      expect(fare.segments[1]).toMatchObject({ discount: 15, fare: yellow - 15 });
      expect(fare.total).toBe(fare.segments[0].fare! + yellow - 15);
    });

    it("gives no discount the other way round, or at an unrelated change", () => {
      expect(fareAt(path("YL02", "BL25"), data)!.discount).toBe(0);
      // BTS -> Blue is a different operator and pays both entry fees.
      expect(fareAt(path("N9", "BL10"), data)!.discount).toBe(0);
    });

    it("never takes a fare below zero or discounts one it could not price", () => {
      const cheap: FareData = {
        ...data,
        systems: { ...data.systems, yellow: { ...data.systems.yellow, pairs: { "YL01|YL02": 9 } } },
      };
      expect(fareAt(path("BL25", "YL02"), cheap)!.segments[1].fare).toBe(0);
      const unpriced: FareData = { ...data, systems: { ...data.systems, yellow: { ...data.systems.yellow, pairs: {} } } };
      const fare = fareAt(path("BL25", "YL02"), unpriced)!;
      expect(fare.segments[1]).toMatchObject({ fare: null, discount: 0 });
    });
  });

  describe("Purple <-> Pink at Nonthaburi Civic Center", () => {
    it("takes 15 baht off the Pink ride after Purple, same EMV card within 30 minutes (nbm.co.th)", () => {
      const fare = fareAt(path("PP10", "PK02"), data)!; // Purple to PP11, change to Pink PK01, ride on
      expect(fare.segments.map((s) => s.system)).toEqual(["purple", "pink"]);
      const pink = data.systems.pink.pairs![pairKey("PK01", "PK02")];
      expect(fare.segments[1]).toMatchObject({ discount: 15, fare: Math.max(pink - 15, 0) });
      expect(fare.applied.map((r) => r.id)).toEqual(["purple-to-pink-nonthaburi-civic-center"]);
      expect(fare.applied[0].message.en).toContain("same contactless (EMV) card");
    });

    it("does not discount the reverse direction, which no operator page documents", () => {
      const fare = fareAt(path("PK02", "PP10"), data)!;
      expect(fare.segments.map((s) => s.system)).toEqual(["pink", "purple"]);
      expect(fare.discount).toBe(0);
    });
  });

  describe("Purple + Red 40 baht day cap, a policy with an end date", () => {
    const redOnly = () => path("RD03", "RD13"); // Taling Chan -> Rangsit, 42 on the table
    it("caps a ride at 40 until 30 Nov 2026 and charges the table fare after", () => {
      expect(data.systems.srtRed.pairs![pairKey("RD03", "RD13")]).toBe(42);
      const during = fareAt(redOnly(), data, new Date("2026-11-30T16:59:00Z"))!; // 23:59 Bangkok on the last day
      expect(during.total).toBe(40);
      expect(during.discount).toBe(2);
      expect(during.applied.map((r) => r.id)).toEqual(["red-purple-day-cap"]);
      const after = fareAt(redOnly(), data, new Date("2026-11-30T17:00:00Z"))!; // 00:00 on 1 Dec
      expect(after.total).toBe(42);
      expect(after.applied).toEqual([]);
    });

    it("applies across a Purple + Red trip, taking the saving off the later ride, and never below the cap", () => {
      const p = path("PP14", "RD05");
      const during = fareAt(p, data)!;
      const after = fareAt(p, data, new Date("2027-02-01T05:00:00Z"))!;
      expect(during.segments.map((s) => s.system)).toEqual(["purple", "srtRed"]);
      expect(during.total).toBe(Math.min(after.total + after.discount, 40));
    });

    it("leaves cheap rides alone and never caps when a ride cannot be priced", () => {
      const cheap = fareAt(path("RD05", "RD06"), data)!;
      expect(cheap.applied).toEqual([]);
      const noRed: FareData = { ...data, systems: { ...data.systems, srtRed: { ...data.systems.srtRed, pairs: {} } } };
      expect(fareAt(redOnly(), noRed)!.discount).toBe(0);
    });
  });

  describe("fare rules", () => {
    const byId = new Map(rules.map((r) => [r.id, r]));
    const interchangeIds = new Set(stations.filter((s) => s.lines.length > 1).map((s) => s.code));

    it("names a source and both languages, with the amount in the wording", () => {
      for (const r of rules) {
        expect(r.source.length, r.id).toBeGreaterThan(30);
        expect(r.message.en, r.id).toContain("{amount}");
        expect(r.message.th, r.id).toContain("{amount}");
        expect(r.message.th, r.id).toMatch(/[฀-๿]/);
      }
    });

    it("only points at real stations and systems, in the right place", () => {
      for (const r of rules) {
        for (const sys of [r.from, r.to, ...(r.systems ?? [])]) if (sys) expect(Object.keys(data.systems), r.id).toContain(sys);
        for (const code of [r.fromStation, r.toStation]) if (code) expect(codes.has(code), `${r.id} ${code}`).toBe(true);
        if (r.kind === "refund") expect(r.fromStation && r.toStation, r.id).toBeTruthy();
      }
      // The Tao Poon change is one station on both lines.
      expect(interchangeIds.has("BL31")).toBe(true);
    });

    it("applies only rules a rider's operator documents; policy that is not in force stays off", () => {
      expect(byId.get("joint-ticket-2027")!.enabled).toBe(false);
      expect(byId.get("pink-to-purple-nonthaburi-civic-center")!.enabled).toBe(false);
      // Even on a day inside its window the joint ticket changes nothing.
      const fare = fareAt(path("BL30", "PP14"), data, new Date("2027-03-01T05:00:00Z"))!;
      expect(fare.applied.map((r) => r.id)).not.toContain("joint-ticket-2027");
      for (const r of rules.filter((x) => x.enabled)) expect(r.confidence === "confirmed" || r.confidence === "reported").toBe(true);
    });

    it("dates are Bangkok dates: a rule ends at midnight in Bangkok, not UTC", () => {
      const cap = byId.get("red-purple-day-cap")!;
      expect(ruleActive(cap, new Date("2026-11-30T16:59:59Z"))).toBe(true);
      expect(ruleActive(cap, new Date("2026-11-30T17:00:00Z"))).toBe(false);
      expect(ruleActive(cap, new Date("2025-11-30T16:59:59Z"))).toBe(false);
      expect(ruleActive(cap, new Date("2025-11-30T17:00:00Z"))).toBe(true);
    });
  });

  it("is honest, never NaN, when a fare is missing", () => {
    const partial: FareData = { ...data, systems: { ...data.systems, bts: { ...data.systems.bts, pairs: {} } } };
    const fare = fareAt(path("CEN", "E1"), partial)!;
    expect(fare.complete).toBe(false);
    expect(fare.total).toBe(0);
    expect(Number.isNaN(fare.total)).toBe(false);
  });

  it("returns null with no route, no data, or only a walk", () => {
    expect(fareAt(null, data)).toBeNull();
    expect(fareAt(path("CEN", "E1"), null)).toBeNull();
    expect(fareAt(path("N8", "BL28"), data)).toBeNull(); // Mo Chit -> Chatuchak Park is a walk
  });
});
