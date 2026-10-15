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
    expect(terminusInDirection("srtRed", "RD04", "RD01")).toBe("RD03");
    expect(terminusInDirection("srtRed", "RD04", "RD05")).toBe("RD13");
    expect(terminusInDirection("pink", "PK10", "MT01")).toBe("MT02");
    expect(terminusInDirection("pink", "PK10", "PK11")).toBe("PK30");
  });

  it("gives the Blue Line's real termini on both sides of Tha Phra", () => {
    expect(terminusInDirection("blue", "BL07", "BL09")).toBe("BL07"); // round the loop, back to Tha Phra
    expect(terminusInDirection("blue", "BL07", "BL06")).toBe("BL01"); // toward Lak Song
    expect(terminusInDirection("blue", "BL07", "BL08")).toBe("BL01"); // from upper platform: Charan 13 side
  });

  it("returns undefined for stations that aren't adjacent", () => {
    expect(terminusInDirection("sukhumvit", "N8", "N1")).toBeUndefined();
  });
});
