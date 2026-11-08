import { describe, expect, it } from "vitest";
import { findPath, terminusInDirection, type PathResult } from "@/lib/transit-graph";

const codes = (path: PathResult | null) => path?.legs.map((l) => l.station.code);
const changesAt = (path: PathResult | null) => path?.legs.filter((l) => l.isChange).map((l) => l.station.code);

describe("findPath", () => {
  it("rides a single line without changes", () => {
    const path = findPath("N8", "CEN");
    expect(codes(path)).toEqual(["N8", "N7", "N6", "N5", "N4", "N3", "N2", "N1", "CEN"]);
    expect(path).toMatchObject({ stops: 8, changes: 0, walkMeters: 0 });
    expect(path!.legs[0].boardToward?.code).toBe("E23");
  });

  it("starts with a walk when the start station isn't on the line you need", () => {
    // Mo Chit BTS -> Thailand Cultural Centre: walk to Chatuchak Park MRT, then ride.
    const path = findPath("N8", "BL22");
    expect(path!.legs[1]).toMatchObject({ mode: "walk", line: null });
    expect(path!.legs[1].station.nameEn).toBe("Chatuchak Park");
    expect(path!.legs[1].walkMeters).toBeGreaterThan(0);
    expect(path).toMatchObject({ changes: 0 });
    expect(path!.walkMeters).toBe(path!.legs[1].walkMeters);
  });

  it("counts a walking transfer between two rides as a change", () => {
    // Siam -> Lumphini: BTS to Sala Daeng, walk to Si Lom MRT, one stop on.
    const path = findPath("CEN", "BL16");
    expect(codes(path)).toEqual(["CEN", "S1", "S2", "BL15", "BL16"]);
    expect(path).toMatchObject({ stops: 3, changes: 1 });
    expect(changesAt(path)).toEqual(["S2"]);
    expect(path!.legs[3].boardToward).toBeDefined();
  });

  it("changes line inside a shared station without walking", () => {
    // National Stadium (Silom) -> Chit Lom (Sukhumvit): change at Siam.
    const path = findPath("W1", "E1");
    expect(codes(path)).toEqual(["W1", "CEN", "E1"]);
    expect(path).toMatchObject({ changes: 1, walkMeters: 0 });
    expect(changesAt(path)).toEqual(["CEN"]);
  });

  it("uses the Airport Rail Link where it's genuinely faster", () => {
    const path = findPath("N2", "A08");
    expect(path!.legs.at(-1)!.line).toBe("arl");
    expect(path!.legs.filter((l) => l.mode === "ride").every((l) => l.line === "arl")).toBe(true);
  });

  it("routes round the MRT Blue loop through Charan 13 to Tha Phra", () => {
    // Fai Chai -> Tha Phra is two stops via Charan 13, not a direct hop.
    expect(codes(findPath("BL38", "BL07"))).toEqual(["BL38", "BL08", "BL07"]);
    // Itsaraphap is adjacent to Tha Phra on the lower platform.
    expect(codes(findPath("BL09", "BL07"))).toEqual(["BL09", "BL07"]);
  });

  it("keeps the two SRT Red lines apart", () => {
    // Taling Chan (Light Red) -> Rangsit (Dark Red) goes through Krung Thep Aphiwat.
    const path = findPath("RD03", "RD13");
    expect(codes(path)).toContain("RD04");
    expect(codes(path)!.slice(0, 4)).toEqual(["RD03", "RD02", "RD01", "RD04"]);
  });

  it("reaches the Pink Line's Muang Thong Thani branch from PK10", () => {
    expect(codes(findPath("PK09", "MT02"))).toEqual(["PK09", "PK10", "MT01", "MT02"]);
  });

  it("estimates a plausible journey time", () => {
    const path = findPath("N24", "E23"); // the whole Sukhumvit line, ~1h40 in reality
    expect(path!.minutes).toBeGreaterThan(70);
    expect(path!.minutes).toBeLessThan(130);
  });

  it("takes ride times from the scheduled hop table where it has them", () => {
    // Feed: Silom end to end is ~30 min; the distance formula alone gives ~27.
    const silom = findPath("W1", "S12");
    expect(silom!.minutes).toBeGreaterThanOrEqual(30);
    expect(silom!.minutes).toBeLessThanOrEqual(32);
    // Feed: the Airport Rail Link takes ~35 min; the formula would say ~50.
    const arl = findPath("A01", "A08");
    expect(arl!.minutes).toBeGreaterThanOrEqual(35);
    expect(arl!.minutes).toBeLessThanOrEqual(38);
  });

  it("falls back to the distance formula for lines the feed can't time", () => {
    // Pink's feed times are placeholders (28 min for ~35 km), so the router
    // must not use them: a full-line ride stays well above that.
    expect(findPath("PK01", "PK30")!.minutes).toBeGreaterThan(50);
    // Yellow's are a flat 3 min a hop (72 min); the formula says ~60.
    expect(findPath("YL01", "YL23")!.minutes).toBeLessThan(70);
  });

  it("returns null for unknown or identical stations", () => {
    expect(findPath("N8", "N8")).toBeNull();
    expect(findPath("N8", "NOPE")).toBeNull();
    expect(findPath("NOPE", "N8")).toBeNull();
  });

  it("connects every station to every other", () => {
    const all = ["N24", "E23", "W1", "S12", "G3", "BL01", "BL38", "PP01", "YL12", "PK30", "MT02", "A08", "RD03", "RD13"];
    for (const a of all) for (const b of all) if (a !== b) expect(findPath(a, b), `${a}->${b}`).not.toBeNull();
  });
});

describe("terminusInDirection", () => {
  it("names each end of a simple line", () => {
    expect(terminusInDirection("sukhumvit", "N8", "N7")).toBe("E23");
    expect(terminusInDirection("sukhumvit", "N7", "N8")).toBe("N24");
  });

  it("follows the branch a hop is on", () => {
    expect(terminusInDirection("srtLightRed", "RD04", "RD01")).toBe("RD03");
    expect(terminusInDirection("srtDarkRed", "RD04", "RD05")).toBe("RD13");
    expect(terminusInDirection("pink", "PK10", "MT01")).toBe("MT02");
    expect(terminusInDirection("pink", "PK10", "PK11")).toBe("PK30");
  });

  it("ends every Blue Line direction at Lak Song, since a loop train carries on past Tha Phra", () => {
    expect(terminusInDirection("blue", "BL07", "BL09")).toBe("BL01"); // round the loop, then on to Lak Song
    expect(terminusInDirection("blue", "BL07", "BL06")).toBe("BL01"); // toward Lak Song
    expect(terminusInDirection("blue", "BL07", "BL08")).toBe("BL01"); // from upper platform: Charan 13 side
    expect(terminusInDirection("blue", "BL38", "BL08")).toBe("BL01"); // Fai Chai -> Charan 13 -> Tha Phra -> Lak Song
  });

  it("returns undefined for stations that aren't adjacent", () => {
    expect(terminusInDirection("sukhumvit", "N8", "N1")).toBeUndefined();
  });
});

// Regression tests for rider-reported errors: every one of these was wrong
// while the unit tests passed, because nothing asserted what a rider is shown.
describe("what the rider is told to board", () => {
  it("tells Tha Phra -> Fai Chai apart from the other platform: both end at Lak Song", () => {
    const toFaiChai = findPath("BL07", "BL38")!;
    expect(toFaiChai.legs[0].boardToward?.nameEn).toBe("Lak Song");
    expect(toFaiChai.legs[0].boardVia?.nameEn).toBe("Charan Sanitwong 13");
    const toItsaraphap = findPath("BL07", "BL09")!;
    expect(toItsaraphap.legs[0].boardToward?.nameEn).toBe("Lak Song");
    expect(toItsaraphap.legs[0].boardVia?.nameEn).toBe("Itsaraphap");
  });

  it("only adds a next stop where the terminus alone is ambiguous", () => {
    expect(findPath("N8", "CEN")!.legs[0].boardVia).toBeUndefined();
    expect(findPath("PK10", "MT01")!.legs[0].boardVia).toBeUndefined();
  });
});

describe("changes the rider has to make", () => {
  it("makes National Telecom -> Impact Muang Thong Thani a change at Muang Thong Thani", () => {
    // Same Pink Line, but the Impact spur is a separate train service.
    const path = findPath("PK13", "MT01")!;
    expect(codes(path)).toEqual(["PK13", "PK12", "PK11", "PK10", "MT01"]);
    expect(path.changes).toBe(1);
    expect(changesAt(path)).toEqual(["PK10"]);
    expect(path.legs[3].boardToward?.nameEn).toContain("Muang Thong Thani"); // MLake, the spur terminus
    expect(path.legs[3].line).toBe("pink");
  });

  it("does not add a change when staying on the Pink trunk past Muang Thong Thani", () => {
    expect(findPath("PK13", "PK09")!.changes).toBe(0);
  });

  it("changes between the two SRT Red lines at Krung Thep Aphiwat", () => {
    const path = findPath("RD03", "RD13")!;
    expect(path.changes).toBe(1);
    expect(changesAt(path)).toEqual(["RD04"]);
    expect(path.legs.find((l) => l.station.code === "RD13")!.line).toBe("srtDarkRed");
  });
});
