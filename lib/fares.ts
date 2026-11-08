import type { LineKey } from "@/data/stations";
import type { PathResult } from "@/lib/transit-graph";

/**
 * Fares are static data (data/fares.json, refreshed monthly by CI from the
 * operators' published tables, see scripts/scrape-fares.ts) computed in the
 * browser from a found route - nothing here touches a server. Each fare system
 * charges separately: a change of system, or a walk, starts a new fare, with no
 * through-ticket assumed - except the two transfers below, where a rider
 * actually pays less than the two fares added together. This module takes the data as an argument and imports
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
  srtDarkRed: "srtRed",
  srtLightRed: "srtRed",
  yellow: "yellow",
  pink: "pink",
};

/**
 * Transfers where the second ride costs less than its table fare.
 *
 * - MRT Blue <-> Purple at Tao Poon, one station with one paid area: the
 *   second system's entry fee is not charged again. MRTA's own rule is
 *   "entry fare charged once" (Nation, "MRTA revises Purple Line fares", 2026;
 *   originally "ไม่มีค่าแรกเข้าสำหรับการเปลี่ยนระบบ", MRTA entry fee 14 baht).
 *   Checked against a rider's figure: Bang Sue -> Wong Sawang is 17 (Blue, one
 *   stop) + 20 (Purple, two stops) - 14 = 23 baht. The 14 is MRTA's published
 *   entry fee, not a figure from a current fare table; revisit if BEM changes it.
 * - MRT Blue -> Yellow at Lat Phrao (BL15 -> YL01): tap out of Blue and into
 *   Yellow within 30 minutes on the same EMV card and the Yellow entry fee is
 *   refunded - 15 baht (ebm.co.th/en/ticket-emv, refunded to the card within
 *   3-7 days). Only the Blue -> Yellow direction is documented.
 */
const BLUE_PURPLE_ENTRY_FEE = 14;
const BLUE_TO_YELLOW_DISCOUNT = 15;
/** Internal ids (not display codes) of the Lat Phrao stations. */
const LAT_PHRAO_BLUE = "BL26";
const LAT_PHRAO_YELLOW = "YL01";

export interface FareSegment {
  system: string;
  name: string;
  nameTh: string;
  stops: number;
  /** Baht after any transfer discount, or null when no published fare covers this ride. */
  fare: number | null;
  /** Baht taken off this ride's table fare by a transfer rule (0 when none). */
  discount: number;
}

export interface FareResult {
  segments: FareSegment[];
  /** Sum of the segments that could be priced. */
  total: number;
  /** True only when every segment was priced. */
  complete: boolean;
  /** Baht saved in total by transfer rules; the route sheet says so, because it is refunded or waived rather than shown on a gate. */
  discount: number;
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
  const runs: { system: string; lines: Set<LineKey>; from: string; to: string; stops: number; discount: number }[] = [];
  let current: (typeof runs)[number] | null = null;
  path.legs.forEach((leg, i) => {
    if (leg.mode !== "ride" || !leg.line) {
      current = null; // a walk (or the start) ends the current fare
      return;
    }
    const system = SYSTEM_OF[leg.line];
    if (!current || current.system !== system) {
      current = { system, lines: new Set(), from: path.legs[i - 1].station.code, to: leg.station.code, stops: 0, discount: 0 };
      runs.push(current);
    }
    current.lines.add(leg.line);
    current.to = leg.station.code;
    current.stops += 1;
  });
  if (runs.length === 0) return null;

  // A run that begins where the previous one ended (no walk between) or at the
  // station walked to (Lat Phrao) may qualify for a transfer discount.
  runs.forEach((run, i) => {
    const before = runs[i - 1];
    if (!before) return;
    const pair = [before.system, run.system].sort().join("+");
    if (pair === "blue+purple" && before.to === run.from) run.discount = BLUE_PURPLE_ENTRY_FEE;
    else if (before.system === "blue" && run.system === "yellow" && before.to === LAT_PHRAO_BLUE && run.from === LAT_PHRAO_YELLOW) {
      run.discount = BLUE_TO_YELLOW_DISCOUNT;
    }
  });

  const segments = runs.map((run): FareSegment => {
    const table = data.systems[run.system];
    const priced = table && [...run.lines].every((l) => table.lines.includes(l));
    const base = table && priced ? fareFor(table, run.from, run.to, run.stops) : null;
    // Never below zero, and never a discount on a ride we couldn't price.
    const discount = base === null ? 0 : Math.min(run.discount, base);
    return {
      system: run.system,
      name: table?.name ?? run.system,
      nameTh: table?.nameTh ?? run.system,
      stops: run.stops,
      fare: base === null ? null : base - discount,
      discount,
    };
  });
  return {
    segments,
    total: segments.reduce((sum, s) => sum + (s.fare ?? 0), 0),
    complete: segments.every((s) => s.fare !== null),
    discount: segments.reduce((sum, s) => sum + s.discount, 0),
    asOf: data.retrievedAt,
  };
}
