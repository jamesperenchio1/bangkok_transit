import { stations, stationsByCode, type LineKey } from "@/data/stations";
import lineSequences from "@/data/line-sequences.json";

export interface LineChange {
  /** The line ridden into this station (absent when the route starts with a walk). */
  fromLine?: LineKey;
  /** The line to board next. */
  toLine: LineKey;
  /** For a walking transfer: straight-line distance to the next station. */
  walkMeters?: number;
  /**
   * The terminus of `toLine` in the direction the route continues (e.g.
   * "board toward Khu Khot"). Omitted when the change is the route's final
   * hop, so there's no next stop on that line to infer a direction from.
   */
  towardStation?: (typeof stations)[number];
}

export interface PathLeg {
  station: (typeof stations)[number];
  /** The line ridden to arrive at this station (null for the starting station). For a walk, the line walked to. */
  line: LineKey | null;
  /** True if this station is reached on foot from the previous one (a walking transfer), not by train. */
  isWalk: boolean;
  /**
   * Set on the station where you change lines - the interchange itself, not
   * the stop after it - including where a walk to a nearby station begins.
   */
  change?: LineChange;
}

export type PathResult = PathLeg[];

interface Edge {
  to: string;
  line: LineKey;
}

// MRT Blue Line operates as a closed loop (Tha Phra <-> Tha Phra via Hua
// Lamphong) - the two ends of its stop sequence (data/line-sequences.json)
// are physically adjacent too. Nothing else in the network is a loop.
const LOOP_CLOSURES: [string, string][] = [["BL38", "BL07"]];

// Distinct stations within this distance of each other are treated as a
// walking transfer (e.g. Mo Chit BTS <-> Chatuchak Park MRT, ~250m apart,
// or Phaya Thai BTS <-> Phaya Thai Airport Rail Link). This mirrors BMA's
// own "500m from station" planning buffer (see the "ระยะห่างจากสถานีรถไฟฟ้า
// 500 ม." layer on their GIS site) rather than requiring every real-world
// interchange pair to be hand-curated by name.
const WALKING_TRANSFER_METERS = 400;
const TRANSFER_PENALTY = 1.5; // extra "hops" a transfer costs, so same-line paths are preferred when equally short

const sequences = lineSequences as Record<LineKey, string[]>;

// data/line-sequences.json's `pink` array has the unopened Muang Thong Thani
// branch (MT01/MT02) appended after the real trunk terminus (Min Buri)
// rather than spliced in where it physically branches off (see
// scripts/build-line-sequences.ts) - so the array's last element isn't the
// right "forward" terminus to show as transfer direction guidance.
const TRUNK_TERMINUS_OVERRIDES: Partial<Record<LineKey, string>> = {
  pink: "PK30",
};

/**
 * The terminus of `line`, in the direction of travel from `fromCode` to
 * `towardCode` (an immediate next stop on that same line). Handles MRT
 * Blue's loop-closure edge specially, since its two "ends" are far apart in
 * the sequence array despite being physically adjacent.
 */
export function terminusInDirection(line: LineKey, fromCode: string, towardCode: string): string | undefined {
  const seq = sequences[line];
  if (!seq) return undefined;

  const forwardTerminus = TRUNK_TERMINUS_OVERRIDES[line] ?? seq[seq.length - 1];

  for (const [a, b] of LOOP_CLOSURES) {
    if (fromCode === a && towardCode === b) return forwardTerminus;
    if (fromCode === b && towardCode === a) return seq[0];
  }

  const fromIdx = seq.indexOf(fromCode);
  const towardIdx = seq.indexOf(towardCode);
  if (fromIdx === -1 || towardIdx === -1) return undefined;

  return towardIdx > fromIdx ? forwardTerminus : seq[0];
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildGraph(): Map<string, Edge[]> {
  const graph = new Map<string, Edge[]>();
  const addEdge = (a: string, b: string, line: LineKey) => {
    if (!graph.has(a)) graph.set(a, []);
    graph.get(a)!.push({ to: b, line });
  };

  // Ride edges: adjacent stops within each line's sequence.
  for (const [line, codes] of Object.entries(lineSequences) as [LineKey, string[]][]) {
    for (let i = 0; i < codes.length - 1; i++) {
      addEdge(codes[i], codes[i + 1], line);
      addEdge(codes[i + 1], codes[i], line);
    }
  }
  for (const [a, b] of LOOP_CLOSURES) {
    addEdge(a, b, "blue");
    addEdge(b, a, "blue");
  }

  // Walking-transfer edges between distinct nearby stations on different lines.
  // (Same-station multi-line interchanges, e.g. Siam or Tao Poon, need no
  // special edge here - they already share one node with multiple `lines`,
  // so ride edges on each of that node's lines are already present above.)
  for (let i = 0; i < stations.length; i++) {
    for (let j = i + 1; j < stations.length; j++) {
      const a = stations[i];
      const b = stations[j];
      const shareLine = a.lines.some((la) => b.lines.some((lb) => la.line === lb.line));
      if (shareLine) continue;
      if (haversineMeters([a.lon, a.lat], [b.lon, b.lat]) <= WALKING_TRANSFER_METERS) {
        addEdge(a.code, b.code, b.lines[0].line);
        addEdge(b.code, a.code, a.lines[0].line);
      }
    }
  }

  return graph;
}

let graphCache: Map<string, Edge[]> | null = null;
function getGraph(): Map<string, Edge[]> {
  if (!graphCache) graphCache = buildGraph();
  return graphCache;
}

/**
 * Shortest path by hop count (BFS, weighting a line transfer slightly higher
 * so equally-short same-line paths win) between two station codes. Returns
 * null if the codes don't exist or no path connects them.
 */
export function findPath(fromCode: string, toCode: string): PathResult | null {
  const graph = getGraph();
  if (!graph.has(fromCode) || !graph.has(toCode)) return null;
  if (fromCode === toCode) return null;

  const dist = new Map<string, number>([[fromCode, 0]]);
  const prev = new Map<string, { code: string; line: LineKey }>();
  // Simple Dijkstra-ish priority handling via a sorted insert - the graph is
  // tiny (~200 nodes), so a linear-scan "priority queue" is plenty fast.
  const queue: { code: string; line: LineKey | null; cost: number }[] = [
    { code: fromCode, line: null, cost: 0 },
  ];

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    if (current.cost > (dist.get(current.code) ?? Infinity)) continue;
    if (current.code === toCode) break;

    for (const edge of graph.get(current.code) ?? []) {
      const isTransfer = current.line !== null && current.line !== edge.line;
      const cost = current.cost + (isTransfer ? TRANSFER_PENALTY : 1);
      if (cost < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, cost);
        prev.set(edge.to, { code: current.code, line: edge.line });
        queue.push({ code: edge.to, line: edge.line, cost });
      }
    }
  }

  if (!prev.has(toCode)) return null;

  const codes: { code: string; line: LineKey | null }[] = [{ code: toCode, line: null }];
  let cursor = toCode;
  while (cursor !== fromCode) {
    const step = prev.get(cursor)!;
    codes[codes.length - 1].line = step.line;
    codes.push({ code: step.code, line: null });
    cursor = step.code;
  }
  codes.reverse();

  const legs: PathLeg[] = codes.map((c, i) => {
    const station = stationsByCode.get(c.code)!;
    // A walking-transfer edge is labelled with the line walked *to*, which
    // the station walked from doesn't serve; every ride edge's line is
    // served by both of its ends.
    const prevStation = i > 0 ? stationsByCode.get(codes[i - 1].code)! : null;
    const isWalk = prevStation !== null && c.line !== null && !prevStation.lines.some((l) => l.line === c.line);
    return { station, line: c.line, isWalk };
  });

  const toward = (line: LineKey, from: PathLeg, next: PathLeg | undefined) => {
    if (!next || next.isWalk || next.line !== line) return undefined;
    const terminusCode = terminusInDirection(line, from.station.code, next.station.code);
    return terminusCode ? stationsByCode.get(terminusCode) : undefined;
  };

  for (let k = 0; k < legs.length - 1; k++) {
    const here = legs[k];
    const next = legs[k + 1];
    const ridingLine = k > 0 && !here.isWalk ? (here.line ?? undefined) : undefined;
    if (next.isWalk) {
      // Walk to a nearby station, then board whatever the route rides
      // from there (usually, but not always, the line the walk edge names).
      const after = legs[k + 2];
      const toLine = after && !after.isWalk && after.line ? after.line : next.line!;
      here.change = {
        fromLine: ridingLine,
        toLine,
        walkMeters: Math.round(haversineMeters([here.station.lon, here.station.lat], [next.station.lon, next.station.lat]) / 10) * 10,
        towardStation: toward(toLine, next, after),
      };
    } else if (ridingLine && next.line && next.line !== ridingLine) {
      here.change = { fromLine: ridingLine, toLine: next.line, towardStation: toward(next.line, here, next) };
    }
  }

  return legs;
}

/** Line changes along a path that switch from one train to another (a walk at the very start doesn't count). */
export function countChanges(path: PathResult): number {
  return path.filter((leg) => leg.change?.fromLine).length;
}

/** Train stops ridden along a path (walks excluded). */
export function countStops(path: PathResult): number {
  return path.filter((leg, i) => i > 0 && !leg.isWalk).length;
}

/**
 * Stations where you can change lines: one node serving several lines
 * (Siam, Tao Poon, ...) or a short walk from a station on another line
 * (Mo Chit <-> Chatuchak Park). The map draws these as interchange markers.
 */
export const interchangeCodes: ReadonlySet<string> = (() => {
  const codes = new Set<string>();
  for (const s of stations) if (s.lines.length > 1) codes.add(s.code);
  for (const [from, edges] of getGraph()) {
    const fromStation = stationsByCode.get(from);
    if (edges.some((e) => fromStation && !fromStation.lines.some((l) => l.line === e.line))) codes.add(from);
  }
  return codes;
})();
