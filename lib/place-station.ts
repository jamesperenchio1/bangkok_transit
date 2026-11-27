import type { Station } from "@/data/stations";
import { nearestStations } from "@/lib/nearest-station";
import { findPath, walkEstimate, type PathOptions } from "@/lib/transit-graph";

/**
 * Which station to route a place through.
 *
 * The closest station is not always the quickest way there: a mall can sit
 * within a few metres of the boundary between two stations, and the further
 * one is sometimes a station closer to the origin, or on the same line, so the
 * trip ends with a shorter walk and no change. Comparing the nearest few by
 * "ride there + walk the rest" instead of by straight-line distance is the
 * difference between routing Siam and routing Chit Lom for Central World.
 */
export interface PlaceStation {
  station: Station;
  /** Straight-line metres from the station to the place. */
  meters: number;
  /** Minutes from `startCode` to the place through this station. */
  minutes: number;
}

/**
 * Minutes a different station must save before it wins over the nearest one.
 * Without it, two stations whose totals differ by seconds trade the place
 * between them, and the rider is sent 270 m further to save 20 seconds.
 */
const TIE_MINUTES = 1;

export function chooseStationForPlace(
  startCode: string | null,
  place: { lat: number; lon: number },
  options: PathOptions = {},
  candidates = 3,
): PlaceStation {
  const nearest = nearestStations(place.lat, place.lon, { limit: Math.max(1, candidates) });
  if (!startCode) {
    return { ...nearest[0], minutes: walkEstimate(nearest[0].meters, options.walkSpeed) };
  }

  let best: PlaceStation | null = null;
  for (const candidate of nearest) {
    const ride = findPath(startCode, candidate.station.code, options);
    if (!ride) continue;
    const minutes = ride.minutes + walkEstimate(candidate.meters, options.walkSpeed);
    if (!best || minutes < best.minutes - TIE_MINUTES) best = { ...candidate, minutes };
  }
  // No route to any of them (unconnected, or lines turned off for routes):
  // still show the nearest, which is what the card said before this existed.
  return best ?? { ...nearest[0], minutes: walkEstimate(nearest[0].meters, options.walkSpeed) };
}

/** The walk from the last station of a route to the place, for the map and the sheet. */
export interface FinalWalk {
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  meters: number;
  minutes: number;
  /** Road-following geometry when Google gave us one, as [lat, lon] pairs. */
  path?: [number, number][];
  /** The place's name, shown on the sheet's last line. */
  name: string;
}
