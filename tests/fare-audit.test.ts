import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import faresJson from "@/data/fares.json";
import rulesJson from "@/data/fare-rules.json";
import { stations } from "@/data/stations";
import { computeFare, type FareData, type FareRule } from "@/lib/fares";
import { findPath } from "@/lib/transit-graph";

/**
 * Every ordered pair of the 192 stations, priced the way the app prices it,
 * with the rules every fare must obey. Set FARE_AUDIT_OUT=<dir> to also write
 * the report (report.md, report.json): which pairs get a transfer rate, which
 * changes pay full price, and any pair that breaks a rule. See docs/operations.md.
 */
const rules = rulesJson.rules as FareRule[];
const withRules: FareData = { ...(faresJson as unknown as FareData), rules };
const withoutRules: FareData = { ...(faresJson as unknown as FareData), rules: [] };
const DAY = new Date("2026-11-13T05:00:00Z"); // inside every enabled rule's window
const codes = stations.map((s) => s.code);

interface Row {
  from: string;
  to: string;
  total: number;
  plain: number;
  applied: string[];
  systems: string[];
  complete: boolean;
}

function sweep(): { rows: Row[]; broken: string[]; unrouted: number } {
  const rows: Row[] = [];
  const broken: string[] = [];
  let unrouted = 0;
  for (const a of codes) {
    for (const b of codes) {
      if (a === b) continue;
      const path = findPath(a, b);
      if (!path) {
        unrouted++;
        continue;
      }
      const fare = computeFare(path, withRules, DAY);
      const plain = computeFare(path, withoutRules, DAY);
      if (!fare || !plain) continue; // a walk-only route has no fare
      const note = (why: string) => broken.push(`${a} -> ${b}: ${why}`);
      if (!fare.complete) note(`unpriced ride (${fare.segments.filter((s) => s.fare === null).map((s) => s.system).join(", ")})`);
      if (fare.total < 0 || !Number.isFinite(fare.total)) note(`total ${fare.total}`);
      if (fare.total > plain.total) note(`rules raised the fare ${plain.total} -> ${fare.total}`);
      if (fare.segments.some((s) => s.fare !== null && s.fare < 0)) note("negative segment");
      if (fare.discount !== plain.total - fare.total && fare.complete) note(`discount ${fare.discount} != saving ${plain.total - fare.total}`);
      if (fare.applied.reduce((n, r) => n + r.amount, 0) !== fare.discount) note("applied rules do not add up to the discount");
      for (const r of fare.applied) if (!rules.some((x) => x.id === r.id && x.enabled)) note(`applied unknown or disabled rule ${r.id}`);
      if (fare.complete && fare.total < 14) note(`fare ${fare.total} is below any operator's minimum`);
      rows.push({ from: a, to: b, total: fare.total, plain: plain.total, applied: fare.applied.map((r) => r.id), systems: fare.segments.map((s) => s.system), complete: fare.complete });
    }
  }
  return { rows, broken, unrouted };
}

let swept: ReturnType<typeof sweep> | null = null;
/** One sweep (about 15 s) shared by every test in this file. */
const sweepOnce = () => (swept ??= sweep());

function report(rows: Row[], broken: string[], unrouted: number): { md: string; json: unknown } {
  const byRule = new Map<string, { n: number; saved: number }>();
  const changes = new Map<string, number>();
  for (const r of rows) {
    for (const id of r.applied) byRule.set(id, { n: (byRule.get(id)?.n ?? 0) + 1, saved: (byRule.get(id)?.saved ?? 0) });
    if (r.applied.length) for (const id of new Set(r.applied)) byRule.get(id)!.saved += r.plain - r.total;
    for (let i = 1; i < r.systems.length; i++) {
      const key = `${r.systems[i - 1]} -> ${r.systems[i]}`;
      changes.set(key, (changes.get(key) ?? 0) + 1);
    }
  }
  const discounted = rows.filter((r) => r.applied.length);
  const lines = [
    "# Fare audit",
    "",
    `Every ordered pair of ${codes.length} stations (${rows.length} priced, ${unrouted} with no route), priced as of ${DAY.toISOString().slice(0, 10)}.`,
    "",
    `Rule violations: **${broken.length}**`,
    ...broken.slice(0, 50).map((b) => `- ${b}`),
    "",
    "## Where a transfer is cheaper than two separate fares",
    "",
    "| Rule | Pairs affected | Avg saving (baht) |",
    "| --- | ---: | ---: |",
    ...[...byRule.entries()].map(([id, v]) => `| ${id} | ${v.n} | ${(v.saved / v.n).toFixed(1)} |`),
    "",
    `${discounted.length} of ${rows.length} journeys get a discount.`,
    "",
    "## Changes between fare systems and how often routes use them (full price unless a rule above names it)",
    "",
    "| Change | Journeys |",
    "| --- | ---: |",
    ...[...changes.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${k} | ${n} |`),
    "",
  ];
  return { md: lines.join("\n"), json: { rows: rows.length, unrouted, broken, byRule: Object.fromEntries(byRule), changes: Object.fromEntries(changes) } };
}

describe("fare audit: every ordered pair of stations", () => {
  it("prices every journey and breaks no fare rule", { timeout: 300_000 }, () => {
    const t0 = Date.now();
    const { rows, broken, unrouted } = sweepOnce();
    const out = process.env.FARE_AUDIT_OUT;
    if (out) {
      const { md, json } = report(rows, broken, unrouted);
      mkdirSync(out, { recursive: true });
      writeFileSync(path.join(out, "report.md"), md);
      writeFileSync(path.join(out, "report.json"), JSON.stringify(json, null, 1));
    }
    console.log(`fare audit: ${rows.length} journeys in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${broken.length} violations`);
    expect(broken.slice(0, 20)).toEqual([]);
    expect(rows.length).toBeGreaterThan(30_000);
  });

  it("the same journey reversed costs the same unless a refund or the day cap explains it", { timeout: 300_000 }, () => {
    const { rows } = sweepOnce();
    const price = new Map(rows.map((r) => [`${r.from}|${r.to}`, r]));
    // A refund rule is one-way by nature; the cap trims whichever ride is charged more than 40, and
    // which ride that is depends on the order (Blue then Purple vs Purple then Blue).
    const directional = new Set(rules.filter((r) => r.enabled && (r.kind === "refund" || r.kind === "dailyCap")).map((r) => r.id));
    const unexplained: string[] = [];
    let explained = 0;
    for (const r of rows) {
      if (r.from > r.to) continue;
      const back = price.get(`${r.to}|${r.from}`);
      if (!back || back.total === r.total) continue;
      if ([...r.applied, ...back.applied].some((id) => directional.has(id))) explained++;
      else unexplained.push(`${r.from}<->${r.to}: ${r.total} vs ${back.total} (${r.systems.join("+")} / ${back.systems.join("+")})`);
    }
    expect(unexplained.slice(0, 20)).toEqual([]);
    console.log(`fare audit: ${explained} journeys cost different amounts in the two directions, all explained by a one-way rule or the cap`);
  });
});
