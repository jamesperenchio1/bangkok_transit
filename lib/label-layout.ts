/**
 * Label collision for the Google map, with the same rules MapLibre applies to
 * the station-label layer: labels are placed in sort-key order, each tries its
 * anchors in turn (right of the dot, left, above, below), and a label that
 * would overlap one already placed is hidden. Pure geometry on screen pixels,
 * so it is the same at every zoom and unit-testable.
 */

export type LabelAnchor = "right" | "left" | "top" | "bottom";

export const LABEL_ANCHORS: readonly LabelAnchor[] = ["right", "left", "top", "bottom"];

export interface LabelCandidate {
  id: string;
  /** Where the station dot is, in px (any consistent origin). */
  x: number;
  y: number;
  /** Size of the label's text box in px. */
  w: number;
  h: number;
  /** Lower is placed first and so wins a collision. */
  sortKey: number;
  /** Dot radius in px: how far the label sits from the dot's centre. */
  radius: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Gap between the dot's edge and its label, in px. */
const GAP = 4;

function rectFor(c: LabelCandidate, anchor: LabelAnchor, pad: number): Rect {
  const d = c.radius + GAP;
  let x0: number;
  let y0: number;
  switch (anchor) {
    case "right":
      x0 = c.x + d;
      y0 = c.y - c.h / 2;
      break;
    case "left":
      x0 = c.x - d - c.w;
      y0 = c.y - c.h / 2;
      break;
    case "top":
      x0 = c.x - c.w / 2;
      y0 = c.y - d - c.h;
      break;
    default:
      x0 = c.x - c.w / 2;
      y0 = c.y + d;
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x0 + c.w + pad, y1: y0 + c.h + pad };
}

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

export interface LayoutOptions {
  padding?: number;
  /** Anchors to try, in order. Defaults to right, left, top, bottom. */
  anchors?: readonly LabelAnchor[];
  /** Boxes already taken (another layer's labels, placed first): nothing may overlap them. */
  obstacles?: readonly Rect[];
}

export interface LayoutResult {
  anchors: Map<string, LabelAnchor>;
  /** The box each placed label occupies, for use as `obstacles` by a layer placed after it. */
  rects: Rect[];
}

/**
 * The anchor each label ends up with; a label that is hidden has no entry.
 * Ties on `sortKey` keep input order, so the result is stable.
 */
export function layoutLabels(candidates: readonly LabelCandidate[], options: LayoutOptions = {}): LayoutResult {
  const { padding = 2, anchors: tryAnchors = LABEL_ANCHORS, obstacles = [] } = options;
  const order = candidates.map((c, i) => ({ c, i })).sort((a, b) => a.c.sortKey - b.c.sortKey || a.i - b.i);
  const placed: Rect[] = [...obstacles];
  const rects: Rect[] = [];
  const anchors = new Map<string, LabelAnchor>();
  for (const { c } of order) {
    for (const anchor of tryAnchors) {
      const rect = rectFor(c, anchor, padding);
      if (placed.some((p) => overlaps(p, rect))) continue;
      placed.push(rect);
      rects.push(rect);
      anchors.set(c.id, anchor);
      break;
    }
  }
  return { anchors, rects };
}

/** MapLibre's station-label size by zoom: 10 px at z11, 12 at z14, 14 at z16 (MapLibre scale). */
export function labelFontSize(zoom: number): number {
  if (zoom <= 11) return 10;
  if (zoom <= 14) return 10 + ((zoom - 11) * 2) / 3;
  if (zoom <= 16) return 12 + zoom - 14;
  return 14;
}
