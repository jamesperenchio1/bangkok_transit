import { describe, expect, it } from "vitest";
import faresJson from "@/data/fares.json";
import redOracle from "@/data/fare-oracle/srt-red-adult.json";
import { pairKey, type FareData } from "@/lib/fares";

const data = faresJson as unknown as FareData;

/**
 * Operator tables copied as published (data/fare-oracle/), compared with the
 * fares the app uses. Where the operator publishes a readable table, this is
 * the independent check; where it does not (see docs/operations.md, "Fare
 * audit"), the gap is named there rather than hidden.
 */
describe("fares against the operator's own tables", () => {
  it("SRT Red Line: every pair of the 13-station adult matrix matches srtet.co.th", () => {
    const { stations: ids, adult } = redOracle;
    const table = data.systems.srtRed.pairs!;
    let checked = 0;
    ids.forEach((a, i) =>
      ids.forEach((b, j) => {
        if (i >= j) return;
        expect(adult[i][j], `${a}|${b} symmetric`).toBe(adult[j][i]);
        expect(table[pairKey(a, b)], `${a} -> ${b}`).toBe(adult[i][j]);
        checked++;
      }),
    );
    expect(checked).toBe(78);
    expect(Object.keys(table)).toHaveLength(78);
  });
});
