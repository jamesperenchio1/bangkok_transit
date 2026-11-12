import { describe, expect, it } from "vitest";
import { labelFontSize, layoutLabels, type LabelCandidate } from "@/lib/label-layout";

const cand = (id: string, x: number, y: number, sortKey = 3, w = 60, h = 14): LabelCandidate => ({
  id,
  x,
  y,
  w,
  h,
  sortKey,
  radius: 4,
});

describe("layoutLabels", () => {
  it("puts a lone label to the right of its dot", () => {
    expect(layoutLabels([cand("a", 100, 100)]).anchors.get("a")).toBe("right");
  });

  it("keeps both labels when the dots are far apart", () => {
    const { anchors } = layoutLabels([cand("a", 0, 0), cand("b", 300, 0)]);
    expect([...anchors.keys()].sort()).toEqual(["a", "b"]);
  });

  it("lets the lower sort keys win when not everything fits", () => {
    const crowded = layoutLabels([
      cand("a", 100, 100, 0),
      cand("b", 104, 100, 1),
      cand("c", 96, 100, 2),
      cand("d", 100, 96, 3),
      cand("e", 100, 104, 4),
      cand("f", 102, 102, 5),
    ]).anchors;
    expect(crowded.has("a")).toBe(true);
    // Not everything fits in a few pixels: the highest sort keys are the ones left out.
    expect(crowded.size).toBeLessThan(6);
    expect(crowded.has("f")).toBe(false);
  });

  it("tries the next anchor when the first is taken", () => {
    // "b" sits where "a"'s right-hand label would go, so "a" falls back to the left.
    const { anchors } = layoutLabels([cand("a", 100, 100, 0), cand("b", 120, 100, 1, 10, 10)]);
    expect(anchors.get("a")).toBe("right");
    expect(anchors.get("b")).not.toBe("left");
    const moved = layoutLabels([cand("b", 112, 100, 0, 200, 14), cand("a", 100, 100, 1)]).anchors;
    expect(moved.get("a")).not.toBe("right");
  });

  it("is stable: equal sort keys keep input order", () => {
    const items = [cand("a", 50, 50, 1), cand("b", 52, 50, 1), cand("c", 54, 50, 1)];
    const first = [...layoutLabels(items).anchors];
    const again = [...layoutLabels(items).anchors];
    expect(first).toEqual(again);
    expect(first[0][0]).toBe("a");
  });

  it("respects boxes another layer already took, and only the anchors asked for", () => {
    const base = layoutLabels([cand("a", 100, 100)]);
    // A train further down: its label's only allowed spot (below it) is clear of the station name.
    const { anchors } = layoutLabels([cand("t", 100, 140)], { anchors: ["bottom"], obstacles: base.rects });
    expect(anchors.get("t")).toBe("bottom");
    // Right under the station name, the same spot is taken, and the train's label is left off.
    expect(layoutLabels([cand("t", 100, 100)], { anchors: ["bottom"], obstacles: base.rects }).anchors.size).toBe(0);
    const blocked = layoutLabels([cand("t", 100, 100)], {
      anchors: ["bottom"],
      obstacles: [{ x0: 0, y0: 0, x1: 500, y1: 500 }],
    });
    expect(blocked.anchors.size).toBe(0);
  });
});

describe("labelFontSize", () => {
  it("follows MapLibre's 10 / 12 / 14 px at zoom 11 / 14 / 16", () => {
    expect(labelFontSize(8)).toBe(10);
    expect(labelFontSize(11)).toBe(10);
    expect(labelFontSize(14)).toBe(12);
    expect(labelFontSize(16)).toBe(14);
    expect(labelFontSize(20)).toBe(14);
    expect(labelFontSize(12.5)).toBeGreaterThan(10);
    expect(labelFontSize(12.5)).toBeLessThan(12);
  });
});
