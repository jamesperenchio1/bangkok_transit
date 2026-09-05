import { stations, stationsByCode, type LineKey } from "@/data/stations";
import lineSequences from "@/data/line-sequences.json";

export interface PathLeg {
  station: (typeof stations)[number];
  /** The line ridden to arrive at this station (undefined for the starting station). */
  line: LineKey | null;
  /** True if this leg is a change of line at the same or a nearby station. */
  isTransfer: boolean;
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

  return codes.map((c, i) => {
    const station = stationsByCode.get(c.code)!;
    const prevLine = i > 0 ? codes[i - 1].line : null;
    return {
      station,
      line: c.line,
      isTransfer: i > 0 && prevLine !== null && c.line !== null && prevLine !== c.line,
    };
  });
}
