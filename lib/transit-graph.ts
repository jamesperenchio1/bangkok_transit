import { stationsByCode, type LineKey, type Station } from "@/data/stations";
import lineSequences from "@/data/line-sequences.json";
import interchanges from "@/data/interchanges.json";
import hopTimes from "@/data/hop-times.json";
import { haversineMeters } from "@/lib/line-geometry";

/**
 * The rail network as a graph, and the route search over it.
 *
 * Nodes are station codes. Edges come from two hand-maintained files:
 *
 * - data/line-sequences.json: each line is one or more *segments* - ordered
 *   runs of stops a train actually travels. Consecutive codes in a segment
 *   are adjacent. Branches are extra segments sharing a station (SRT Red's
 *   Light/Dark lines both start at Krung Thep Aphiwat; Pink's Muang Thong
 *   Thani spur leaves the trunk at PK10). MRT Blue is one segment that
 *   visits Tha Phra twice: trains run Lak Song -> Tha Phra -> round the loop
 *   -> Charan 13 -> Tha Phra, so its termini are simply the segment's ends
 *   (a loop-closing end, Tha Phra, hands over to the other end, Lak Song:
 *   the train carries on, so every Blue Line train ends at Lak Song).
 *   Each segment is its own *service* - a different train - so moving
 *   between two segments of one line (Pink trunk <-> Muang Thong Thani
 *   spur) is a change, even though the line is the same.
 * - data/interchanges.json: walking transfers between *distinct* stations on
 *   different lines (Mo Chit BTS <-> Chatuchak Park MRT). Same-building
 *   interchanges (Siam, Tao Poon) are one station node carrying several
 *   lines and need no entry.
 *
 * Both files are checked by tests (tests/data.test.ts): every code exists,
 * every station is on a line, and every interchange is a short walk.
 *
 * Ride times come from data/hop-times.json where it has them (scheduled
 * running time per hop from OTP's open GTFS feed, see
 * scripts/build-hop-times.ts), and from a distance/speed formula otherwise.
 */

export type LegMode = "start" | "ride" | "walk";

export interface PathLeg {
  station: Station;
  /** How this station was reached: the first leg is "start". */
  mode: LegMode;
  /** The line ridden to reach this station (null for "start" and "walk" legs). */
  line: LineKey | null;
  /** The train service ridden to reach this station: the line plus which segment of it (null for "start" and "walk"). */
  service: string | null;
  /**
   * Set on the station where a line is boarded (the start, the end of a
   * walk, or a change of line): the terminus of the boarded line in the
   * direction of travel ("board toward Khu Khot").
   */
  boardToward?: Station;
  /**
   * Set beside `boardToward` when the terminus alone doesn't say which way to
   * go: both directions from this station end at the same place (every MRT
   * Blue train ends at Lak Song, whichever platform at Tha Phra it leaves
   * from). The next station along, so the rider can pick the platform.
   */
  boardVia?: Station;
  /** True where the rider gets off one line and onto another (or walks). */
  isChange: boolean;
  /** Walking distance for a "walk" leg, in meters. */
  walkMeters?: number;
}

export interface PathResult {
  legs: PathLeg[];
  /** Stops ridden (excludes walks). */
  stops: number;
  /** Line changes, including walking transfers between rides. */
  changes: number;
  /** Total walking, in meters. */
  walkMeters: number;
  /** Rough door-to-door estimate in minutes, excluding the first wait. */
  minutes: number;
}

type Edge =
  | { kind: "ride"; to: string; line: LineKey; service: string; minutes: number }
  | { kind: "walk"; to: string; meters: number };

/**
 * Cost model, in estimated minutes. Rough by design - good enough to prefer
 * the sensible route (an express Airport Rail Link hop over six BTS stops, a
 * single change over two) and to show an honest "~25 min".
 *
 * Riding one hop costs the scheduled running time from data/hop-times.json
 * plus that line's stop time. Lines or hops the table lacks (Yellow and Pink,
 * whose feed times are placeholders, and SRT Light Red) use the formula below
 * instead: one average speed for every line, which is why it's only a
 * fallback.
 */
const TRAIN_KMH = 40; // average between stations, including acceleration
const TRACK_DETOUR = 1.15; // track length vs. straight line between stations
const DWELL_MIN = 0.5;
const CHANGE_MIN = 5; // change platforms + wait at the same station
const WALK_TRANSFER_MIN = 3; // fixed overhead of a walking transfer (stairs, gates)
const WALK_M_PER_MIN = 75;

function rideMinutes(meters: number): number {
  return DWELL_MIN + ((meters * TRACK_DETOUR) / 1000 / TRAIN_KMH) * 60;
}

/** Scheduled minutes for one hop (running time + stop time), or undefined if the feed has none. */
function scheduledRideMinutes(line: LineKey, a: string, b: string): number | undefined {
  const table = (hopTimes.lines as Record<string, { dwell: number; hops: Record<string, number> } | undefined>)[line];
  const run = table?.hops[a < b ? `${a}|${b}` : `${b}|${a}`];
  return run === undefined ? undefined : run + table!.dwell;
}

function walkMinutes(meters: number, speed = WALK_M_PER_MIN): number {
  return WALK_TRANSFER_MIN + meters / speed;
}

const sequences = lineSequences as Record<LineKey, string[][]>;

function station(code: string): Station {
  const s = stationsByCode.get(code);
  if (!s) throw new Error(`Unknown station code ${code}`);
  return s;
}

function distance(a: string, b: string): number {
  const sa = station(a);
  const sb = station(b);
  return haversineMeters([sa.lat, sa.lon], [sb.lat, sb.lon]);
}

/**
 * The terminus of `line` reached by riding from `fromCode` to the adjacent
 * `towardCode`: the end of whichever segment holds that hop, in that
 * direction. Matches the platform signage ("to Khu Khot") and the live
 * arrivals API's `direction_key` for BTS.
 */
export function terminusInDirection(line: LineKey, fromCode: string, towardCode: string): string | undefined {
  for (const segment of sequences[line] ?? []) {
    for (let i = 0; i < segment.length - 1; i++) {
      if (segment[i] === fromCode && segment[i + 1] === towardCode) return runEnd(segment, true);
      if (segment[i] === towardCode && segment[i + 1] === fromCode) return runEnd(segment, false);
    }
  }
  return undefined;
}

/**
 * Where a train running to one end of `segment` really finishes. Normally the
 * end itself; but when that station is also visited earlier in the segment (MRT
 * Blue returns to Tha Phra after the loop) the train carries on, so it ends at
 * the segment's other end.
 */
function runEnd(segment: string[], forward: boolean): string {
  const end = forward ? segment[segment.length - 1] : segment[0];
  if (segment.indexOf(end) === segment.lastIndexOf(end)) return end;
  return forward ? segment[0] : segment[segment.length - 1];
}

/** Stations next to `code` on `line`, across every segment (both directions, branches included). */
function neighbours(line: LineKey, code: string): string[] {
  const out = new Set<string>();
  for (const segment of sequences[line] ?? []) {
    segment.forEach((c, i) => {
      if (c !== code) return;
      if (i > 0) out.add(segment[i - 1]);
      if (i < segment.length - 1) out.add(segment[i + 1]);
    });
  }
  return [...out];
}

function buildGraph(): Map<string, Edge[]> {
  const graph = new Map<string, Edge[]>();
  const add = (from: string, edge: Edge) => {
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from)!.push(edge);
  };

  for (const [line, segments] of Object.entries(sequences) as [LineKey, string[][]][]) {
    for (const [segmentIndex, segment] of segments.entries()) {
      const service = `${line}:${segmentIndex}`;
      for (let i = 0; i < segment.length - 1; i++) {
        const minutes =
          scheduledRideMinutes(line, segment[i], segment[i + 1]) ?? rideMinutes(distance(segment[i], segment[i + 1]));
        add(segment[i], { kind: "ride", to: segment[i + 1], line, service, minutes });
        add(segment[i + 1], { kind: "ride", to: segment[i], line, service, minutes });
      }
    }
  }
  for (const { a, b } of interchanges) {
    const meters = distance(a, b);
    add(a, { kind: "walk", to: b, meters });
    add(b, { kind: "walk", to: a, meters });
  }
  return graph;
}

let graphCache: Map<string, Edge[]> | null = null;
function getGraph(): Map<string, Edge[]> {
  return (graphCache ??= buildGraph());
}

/**
 * Search state: where you are and how you got there. The line matters - a
 * change costs extra - so the same station reached on different lines is a
 * different state (otherwise the transfer penalty can't be applied right).
 */
interface State {
  code: string;
  mode: LegMode;
  line: LineKey | null;
  service: string | null;
}

const stateKey = (s: State) => `${s.code}|${s.mode}|${s.service ?? ""}`;

/**
 * Fastest route (by the cost model above) between two station codes, or
 * null if either code is unknown, they're the same, or nothing connects
 * them. Dijkstra over (station, arrival mode, line) states; the network is
 * ~200 stations, so a sorted array is a perfectly good priority queue.
 */
export interface PathOptions {
  /** Lines to avoid: charged extra per ride minute, so a route without them wins unless it is far slower. */
  avoidLines?: readonly LineKey[];
  /** Walking speed for transfers, metres per minute (default 75). */
  walkSpeed?: number;
  /** Minutes for a change of line / platform (default 5). */
  changeMinutes?: number;
  /** Charge extra for each change of line, so fewer changes beat a slightly faster trip. */
  fewerChanges?: boolean;
  /** Charge extra for walking transfers, so a ride-only route wins unless it is much slower. */
  avoidWalking?: boolean;
}

// Minutes added on top of the real cost. Large enough to change the winner
// between comparable routes, small enough that a route that truly needs a
// change or a walk still gets found (these are preferences, not bans).
const FEWER_CHANGES_PENALTY_MIN = 8;
const AVOID_WALKING_PENALTY_MIN = 15;
/** Extra cost multiplier on the ride minutes of an avoided line (1 = no extra). */
const AVOIDED_LINE_FACTOR = 2.5;

export function findPath(fromCode: string, toCode: string, options: PathOptions = {}): PathResult | null {
  const graph = getGraph();
  if (fromCode === toCode || !graph.has(fromCode) || !graph.has(toCode)) return null;

  const start: State = { code: fromCode, mode: "start", line: null, service: null };
  const best = new Map<string, number>([[stateKey(start), 0]]);
  // The trip's real minutes alongside the (possibly penalised) search cost,
  // so a preference never inflates the time shown to the rider.
  const realMinutes = new Map<string, number>([[stateKey(start), 0]]);
  const prev = new Map<string, { state: State; meters?: number }>();
  const queue: { state: State; cost: number }[] = [{ state: start, cost: 0 }];
  let goal: { state: State; cost: number } | null = null;

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const { state, cost } = queue.shift()!;
    if (cost > (best.get(stateKey(state)) ?? Infinity)) continue;
    if (state.code === toCode) {
      goal = { state, cost };
      break;
    }

    for (const edge of graph.get(state.code) ?? []) {
      let next: State;
      let edgeCost: number;
      let penalty = 0;
      if (edge.kind === "walk") {
        // One walk per transfer: never walk station-to-station-to-station.
        if (state.mode === "walk") continue;
        next = { code: edge.to, mode: "walk", line: null, service: null };
        edgeCost = walkMinutes(edge.meters, options.walkSpeed);
        if (options.avoidWalking) penalty = AVOID_WALKING_PENALTY_MIN;
      } else {
        const changing = state.mode === "ride" && state.service !== edge.service;
        next = { code: edge.to, mode: "ride", line: edge.line, service: edge.service };
        edgeCost = edge.minutes + (changing ? (options.changeMinutes ?? CHANGE_MIN) : 0);
        if (changing && options.fewerChanges) penalty = FEWER_CHANGES_PENALTY_MIN;
        if (options.avoidLines?.includes(edge.line)) penalty += edge.minutes * (AVOIDED_LINE_FACTOR - 1);
      }
      const nextCost = cost + edgeCost + penalty;
      const key = stateKey(next);
      if (nextCost < (best.get(key) ?? Infinity)) {
        best.set(key, nextCost);
        realMinutes.set(key, (realMinutes.get(stateKey(state)) ?? 0) + edgeCost);
        prev.set(key, { state, meters: edge.kind === "walk" ? edge.meters : undefined });
        queue.push({ state: next, cost: nextCost });
      }
    }
  }

  if (!goal) return null;

  // Walk back from the goal to the start.
  const steps: { state: State; meters?: number }[] = [];
  let cursor: { state: State; meters?: number } | undefined = { state: goal.state };
  while (cursor) {
    const back = prev.get(stateKey(cursor.state));
    steps.push({ state: cursor.state, meters: back?.meters });
    cursor = back ? { state: back.state } : undefined;
  }
  steps.reverse();

  const legs: PathLeg[] = steps.map(({ state, meters }) => ({
    station: station(state.code),
    mode: state.mode,
    line: state.line,
    service: state.service,
    isChange: false,
    ...(state.mode === "walk" && meters !== undefined && { walkMeters: Math.round(meters) }),
  }));

  // A line is boarded at leg i when leg i+1 is a ride that doesn't continue
  // the ride that reached leg i. Every boarding after the first is a change,
  // flagged where the rider gets off: the station itself for a same-station
  // change, or the station walked from for a walking transfer.
  let boardings = 0;
  for (let i = 0; i < legs.length - 1; i++) {
    const here = legs[i];
    const next = legs[i + 1];
    if (next.mode !== "ride" || (here.mode === "ride" && here.service === next.service)) continue;
    boardings++;
    const terminus = terminusInDirection(next.line!, here.station.code, next.station.code);
    if (terminus) {
      here.boardToward = station(terminus);
      // Another way out of this station ends at the same place: say which.
      const ambiguous = neighbours(next.line!, here.station.code).some(
        (n) => n !== next.station.code && terminusInDirection(next.line!, here.station.code, n) === terminus,
      );
      if (ambiguous) here.boardVia = next.station;
    }
    if (here.mode === "ride") here.isChange = true;
    else if (here.mode === "walk" && legs[i - 1]?.mode === "ride") legs[i - 1].isChange = true;
  }

  return {
    legs,
    stops: legs.filter((l) => l.mode === "ride").length,
    changes: Math.max(0, boardings - 1),
    walkMeters: legs.reduce((sum, l) => sum + (l.walkMeters ?? 0), 0),
    minutes: Math.max(1, Math.round(realMinutes.get(stateKey(goal.state)) ?? goal.cost)),
  };
}
