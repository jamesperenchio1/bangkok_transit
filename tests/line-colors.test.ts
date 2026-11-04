import { describe, expect, it } from "vitest";
import { contrastRatio, LINE_COLORS, readableTextColor } from "@/lib/line-colors";

describe("readableTextColor", () => {
  it("picks the better of white and near-black on every line colour, never below 4.3:1", () => {
    for (const [line, hex] of Object.entries(LINE_COLORS)) {
      const ratio = contrastRatio(hex, readableTextColor(hex));
      const best = Math.max(contrastRatio(hex, "#ffffff"), contrastRatio(hex, "#171717"));
      expect(ratio, `${line} ${hex}`).toBe(best);
      expect(ratio, `${line} ${hex}`).toBeGreaterThanOrEqual(4.3);
    }
  });

  it("documents the one line that cannot reach 4.5:1 with either colour: Silom green", () => {
    // Brand colour #008c44: white is 4.34:1, near-black 4.2:1. Passing AA for
    // small text would mean changing the badge background, not the text.
    expect(contrastRatio("#008c44", readableTextColor("#008c44"))).toBeLessThan(4.5);
  });

  it("uses dark text on BTS Sukhumvit green, which white text failed at 2.4:1", () => {
    expect(contrastRatio("#76b729", "#ffffff")).toBeLessThan(3);
    expect(readableTextColor("#76b729")).toBe("#171717");
  });

  it("still uses white on dark lines", () => {
    expect(readableTextColor("#1c3f94")).toBe("#ffffff");
  });
});
