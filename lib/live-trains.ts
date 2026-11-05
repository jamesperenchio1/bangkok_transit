import hopTimes from "@/data/hop-times.json";
import lineSequences from "@/data/line-sequences.json";
import { ageMs, isFresh, type Arrivals } from "./bts";

/**
 * Where each BTS train probably is right now, worked out from the arrivals we
 * already poll - no extra requests, so this costs nothing per user.
 *
 * The feed has no train positions, only "train 087 reaches Siam in 5.9 min".
 * But the same `train_no` shows up at every station ahead of it, so each
 * sighting is a (station, arrival time) pair, and between two such pairs the
 * train is somewhere on the track between those stations. A position is
 * therefore an *estimate*: between stations the train eases from one stop to
 * the next, and at each station it stands for the timetable's dwell time (as
 * does the hop before the first sighting).
 *
 * Kept free of map and DOM imports so it can be unit-tested and reused.
 */

export type TrainLine = "sukhumvit" | "silom";
const TRAIN_LINES: TrainLine[] = ["sukhumvit", "silom"];
const sequences = lineSequences as Record<string, string[][]>;

/** The one ordered stop list per live line (both are single-segment). */
const SEQUENCE: Record<TrainLine, string[]> = {
  sukhumvit: sequences.sukhumvit[0],
  silom: sequences.silom[0],
};

/** A train that has reached its last known stop stays put this long, then goes. */
const LINGER_MS = 45_000;
/**
 * A train first sighted at a station further ahead than this is not drawn
 * until it gets closer. It means the stations behind it are missing from the
 * feed (a failed poll), so we can't place it honestly.
 */
const PRE_ROLL_MS = 60_000;
/** A train waiting to leave its starting terminus is shown once it's this close. */
const TERMINUS_SHOW_MS = 3 * 60_000;
/** Used when the timetable has no figure for a hop. */
const FALLBACK_HOP_MS = 2 * 60_000;
/** Used when the timetable has no dwell figure for the line. */
const FALLBACK_DWELL_MS = 30_000;
/** However short the hop, a train is on the move at least this long, so it never teleports. */
const MIN_RUN_MS = 20_000;

export interface TrainEstimate {
  /** Stable across polls for one physical train, so the map can follow it. */
  id: string;
  line: TrainLine;
  trainNo: string;
  /** Terminus the train is heading to (the platform's direction). */
  towardCode: string;
  /** The stop it last passed and the one it is heading for; equal when it is at a station. */
  fromCode: string;
  toCode: string;
  /** 0 at `fromCode`, 1 at `toCode`. */
  fraction: number;
  /**
   * Two adjacent stops, in the order the train travels between them: the
   * direction it is facing. Equal to [fromCode, toCode] while moving; at a
   * station it is the hop leaving it (or, at the end of the line, the hop
   * the train just arrived by).
   */
  heading: [string, string];
  /** The next stop it is due at and when (epoch ms, server clock); null once it has reached its last known stop. */
  next: { code: string; at: number } | null;
}

type HopTable = { dwell: number; hops: Record<string, number> } | undefined;

function hopMs(line: TrainLine, a: string, b: string): number {
  const table = (hopTimes.lines as Record<string, HopTable>)[line];
  const run = table?.hops[a < b ? `${a}|${b}` : `${b}|${a}`];
  return run === undefined ? FALLBACK_HOP_MS : (run + table!.dwell) * 60_000;
}

/** How long a train stands at a platform before it pulls out. */
function dwellMs(line: TrainLine): number {
  const table = (hopTimes.lines as Record<string, HopTable>)[line];
  return table ? table.dwell * 60_000 : FALLBACK_DWELL_MS;
}

/** Smooth start and stop: a train accelerates out of a station and brakes into the next. */
const ease = (t: number) => t * t * (3 - 2 * t);

interface Sighting {
  /** Position along the direction of travel: station index times direction. */
  u: number;
  /** When the train is due at that station (epoch ms, server clock). */
  at: number;
}

interface Group {
  line: TrainLine;
  trainNo: string;
  /** +1 towards the end of the sequence, -1 towards its start. */
  dir: 1 | -1;
  towardCode: string;
  sightings: Map<number, number>;
}

function lineOf(directionKey: string): TrainLine | null {
  return TRAIN_LINES.find((l) => SEQUENCE[l].includes(directionKey)) ?? null;
}

function collect(arrivals: Record<string, Arrivals>, now: number): Group[] {
  const groups = new Map<string, Group>();
  for (const [code, entry] of Object.entries(arrivals)) {
    // Only readings that are still live: extrapolating a position from
    // last-known times would show trains where they no longer are.
    if (!isFresh(entry.timestamp, now)) continue;
    const dataAt = now - ageMs(entry.timestamp, now);
    for (const platform of entry.platforms) {
      const line = lineOf(platform.direction_key);
      if (!line) continue;
      const seq = SEQUENCE[line];
      const idx = seq.indexOf(code);
      const target = seq.indexOf(platform.direction_key);
      if (idx < 0) continue;
      // A platform "towards" its own station is the arrival side of a
      // terminus: trains there are heading for the end of the line.
      const dir: 1 | -1 = target > idx ? 1 : target < idx ? -1 : idx === 0 ? -1 : 1;
      for (const train of platform.trains) {
        const eta = train.eta_precise ?? train.eta_minutes;
        if (typeof eta !== "number" || !Number.isFinite(eta) || eta < 0) continue;
        const key = `${line}:${train.train_no}:${dir}`;
        let group = groups.get(key);
        if (!group) {
          group = { line, trainNo: train.train_no, dir, towardCode: platform.direction_key, sightings: new Map() };
          groups.set(key, group);
        }
        const at = dataAt + eta * 60_000;
        const u = idx * dir;
        const known = group.sightings.get(u);
        if (known === undefined || at < known) group.sightings.set(u, at);
      }
    }
  }
  return [...groups.values()];
}

/** The timeline of a train as ordered (position, time) points, times never going backwards. */
function timeline(group: Group): Sighting[] {
  const points = [...group.sightings.entries()].map(([u, at]) => ({ u, at })).sort((a, b) => a.u - b.u);
  for (let i = 1; i < points.length; i++) points[i].at = Math.max(points[i].at, points[i - 1].at);
  return points;
}

/** Position `u` -> the stop it has passed, the stop it is heading for, and how far between them. */
function locate(group: Group, u: number): Pick<TrainEstimate, "fromCode" | "toCode" | "fraction" | "heading"> {
  const seq = SEQUENCE[group.line];
  const base = Math.floor(u);
  const fraction = u - base;
  const inRange = (n: number) => n * group.dir >= 0 && n * group.dir < seq.length;
  const at = (n: number) => seq[Math.min(Math.max(n * group.dir, 0), seq.length - 1)];
  if (fraction < 1e-6) {
    const here = at(base);
    // At a station: face along the next hop, or - on the last stop of the
    // line - along the hop it arrived by.
    const heading: [string, string] = inRange(base + 1) ? [here, at(base + 1)] : [at(base - 1), here];
    return { fromCode: here, toCode: here, fraction: 0, heading };
  }
  return { fromCode: at(base), toCode: at(base + 1), fraction, heading: [at(base), at(base + 1)] };
}

/** The station index (not direction-adjusted) a train will reach after `u`, or null past the line's end. */
function previous(group: Group, u: number): number | null {
  const idx = (u - 1) * group.dir;
  return idx >= 0 && idx < SEQUENCE[group.line].length ? u - 1 : null;
}

/**
 * Estimate every live train's position at `now` (server clock). Trains with no
 * recent sighting, or that can't be placed with confidence, are left out
 * rather than guessed at.
 */
export function estimateTrains(arrivals: Record<string, Arrivals>, now: number): TrainEstimate[] {
  const groups = collect(arrivals, now);
  const timelines = new Map(groups.map((g) => [g, timeline(g)]));
  const byKey = new Map(groups.map((g) => [`${g.line}:${g.trainNo}:${g.dir}`, g]));
  const out: TrainEstimate[] = [];

  for (const group of groups) {
    const points = timelines.get(group)!;
    if (points.length === 0) continue;
    const first = points[0];
    const last = points[points.length - 1];
    const seq = SEQUENCE[group.line];
    const stationAt = (u: number) => seq[u * group.dir];

    // The same physical train turns round at a terminus: it arrives there as
    // one group and leaves as the opposite one. Draw it once - as the
    // arriving group until that has played out.
    const arriving = byKey.get(`${group.line}:${group.trainNo}:${-group.dir}`);
    const arrivingPoints = arriving ? timelines.get(arriving)! : null;
    if (
      arrivingPoints &&
      arrivingPoints.length > 0 &&
      seq[arrivingPoints[arrivingPoints.length - 1].u * arriving!.dir] === stationAt(first.u) &&
      now < arrivingPoints[arrivingPoints.length - 1].at + LINGER_MS
    ) {
      continue;
    }

    // Before the first sighting the train is on the hop leading to it.
    const prevU = previous(group, first.u);
    const pts = [...points];
    if (prevU !== null) {
      pts.unshift({ u: prevU, at: first.at - hopMs(group.line, stationAt(prevU), stationAt(first.u)) });
    }

    // A stop for every station between the first and last point, so the train
    // can stand at each one. The feed may skip one; its time is then shared
    // out in proportion to the timetable's running times.
    const stops: Sighting[] = [];
    for (let i = 0; i < pts.length; i++) {
      stops.push(pts[i]);
      const nextPoint = pts[i + 1];
      if (!nextPoint || nextPoint.u - pts[i].u <= 1) continue;
      const weights: number[] = [];
      for (let k = pts[i].u; k < nextPoint.u; k++) weights.push(hopMs(group.line, stationAt(k), stationAt(k + 1)));
      const total = weights.reduce((a, b) => a + b, 0);
      let sum = 0;
      for (let k = 0; k < weights.length - 1; k++) {
        sum += weights[k];
        stops.push({ u: pts[i].u + k + 1, at: pts[i].at + ((nextPoint.at - pts[i].at) * sum) / total });
      }
    }

    let u: number;
    let next: TrainEstimate["next"] = null;
    const stop = (point: Sighting) => ({ code: stationAt(point.u), at: point.at });
    if (now < stops[0].at) {
      // Not yet on the track we can see.
      if (prevU !== null && stops[0].at - now > PRE_ROLL_MS) continue;
      if (prevU === null && stops[0].at - now > TERMINUS_SHOW_MS) continue;
      u = stops[0].u;
      next = stop(points[0]);
    } else if (now >= last.at) {
      if (now - last.at > LINGER_MS) continue;
      u = last.u;
    } else {
      let i = 0;
      while (i < stops.length - 2 && now >= stops[i + 1].at) i++;
      const here = stops[i];
      const ahead = stops[i + 1];
      next = stop(ahead);
      // It stands at `here` for the dwell time, then runs to `ahead`.
      const departs = Math.max(here.at, Math.min(here.at + dwellMs(group.line), ahead.at - MIN_RUN_MS));
      u = now < departs ? here.u : here.u + ease((now - departs) / (ahead.at - departs)) * (ahead.u - here.u);
    }

    out.push({
      id: `${group.line}:${group.trainNo}:${group.dir}`,
      line: group.line,
      trainNo: group.trainNo,
      towardCode: group.towardCode,
      ...locate(group, u),
      next,
    });
  }
  return out;
}
