import sequences from "@/data/line-sequences.json";
import { stationsByCode } from "@/data/stations";

export type LatLon = [number, number];
export type LineSegments = Record<string, LatLon[][]>;

// Fetched as a plain static file (public/line-geometry.json, built by
// scripts/build-line-geometry.ts) rather than a static TS import, so its
// ~37KB gzip downloads in parallel with the map's own JS/style/tile
// requests instead of being serialized into that chunk's own parse. Cached
// at module scope so every caller (the map's initial line layer, and the
// route-highlight effect on every path change) shares one request.
let cachedPromise: Promise<LineSegments> | null = null;
// The same data, readable synchronously once it has arrived: the map asks
// this before drawing so it can skip the straight-line stand-in entirely.
let loaded: LineSegments | null = null;

export function fetchLineGeometry(): Promise<LineSegments> {
  if (!cachedPromise) {
    cachedPromise = fetch("/line-geometry.json")
      .then((res) => {
        if (!res.ok) throw new Error(`line-geometry.json: HTTP ${res.status}`);
        return res.json() as Promise<LineSegments>;
      })
      .then((segments) => {
        loaded = segments;
        return segments;
      })
      .catch((err: unknown) => {
        // Don't cache a failure (a flaky connection on first load): the
        // next caller retries. Until then lines fall back to straight hops.
        cachedPromise = null;
        console.warn("line geometry unavailable", err);
        return {};
      });
  }
  return cachedPromise;
}

/** The curved track if it has already arrived, else null. Never starts a request. */
export function loadedLineGeometry(): LineSegments | null {
  return loaded;
}

/**
 * Straight station-to-station track for every line, built from data that is
 * already in the bundle (the stations and `line-sequences.json`). It is the
 * map's stand-in until the curved track arrives, so the network is drawn -
 * and connected end to end - from the first frame, whatever the connection
 * does to the geometry download. By construction it passes through every
 * station of every service segment, in order.
 */
export function stationLineSegments(): LineSegments {
  const out: LineSegments = {};
  for (const [line, segments] of Object.entries(sequences as Record<string, string[][]>)) {
    out[line] = segments.map((codes) =>
      codes.flatMap((code) => {
        const s = stationsByCode.get(code);
        return s ? [[s.lat, s.lon] as LatLon] : [];
      }),
    );
  }
  return out;
}

/** Waits before each retry of a failed download; after the last one the stand-in stays. */
export const GEOMETRY_RETRY_DELAYS_MS = [1_000, 3_000, 8_000, 20_000];

/**
 * Fetches the curved track in the background and hands it to `onLoaded`,
 * retrying a few times with growing pauses. A single failed request on a bad
 * connection used to leave the map with stations and no lines until the next
 * reload; now the straight stand-in stays up and the curves swap in as soon as
 * any attempt succeeds. Returns a function that stops it (the map was torn down).
 */
export function loadLineGeometryInBackground(onLoaded: (segments: LineSegments) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const attempt = (n: number) => {
    void fetchLineGeometry().then((segments) => {
      if (stopped) return;
      if (Object.keys(segments).length > 0) {
        onLoaded(segments);
      } else if (n < GEOMETRY_RETRY_DELAYS_MS.length) {
        timer = setTimeout(() => attempt(n + 1), GEOMETRY_RETRY_DELAYS_MS[n]);
      }
    });
  };
  attempt(0);
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
  };
}

export function haversineMeters(a: LatLon, b: LatLon): number {
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
 * BMA's GIS track geometry (public/line-geometry.json) rather than a
 * straight line between the two station points - the actual track curves
 * along roads and rivers between stops, and drawing it as a straight chord
 * cuts across the map in a way that doesn't match anything on the ground.
 *
 * Falls back to a straight line if the line has no geometry, or if the two
 * stations don't land close enough to the same source segment (the GIS data
 * ships each line as a handful of independently-drawn segments - usually
 * everything a route needs is on one of them, but there's no guarantee).
 */
export function trackBetween(
  segmentsByLine: LineSegments,
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

export function fullLineSegments(segmentsByLine: LineSegments, lineKey: string): LatLon[][] {
  return segmentsByLine[lineKey] ?? [];
}
