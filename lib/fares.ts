import faresJson from "@/data/fares.json";
import type { LineKey } from "@/data/stations";
import type { PathResult } from "@/lib/transit-graph";

/**
 * Fares are static data bundled with the site (data/fares.json, refreshed
 * monthly by CI), computed in the browser from a found route - nothing here
 * touches a server. Each operator charges separately: a change of operator, or
 * a walk, starts a new fare, with no through-ticket assumed.
 */

export type OperatorKey = "bts" | "gold" | "mrt" | "arl" | "srtRed" | "yellow" | "pink";

export interface OperatorFares {
  name: string;
  /** Lines this table prices; a ride on any other line of the operator is unpriced. */
  lines: LineKey[];
  effective: string;
  source: string;
  /** Fare in baht by stations travelled: index 0 is one station; longer trips use the last entry. */
  stopFares: number[];
}

export interface FareData {
  retrievedAt: string;
  operators: Record<OperatorKey, OperatorFares | null>;
}

const OPERATOR_OF: Record<LineKey, OperatorKey> = {
  sukhumvit: "bts",
  silom: "bts",
  gold: "gold",
  blue: "mrt",
  purple: "mrt",
  arl: "arl",
  srtRed: "srtRed",
  yellow: "yellow",
  pink: "pink",
};

export const OPERATOR_NAMES: Record<OperatorKey, string> = {
  bts: "BTS",
  gold: "Gold Line",
  mrt: "MRT",
  arl: "Airport Rail Link",
  srtRed: "SRT Red Line",
  yellow: "Yellow Line",
  pink: "Pink Line",
};

export interface FareSegment {
  operator: OperatorKey;
  stops: number;
  /** Baht, or null when no verified fare table covers this ride. */
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

export function fareForStops(table: OperatorFares, stops: number): number | null {
  if (!Number.isInteger(stops) || stops < 1 || table.stopFares.length === 0) return null;
  const fare = table.stopFares[Math.min(stops, table.stopFares.length) - 1];
  return Number.isFinite(fare) ? fare : null;
}

export function computeFare(path: PathResult | null, data: FareData = faresJson as FareData): FareResult | null {
  if (!path) return null;
  const runs: { operator: OperatorKey; lines: Set<LineKey>; stops: number }[] = [];
  let current: (typeof runs)[number] | null = null;
  for (const leg of path.legs) {
    if (leg.mode !== "ride" || !leg.line) {
      current = null; // a walk (or the start) ends the current fare
      continue;
    }
    const operator = OPERATOR_OF[leg.line];
    if (!current || current.operator !== operator) {
      current = { operator, lines: new Set(), stops: 0 };
      runs.push(current);
    }
    current.lines.add(leg.line);
    current.stops += 1;
  }
  if (runs.length === 0) return null;

  const segments = runs.map((run): FareSegment => {
    const table = data.operators[run.operator];
    const priced = table && [...run.lines].every((l) => table.lines.includes(l));
    return { operator: run.operator, stops: run.stops, fare: table && priced ? fareForStops(table, run.stops) : null };
  });
  return {
    segments,
    total: segments.reduce((sum, s) => sum + (s.fare ?? 0), 0),
    complete: segments.every((s) => s.fare !== null),
    asOf: data.retrievedAt,
  };
}
