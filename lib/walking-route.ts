import { googleMapsKey } from "@/lib/google-maps";

/**
 * Real walking geometry for the last leg, from Google's Routes API.
 *
 * This is the one place the default (MapLibre) app talks to Google without
 * the rider opting into the Google map. It is deliberate and bounded: only
 * when a place is chosen as the destination, one request per origin/place
 * pair, cached on the device, and only when a browser key exists. Google's
 * terms allow caching Routes results for up to 30 days; a week keeps a
 * re-planned trip fresh while still making repeat visits free. If the key,
 * the network, the API or the quota is missing, the caller keeps the
 * straight-line estimate, so the app never depends on it.
 */
export interface WalkingRoute {
  /** [lat, lon], matching the app's geometry helpers. */
  path: [number, number][];
  meters: number;
  minutes: number;
}

const ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";
const CACHE_PREFIX = "bts:walk:v1:";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FIELD_MASK = "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline";

interface Cached {
  saved: number;
  route: WalkingRoute;
}

interface RoutesResponse {
  routes?: {
    distanceMeters?: number;
    duration?: string;
    polyline?: { encodedPolyline?: string };
  }[];
}

function cacheKey(from: { lat: number; lon: number }, to: { lat: number; lon: number }): string {
  // Five decimals is about a metre: precise enough for a door, and stable
  // enough that the same place tapped twice hits the same entry.
  return `${CACHE_PREFIX}${from.lat.toFixed(5)},${from.lon.toFixed(5)}>${to.lat.toFixed(5)},${to.lon.toFixed(5)}`;
}

function readCache(key: string): WalkingRoute | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Cached;
    if (!cached?.route?.path?.length || Date.now() - cached.saved > CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return cached.route;
  } catch {
    return null;
  }
}

function writeCache(key: string, route: WalkingRoute): void {
  try {
    localStorage.setItem(key, JSON.stringify({ saved: Date.now(), route } satisfies Cached));
  } catch {
    // Storage full or blocked (private mode): the next visit just re-requests.
  }
}

/**
 * Google's encoded polyline, decoded to [lat, lon]. The algorithm is the
 * documented one; keeping it here avoids pulling in a package for ~30 lines.
 */
export function decodePolyline(encoded: string): [number, number][] {
  const path: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    path.push([lat / 1e5, lon / 1e5]);
  }

  return path;
}

/**
 * Returns null when a real route cannot be drawn right now: no key, offline,
 * API disabled, quota exceeded, bad response. Callers must keep the
 * straight-line fallback, never block the trip on this.
 */
export async function walkingRoute(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  signal?: AbortSignal,
): Promise<WalkingRoute | null> {
  const key = cacheKey(from, to);
  const cached = readCache(key);
  if (cached) return cached;

  const apiKey = googleMapsKey();
  if (!apiKey || typeof navigator === "undefined" || !navigator.onLine) return null;

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lon } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lon } } },
        travelMode: "WALK",
        computeAlternativeRoutes: false,
        languageCode: "en",
        units: "METRIC",
      }),
      signal,
    });
    if (!response.ok) return null;

    const data = (await response.json()) as RoutesResponse;
    const route = data.routes?.[0];
    const encoded = route?.polyline?.encodedPolyline;
    if (!encoded) return null;

    const path = decodePolyline(encoded);
    if (path.length < 2) return null;

    const meters = route.distanceMeters ?? 0;
    const seconds = Number((route.duration ?? "").replace(/s$/, ""));
    const minutes = Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : Math.max(1, meters / 80);
    const result: WalkingRoute = { path, meters: Math.round(meters), minutes };
    writeCache(key, result);
    return result;
  } catch {
    return null;
  }
}
