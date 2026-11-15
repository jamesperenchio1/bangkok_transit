import { describe, expect, it } from "vitest";
import { panToReveal } from "@/lib/map-data";

const size = { width: 800, height: 600 };

describe("panToReveal", () => {
  it("does nothing when the station and its card already fit", () => {
    expect(panToReveal({ x: 400, y: 400 }, size)).toBeNull();
  });
  it("pans down when the card would run off the top", () => {
    const move = panToReveal({ x: 400, y: 100 }, size);
    expect(move?.dx).toBe(0);
    expect(move?.dy).toBeLessThan(0);
  });
  it("pans sideways near an edge, and centres in a window too small for the card", () => {
    expect(panToReveal({ x: 20, y: 400 }, size)?.dx).toBeLessThan(0);
    expect(panToReveal({ x: 100, y: 300 }, { width: 300, height: 300 })).not.toBeNull();
  });
});

import { focusPadding, FOCUS_PADDING } from "@/lib/map-data";

describe("focusPadding", () => {
  it("is the plain card padding with no sheet", () => {
    expect(focusPadding(false, 800, 800, 800)).toEqual({ ...FOCUS_PADDING });
  });
  it("grows the bottom by what the sheet covers, but never pads the map away", () => {
    const open = focusPadding(true, 800, 800, 800);
    expect(open.bottom).toBeGreaterThan(FOCUS_PADDING.bottom);
    const tiny = focusPadding(true, 400, 400, 400);
    expect(tiny.top + tiny.bottom).toBeLessThanOrEqual(400 - 140);
  });
});
