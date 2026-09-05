import lineGeometry from "@/data/line-geometry.json";

type LatLon = [number, number];

const segmentsByLine = lineGeometry as unknown as Record<string, LatLon[][]>;

function haversineMeters(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestIndex(segment: LatLon[], point: LatLon): { index: number; distance: number } {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < segment.length; i++) {
    const d = haversineMeters(segment[i], point);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return { index: best, distance: bestDist };
}

const SNAP_THRESHOLD_METERS = 600;

/**
 * The real curved track between two adjacent stops on one line, taken from
 * BMA's GIS track geometry (data/line-geometry.json) rather than a straight
 * line between the two station points - the actual track curves along roads
 * and rivers between stops, and drawing it as a straight chord cuts across
 * the map in a way that doesn't match anything on the ground.
 *
 * Falls back to a straight line if the line has no geometry, or if the two
 * stations don't land close enough to the same source segment (the GIS data
 * ships each line as a handful of independently-drawn segments - usually
 * everything a route needs is on one of them, but there's no guarantee).
 */
export function trackBetween(
  lineKey: string,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): LatLon[] {
  const fromPoint: LatLon = [from.lat, from.lon];
  const toPoint: LatLon = [to.lat, to.lon];
  const fallback: LatLon[] = [fromPoint, toPoint];

  const segments = segmentsByLine[lineKey];
  if (!segments) return fallback;

  let best: { segIdx: number; fromIdx: number; toIdx: number; cost: number } | null = null;
  segments.forEach((segment, segIdx) => {
    const nearFrom = nearestIndex(segment, fromPoint);
    const nearTo = nearestIndex(segment, toPoint);
    if (nearFrom.distance > SNAP_THRESHOLD_METERS || nearTo.distance > SNAP_THRESHOLD_METERS) {
      return;
    }
    const cost = nearFrom.distance + nearTo.distance;
    if (!best || cost < best.cost) {
      best = { segIdx, fromIdx: nearFrom.index, toIdx: nearTo.index, cost };
    }
  });

  if (!best) return fallback;

  const { segIdx, fromIdx, toIdx } = best as { segIdx: number; fromIdx: number; toIdx: number };
  const segment = segments[segIdx];
  const [start, end] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
  let slice = segment.slice(start, end + 1);
  if (fromIdx > toIdx) slice = slice.slice().reverse();

  // Snap the ends to the exact station coordinates so the curve visually
  // meets the marker instead of stopping a little short of it.
  return [fromPoint, ...slice.slice(1, -1), toPoint];
}

export function fullLineSegments(lineKey: string): LatLon[][] {
  return segmentsByLine[lineKey] ?? [];
}
