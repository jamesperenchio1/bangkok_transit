import { describe, expect, it } from "vitest";
import { allowedTypos, editDistance, rank, score } from "@/lib/fuzzy";
import { stations } from "@/data/stations";

const normalize = (t: string) => t.toLowerCase().replace(/[\s.\-]+/g, "");
const index = stations.map((s) => [normalize(s.nameEn), normalize(s.nameTh), normalize(s.code)]);
const find = (query: string, limit = 8) =>
  rank(normalize(query), index, limit).map((i) => stations[i].nameEn);

describe("score", () => {
  it("orders exact, prefix, contains, in-order letters, then typos", () => {
    expect(score("siam", "siam")).toBe(0);
    expect(score("sia", "siam")).toBe(1);
    expect(score("iam", "siam")).toBe(2);
    expect(score("chtchk", "chatuchak")).toBe(3);
    expect(score("siem", "siam")).toBe(5); // one wrong letter
    expect(score("zzzz", "siam")).toBeNull();
  });

  it("short queries must be exact-ish, or everything would match", () => {
    expect(allowedTypos(2)).toBe(0);
    expect(score("sx", "siam")).toBeNull();
    expect(allowedTypos(4)).toBe(1);
    expect(allowedTypos(8)).toBe(2);
  });

  it("editDistance counts one insertion, deletion or substitution as 1 and stops early", () => {
    expect(editDistance("kitten", "sitten", 2)).toBe(1);
    expect(editDistance("abc", "abcd", 2)).toBe(1);
    expect(editDistance("abc", "xyzxyz", 2)).toBe(Infinity);
  });
});

describe("rank over the real station list", () => {
  it("finds stations through typos", () => {
    expect(find("siem")).toContain("Siam");
    expect(find("chatchak")).toContain("Chatuchak");
    expect(find("phayathi")[0]).toBe("Phaya Thai");
    expect(find("asoak")).toContain("Asok");
    expect(find("victory monumnt")[0]).toBe("Victory Monument");
  });

  it("an exact match always beats a fuzzy one", () => {
    expect(find("siam")[0]).toBe("Siam");
    expect(find("chit lom")[0]).toBe("Chit Lom");
  });

  it("keeps the forgiving behaviour: case, spaces, dots, hyphens and codes", () => {
    expect(find("N 15")).toContain(stations.find((s) => s.code === "N15")!.nameEn);
    expect(find("SIAM")[0]).toBe("Siam");
  });

  it("works for Thai: a prefix and a missing character", () => {
    const thai = stations.find((s) => s.nameEn === "Siam")!.nameTh;
    expect(find(thai)[0]).toBe("Siam");
    expect(find(thai.slice(0, -1))).toContain("Siam");
  });

  it("returns nothing for nonsense, and respects the limit", () => {
    expect(find("qqqqqqqq")).toEqual([]);
    expect(find("a", 3).length).toBeLessThanOrEqual(3);
  });

  it("is fast enough to run on every keystroke", () => {
    const start = performance.now();
    for (let i = 0; i < 50; i++) rank("phayathi", index, 8);
    expect((performance.now() - start) / 50).toBeLessThan(5);
  });
});
