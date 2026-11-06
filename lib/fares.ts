import type { LineKey } from "@/data/stations";
import type { PathResult } from "@/lib/transit-graph";

/**
 * Fares are static data (data/fares.json, refreshed monthly by CI from the
 * operators' published tables, see scripts/scrape-fares.ts) computed in the
 * browser from a found route - nothing here touches a server. Each fare system
 * charges separately: a change of system, or a walk, starts a new fare, with no
 * through-ticket assumed. This module takes the data as an argument and imports
 * none, so the (large) JSON loads lazily - see lib/use-fares.ts.
 */

export interface FareSystem {
  name: string;
  nameTh: string;
  /** Lines this system prices; a ride on any other line is unpriced. */
  lines: LineKey[];
  effective: string | null;
  source: string;
  /** Fare in baht between two stations, keyed "A|B" with the codes sorted. */
  pairs?: Record<string, number>;
  /** Fare by stations travelled (index 0 = one station); longer trips use the last entry. */
  stopFares?: number[];
}

export interface FareData {
  retrievedAt: string;
  systems: Record<string, FareSystem>;
}

/** Which fare system charges for a ride on each line (BTS Sukhumvit, Silom and Gold share one table). */
const SYSTEM_OF: Record<LineKey, string> = {
  sukhumvit: "bts",
  silom: "bts",
  gold: "bts",
  blue: "blue",
  purple: "purple",
  arl: "arl",
  srtRed: "srtRed",
  yellow: "yellow",
  pink: "pink",
};

export interface FareSegment {
  system: string;
  name: string;
  nameTh: string;
  stops: number;
  /** Baht, or null when no published fare covers this ride. */
  fare: number | null;
}

export interface FareResult {
  segments: FareSegment[];
  /** Sum of the segments that could be priced. */
  total: number;
  /** True only when every segment was priced. */
  complete: boolean;
  /** When the figures were last refreshed (YYYY-MM-DD). */
  asOf: string;
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function fareFor(table: FareSystem, from: string, to: string, stops: number): number | null {
  if (table.pairs) return table.pairs[pairKey(from, to)] ?? null;
  if (table.stopFares && Number.isInteger(stops) && stops >= 1 && table.stopFares.length > 0) {
    const fare = table.stopFares[Math.min(stops, table.stopFares.length) - 1];
    return Number.isFinite(fare) ? fare : null;
  }
  return null;
}

export function computeFare(path: PathResult | null, data: FareData | null): FareResult | null {
  if (!path || !data) return null;
  const runs: { system: string; lines: Set<LineKey>; from: string; to: string; stops: number }[] = [];
  let current: (typeof runs)[number] | null = null;
  path.legs.forEach((leg, i) => {
    if (leg.mode !== "ride" || !leg.line) {
      current = null; // a walk (or the start) ends the current fare
      return;
    }
    const system = SYSTEM_OF[leg.line];
    if (!current || current.system !== system) {
      current = { system, lines: new Set(), from: path.legs[i - 1].station.code, to: leg.station.code, stops: 0 };
      runs.push(current);
    }
    current.lines.add(leg.line);
    current.to = leg.station.code;
    current.stops += 1;
  });
  if (runs.length === 0) return null;

  const segments = runs.map((run): FareSegment => {
    const table = data.systems[run.system];
    const priced = table && [...run.lines].every((l) => table.lines.includes(l));
    return {
      system: run.system,
      name: table?.name ?? run.system,
      nameTh: table?.nameTh ?? run.system,
      stops: run.stops,
      fare: table && priced ? fareFor(table, run.from, run.to, run.stops) : null,
    };
  });
  return {
    segments,
    total: segments.reduce((sum, s) => sum + (s.fare ?? 0), 0),
    complete: segments.every((s) => s.fare !== null),
    asOf: data.retrievedAt,
  };
}
