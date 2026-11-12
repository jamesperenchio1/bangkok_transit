import type { LineKey } from "@/data/stations";
import type { PathResult } from "@/lib/transit-graph";

/**
 * Fares are static data (data/fares.json, refreshed monthly by CI from the
 * operators' published tables, see scripts/scrape-fares.ts) computed in the
 * browser from a found route - nothing here touches a server. Each fare system
 * charges separately: a change of system, or a walk, starts a new fare, with no
 * through-ticket assumed - except where an operator publishes a transfer rule
 * or a daily cap (data/fare-rules.json), which is applied on top and shown to
 * the rider with its condition (most need the same contactless EMV card). This
 * module takes the data as an argument and imports none, so the (large) JSON
 * loads lazily - see lib/use-fares.ts.
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

export interface FareRule {
  id: string;
  /**
   * entryOnce / refund: the second ride's table fare is reduced by `amount` when a ride on `from` is
   * followed by one on `to` (at the same station, or between `fromStation` and `toStation`).
   * dailyCap: the rides on `systems` together never cost more than `cap`.
   * joint: recorded policy that is not applied (see `enabled`).
   */
  kind: "entryOnce" | "refund" | "dailyCap" | "joint";
  from?: string;
  to?: string;
  sameStation?: boolean;
  fromStation?: string;
  toStation?: string;
  systems?: string[];
  amount?: number;
  cap?: number;
  windowMinutes?: number | null;
  payment: "any" | "emv-same-card";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  enabled: boolean;
  confidence: "confirmed" | "reported";
  source: string;
  /** Shown to the rider; `{amount}` is replaced by the baht saved. */
  message: { en: string; th: string };
}

export interface FareData {
  retrievedAt: string;
  systems: Record<string, FareSystem>;
  /** Transfer and cap rules (data/fare-rules.json); none means every ride is charged its table fare. */
  rules?: FareRule[];
}

/** Today's date in Bangkok (YYYY-MM-DD), the calendar the operators' effective dates use. */
export function bangkokDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(now);
}

export function ruleActive(rule: FareRule, now: Date): boolean {
  if (!rule.enabled) return false;
  const day = bangkokDay(now);
  return (!rule.effectiveFrom || day >= rule.effectiveFrom) && (!rule.effectiveTo || day <= rule.effectiveTo);
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

export interface FareSegment {
  system: string;
  name: string;
  nameTh: string;
  stops: number;
  /** Baht after any transfer discount, or null when no published fare covers this ride. */
  fare: number | null;
  /** Baht taken off this ride's table fare by a transfer rule or a cap (0 when none). */
  discount: number;
}

export interface AppliedRule {
  id: string;
  /** Baht this rule took off. */
  amount: number;
  message: { en: string; th: string };
}

export interface FareResult {
  segments: FareSegment[];
  /** Sum of the segments that could be priced. */
  total: number;
  /** True only when every segment was priced. */
  complete: boolean;
  /** Baht saved in total by transfer rules; the route sheet says so, because it is refunded or waived rather than shown on a gate. */
  discount: number;
  /** Which rules produced that saving, with the wording that states their condition. */
  applied: AppliedRule[];
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

const fill = (rule: FareRule, amount: number): AppliedRule => ({
  id: rule.id,
  amount,
  message: { en: rule.message.en.replace("{amount}", String(amount)), th: rule.message.th.replace("{amount}", String(amount)) },
});

export function computeFare(path: PathResult | null, data: FareData | null, now: Date = new Date()): FareResult | null {
  if (!path || !data) return null;
  const runs: { system: string; lines: Set<LineKey>; from: string; to: string; stops: number; discount: number; ruleIds: string[] }[] = [];
  let current: (typeof runs)[number] | null = null;
  path.legs.forEach((leg, i) => {
    if (leg.mode !== "ride" || !leg.line) {
      current = null; // a walk (or the start) ends the current fare
      return;
    }
    const system = SYSTEM_OF[leg.line];
    if (!current || current.system !== system) {
      current = { system, lines: new Set(), from: path.legs[i - 1].station.code, to: leg.station.code, stops: 0, discount: 0, ruleIds: [] };
      runs.push(current);
    }
    current.lines.add(leg.line);
    current.to = leg.station.code;
    current.stops += 1;
  });
  if (runs.length === 0) return null;

  const rules = (data.rules ?? []).filter((r) => ruleActive(r, now));
  const applied: AppliedRule[] = [];

  // A run that begins where the previous one ended (no walk between) or at the
  // station walked to may qualify for a transfer rule.
  runs.forEach((run, i) => {
    const before = runs[i - 1];
    if (!before) return;
    const rule = rules.find(
      (r) =>
        (r.kind === "entryOnce" || r.kind === "refund") &&
        r.from === before.system &&
        r.to === run.system &&
        (r.sameStation ? before.to === run.from : before.to === r.fromStation && run.from === r.toStation),
    );
    if (rule) {
      run.discount = rule.amount ?? 0;
      run.ruleIds.push(rule.id);
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
  runs.forEach((run, i) => {
    const seg = segments[i];
    if (seg.discount > 0) {
      const rule = rules.find((r) => r.id === run.ruleIds[0])!;
      applied.push(fill(rule, seg.discount));
    }
  });

  // A daily cap trims the rides it covers to its figure. It needs every one of
  // them priced (otherwise we cannot know what the cap would save), and takes
  // the saving off the later rides first.
  for (const rule of rules.filter((r) => r.kind === "dailyCap")) {
    const covered = segments.filter((seg) => rule.systems?.includes(seg.system));
    if (covered.length === 0 || covered.some((seg) => seg.fare === null) || rule.cap === undefined) continue;
    let excess = covered.reduce((sum, seg) => sum + seg.fare!, 0) - rule.cap;
    if (excess <= 0) continue;
    let saved = 0;
    for (const seg of [...covered].reverse()) {
      const take = Math.min(excess, seg.fare!);
      seg.fare = seg.fare! - take;
      seg.discount += take;
      excess -= take;
      saved += take;
      if (excess <= 0) break;
    }
    applied.push(fill(rule, saved));
  }

  return {
    segments,
    total: segments.reduce((sum, s) => sum + (s.fare ?? 0), 0),
    complete: segments.every((s) => s.fare !== null),
    discount: segments.reduce((sum, s) => sum + s.discount, 0),
    applied,
    asOf: data.retrievedAt,
  };
}
