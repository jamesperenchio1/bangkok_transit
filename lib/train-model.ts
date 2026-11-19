import { stations } from "@/data/stations";
import { serverNow } from "@/lib/arrivals-store";
import { stationName, strings, useLangStore } from "@/lib/i18n";
import { LINE_NAMES } from "@/lib/line-colors";
import { haversineMeters, trackBetween, type LatLon, type LineSegments } from "@/lib/line-geometry";
import type { TrainEstimate, TrainLine } from "@/lib/live-trains";

/**
 * What a live train looks like and says, independent of the map library that
 * draws it: where it is along its real track, which way it faces, the text on
 * its label and card, and the shape of its arrow. MapLibre (components/
 * live-trains-layer.ts) and Google (components/GoogleTransitMap.tsx) both read
 * this, so the two maps cannot disagree about a train.
 */

const stationsByCode = new Map(stations.map((s) => [s.code, s]));

/** The icon's coordinate space: a 44 px square, tip up. */
export const TRAIN_ICON_SIZE = 44;
/**
 * A bold navigation arrow, tip up, so direction reads from the shape alone.
 * Drawn with a dark navy fill, a thick white outline and a thin dark edge
 * outside that, which keeps at least 3:1 contrast (WCAG 1.4.11) against light,
 * dark, green and water basemap pixels alike. Colour never carries meaning
 * here: the text label and the card do.
 */
export const TRAIN_ARROW_PATH = "M22 4 L38 38 L22 30 L6 38 Z";

export const TRAIN_SIZE_FACTOR = { small: 0.75, medium: 1, large: 1.3 } as const;

/** Radius of the tap target around each train: 22 px is a 44 px circle, the WCAG 2.5.8 minimum. */
export const TRAIN_TAP_RADIUS_PX = 24;

/** ~4 fps: a train moves a few pixels a second, so this reads as smooth without a render loop. */
export const TRAIN_FRAME_MS = 250;
/** For people who ask for less motion, or the battery saver: positions still refresh, just without a steady glide. */
export const TRAIN_SLOW_FRAME_MS = 5_000;

/** Smaller than this on screen is invisible: not worth a map render. */
export const VISIBLE_MOVE_PX = 0.75;
/** A turn smaller than this is not visible on a train icon. */
export const VISIBLE_TURN_DEG = 5;

/** How a train's label and arrow scale with zoom (MapLibre scale): [zoom, scale at factor 1]. */
export const TRAIN_ZOOM_STOPS: readonly (readonly [number, number])[] = [
  [9, 0.5],
  [12, 0.65],
  [15, 0.85],
  [17, 1],
];
/** The text beside a train shows from this zoom (MapLibre scale). */
export const TRAIN_LABEL_ZOOM = 14;

/** Arrow scale at a zoom, by linear interpolation between the stops, times the size setting. */
export function trainScale(zoom: number, factor: number): number {
  const stops = TRAIN_ZOOM_STOPS;
  if (zoom <= stops[0][0]) return stops[0][1] * factor;
  for (let i = 1; i < stops.length; i++) {
    const [z1, s1] = stops[i];
    if (zoom <= z1) {
      const [z0, s0] = stops[i - 1];
      return (s0 + ((s1 - s0) * (zoom - z0)) / (z1 - z0)) * factor;
    }
  }
  return stops[stops.length - 1][1] * factor;
}

interface Track {
  /** [lon, lat] points, the order MapLibre wants. */
  points: [number, number][];
  /** Metres from the start to each point. */
  along: number[];
}

export interface PlacedTrain {
  /** [lon, lat]. */
  at: [number, number];
  /** Compass degrees clockwise from north. */
  bearing: number;
}

/** Compass bearing (degrees clockwise from north) of the step from point i-1 to i. */
function bearing(track: Track, i: number): number {
  const [x0, y0] = track.points[i - 1];
  const [x1, y1] = track.points[i];
  const east = (x1 - x0) * Math.cos(((y0 + y1) / 2) * (Math.PI / 180));
  const north = y1 - y0;
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

/** A placer with its own cache of the tracks between stations; make one per map. */
export function createTrainPlacer() {
  const tracks = new Map<string, Track>();

  function trackFor(line: TrainLine, fromCode: string, toCode: string, segments: LineSegments): Track | null {
    const key = `${line}|${fromCode}|${toCode}`;
    const cached = tracks.get(key);
    if (cached) return cached;
    const from = stationsByCode.get(fromCode);
    const to = stationsByCode.get(toCode);
    if (!from || !to) return null;
    const latLons: LatLon[] = trackBetween(segments, line, from, to);
    const points = latLons.map(([lat, lon]): [number, number] => [lon, lat]);
    const along = [0];
    for (let i = 1; i < latLons.length; i++) along.push(along[i - 1] + haversineMeters(latLons[i - 1], latLons[i]));
    const track = { points, along };
    tracks.set(key, track);
    return track;
  }

  /** Where the train is and which way it faces, both along the real track. */
  return function place(train: TrainEstimate, segments: LineSegments): PlacedTrain | null {
    const [fromCode, toCode] = train.heading;
    const track = trackFor(train.line, fromCode, toCode, segments);
    if (!track || track.points.length < 2) return null;

    if (train.fromCode === train.toCode) {
      // At a station: on its marker, facing along the hop it leaves by (or
      // arrived by, at the end of the line).
      const s = stationsByCode.get(train.fromCode);
      if (!s) return null;
      const last = train.fromCode === toCode;
      return { at: [s.lon, s.lat], bearing: bearing(track, last ? track.points.length - 1 : 1) };
    }

    const target = track.along[track.along.length - 1] * train.fraction;
    let i = 1;
    while (i < track.along.length - 1 && track.along[i] < target) i++;
    const span = track.along[i] - track.along[i - 1];
    const t = span > 0 ? (target - track.along[i - 1]) / span : 0;
    const [x0, y0] = track.points[i - 1];
    const [x1, y1] = track.points[i];
    return { at: [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t], bearing: bearing(track, i) };
  };
}

/** The on-map label (line and destination) and the screen-reader sentence for a train. */
export function summariseTrain(train: TrainEstimate): { label: string; sentence: string } {
  const lang = useLangStore.getState().lang;
  const t = strings[lang];
  const toward = stationsByCode.get(train.towardCode);
  const next = train.next ? stationsByCode.get(train.next.code) : undefined;
  const towardName = toward ? stationName(toward, lang) : "";
  const lineName = LINE_NAMES[train.line];
  return {
    label: towardName ? `${lineName} · ${towardName}` : lineName,
    sentence: t.trainItem(lineName, train.trainNo, towardName, next ? stationName(next, lang) : ""),
  };
}

export interface TrainDescription {
  title: string;
  toward: string;
  /** "" when the next stop is unknown. */
  next: string;
}

/** The text of a train's card. */
export function describeTrain(train: TrainEstimate): TrainDescription {
  const lang = useLangStore.getState().lang;
  const t = strings[lang];
  const toward = stationsByCode.get(train.towardCode);
  const nextStation = train.next ? stationsByCode.get(train.next.code) : undefined;
  let next = "";
  if (train.next && nextStation) {
    const minutes = Math.ceil((train.next.at - serverNow()) / 60_000);
    next = t.trainNext(stationName(nextStation, lang), minutes <= 0 ? t.arriving : t.min(minutes));
  }
  return {
    title: t.trainNo(train.trainNo),
    toward: toward ? t.trainToward(stationName(toward, lang)) : "",
    next,
  };
}

/** A turn smaller than VISIBLE_TURN_DEG, in degrees, between two bearings. */
export function turnBetween(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}
