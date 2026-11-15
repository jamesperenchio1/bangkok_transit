import type { LatLon } from "@/lib/line-geometry";
import type { RoutePart } from "@/lib/map-data";

/** Planar length of a [lat, lon] step, good enough at city scale for ordering a draw-in. */
function stepLength(a: LatLon, b: LatLon): number {
  const k = Math.cos(((a[0] + b[0]) / 2) * (Math.PI / 180));
  return Math.hypot(b[0] - a[0], (b[1] - a[1]) * k);
}

function partLength(points: LatLon[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += stepLength(points[i - 1], points[i]);
  return total;
}

/**
 * The route as drawn when `fraction` (0..1) of its total length is revealed,
 * origin first. Parts keep their order, so the line visibly travels leg by leg;
 * a part not reached yet comes back empty (callers skip those).
 */
export function revealParts(parts: RoutePart[], fraction: number): RoutePart[] {
  if (fraction >= 1) return parts;
  const lengths = parts.map((p) => partLength(p.points));
  let remaining = Math.max(0, fraction) * lengths.reduce((a, b) => a + b, 0);
  return parts.map((part, i) => {
    if (remaining <= 0) return { ...part, points: [] };
    if (remaining >= lengths[i]) {
      remaining -= lengths[i];
      return part;
    }
    const out: LatLon[] = [part.points[0]];
    let left = remaining;
    remaining = 0;
    for (let j = 1; j < part.points.length; j++) {
      const len = stepLength(part.points[j - 1], part.points[j]);
      if (len >= left) {
        const f = len === 0 ? 0 : left / len;
        const [a, b] = [part.points[j - 1], part.points[j]];
        out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
        break;
      }
      left -= len;
      out.push(part.points[j]);
    }
    return { ...part, points: out };
  });
}
