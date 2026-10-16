import type { Station } from "@/data/stations";
import { haversineMeters } from "./line-geometry";
import type { PathResult } from "./transit-graph";

/**
 * "Tell me when my station is near" - the pure logic. Which stations on a
 * route should ring, and whether a GPS fix means the rider has reached one.
 * No timers, audio or browser APIs here, so it is easy to test; the hook in
 * use-stop-alert.ts wires it to the real world.
 */

export type StationsBefore = 0 | 1 | 2 | 3;

export interface AlertSettings {
  enabled: boolean;
  /** Ring this many stops before the destination (0 = only on arrival). The destination itself always rings. */
  stationsBefore: StationsBefore;
  sound: boolean;
  vibrate: boolean;
  /** Also ring at stations where the rider changes line. */
  atChanges: boolean;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: false,
  stationsBefore: 1,
  sound: true,
  vibrate: true,
  atChanges: false,
};

export type AlertKind = "approach" | "change" | "arrive";

export interface AlertTarget {
  /** Index into path.legs. */
  legIndex: number;
  station: Station;
  kind: AlertKind;
  /** Stops still to ride to the destination from here. */
  stopsLeft: number;
}

/** A fix within this many metres of a station counts as being at it... */
const MIN_RADIUS_M = 300;
/** ...widened to the fix's own error, up to this much. */
const MAX_RADIUS_M = 500;
/** A fix worse than this says too little about where the rider is to act on. */
const MAX_USABLE_ACCURACY_M = 1000;

/** The stations that should ring for this route, nearest the destination first. */
export function alertTargets(path: PathResult, settings: AlertSettings): AlertTarget[] {
  const { legs } = path;
  const last = legs.length - 1;
  if (last < 1) return [];
  const targets: AlertTarget[] = [{ legIndex: last, station: legs[last].station, kind: "arrive", stopsLeft: 0 }];

  // Counted in rode stops, so a walking transfer doesn't use up the heads-up.
  const stopsLeftAt = (index: number) => legs.slice(index + 1).filter((l) => l.mode === "ride").length;

  if (settings.stationsBefore > 0) {
    let index = last;
    let remaining: number = settings.stationsBefore;
    while (index > 0 && remaining > 0) {
      index -= 1;
      if (legs[index + 1].mode === "ride") remaining -= 1;
    }
    // Never at the boarding station: the rider is standing there already.
    if (index > 0 && index < last) {
      targets.push({ legIndex: index, station: legs[index].station, kind: "approach", stopsLeft: stopsLeftAt(index) });
    }
  }

  if (settings.atChanges) {
    for (let i = last - 1; i > 0; i--) {
      if (legs[i].isChange && !targets.some((t) => t.station.code === legs[i].station.code)) {
        targets.push({ legIndex: i, station: legs[i].station, kind: "change", stopsLeft: stopsLeftAt(i) });
      }
    }
  }
  return targets.sort((a, b) => b.legIndex - a.legIndex);
}

export interface Fix {
  lat: number;
  lon: number;
  accuracy: number;
}

/** The first not-yet-rung target the fix is at, preferring the one closest to the destination. */
export function dueTarget(targets: AlertTarget[], fix: Fix, rung: ReadonlySet<number>): AlertTarget | null {
  if (!Number.isFinite(fix.accuracy) || fix.accuracy > MAX_USABLE_ACCURACY_M) return null;
  const radius = Math.max(MIN_RADIUS_M, Math.min(fix.accuracy, MAX_RADIUS_M));
  for (const target of targets) {
    if (rung.has(target.legIndex)) continue;
    const { lat, lon } = target.station;
    if (haversineMeters([fix.lat, fix.lon], [lat, lon]) <= radius) return target;
  }
  return null;
}

/** Identifies a route, so a new one starts with nothing rung. */
export function routeKey(path: PathResult): string {
  return path.legs.map((l) => l.station.code).join(">");
}
