import { shownCode, stations, type LineKey, type Station } from "@/data/stations";
import { fullLineSegments, trackBetween, type LatLon, type LineSegments } from "@/lib/line-geometry";
import { LINE_COLORS } from "@/lib/line-colors";
import type { Lang } from "@/lib/i18n";
import type { PathResult } from "@/lib/transit-graph";

/**
 * Everything both maps need to know about *what* to draw, with no knowledge of
 * *how*. MapLibre turns these into GeoJSON layers, Google into markers and
 * polylines; keeping the decisions here (which stations dim, how big a dot is,
 * which label text shows, where the camera must leave room for the sheet) is
 * what stops the two renderers drifting apart. Coordinates are [lat, lon].
 */

/** Start/destination accent colour: the fill of the start, the ring of the destination. */
export const ENDPOINT_COLOR = "#16a34a";

/** Station dot scale for the "marker size" setting. */
export const MARKER_FACTOR = { small: 0.75, medium: 1, large: 1.35 } as const;

export const lineKeys: LineKey[] = [...new Set(stations.flatMap((s) => s.lines.map((l) => l.line)))];

/** The line-brand color for a station's primary line, or a neutral fallback. */
export function stationLineColor(station: Station, hidden: readonly LineKey[] = []): string {
  // The first line still on the map, so an interchange doesn't keep the colour of a hidden line.
  const line = station.lines.find((l) => !hidden.includes(l.line)) ?? station.lines[0];
  return line ? LINE_COLORS[line.line] : "#666";
}

export interface LineTrack {
  line: LineKey;
  points: LatLon[];
}

/** Every drawn piece of every line: curved track when it is known, straight station-to-station otherwise. */
export function lineTracks(segmentsByLine: LineSegments): LineTrack[] {
  return lineKeys.flatMap((line) => fullLineSegments(segmentsByLine, line).map((points) => ({ line, points })));
}

export interface RoutePart {
  /** The line ridden, or "" for a walk. */
  line: string;
  walk: boolean;
  points: LatLon[];
}

/** One part per leg: rides follow the real track, a walking transfer is a short straight dashed line. */
export function routeParts(path: PathResult, segmentsByLine: LineSegments): RoutePart[] {
  return path.legs.slice(1).map((leg, i) => {
    const prev = path.legs[i].station;
    const points =
      leg.mode === "ride" && leg.line
        ? trackBetween(segmentsByLine, leg.line, prev, leg.station)
        : ([
            [prev.lat, prev.lon],
            [leg.station.lat, leg.station.lon],
          ] as LatLon[]);
    return { line: leg.line ?? "", walk: leg.mode === "walk", points };
  });
}

export interface StationVisual {
  station: Station;
  code: string;
  /** The operator's code, which is what labels show. */
  shownCode: string;
  nameEn: string;
  nameTh: string;
  /** Lower wins label collisions: route ends, then the route, then interchanges, then the rest. */
  sortKey: number;
  labelOpacity: number;
  /** Dot radius in px at the medium marker size. */
  radius: number;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string;
  fillOpacity: number;
  isStart: boolean;
  isDestination: boolean;
  dimmed: boolean;
}

/** The stations to draw and how each looks given the route, its ends and the hidden lines. */
export function stationVisuals(
  pathCodes: ReadonlySet<string>,
  startCode: string | null,
  destinationCode: string | null,
  isRouting: boolean,
  hiddenLines: readonly LineKey[] = [],
): StationVisual[] {
  return (
    stations
      // A station disappears only when every line through it is hidden; the
      // ends and stops of a planned route always stay.
      .filter(
        (s) =>
          hiddenLines.length === 0 ||
          pathCodes.has(s.code) ||
          s.code === startCode ||
          s.code === destinationCode ||
          s.lines.some((l) => !hiddenLines.includes(l.line)),
      )
      .map((s) => {
        const onPath = pathCodes.has(s.code);
        const isStart = s.code === startCode;
        const isDestination = s.code === destinationCode;
        const isEndpoint = isStart || isDestination;
        const dimmed = isRouting && !onPath;
        return {
          station: s,
          code: s.code,
          shownCode: shownCode(s),
          nameEn: s.nameEn,
          nameTh: s.nameTh || s.nameEn,
          sortKey: isEndpoint ? 0 : onPath ? 1 : s.lines.length > 1 ? 2 : 3,
          labelOpacity: dimmed ? 0.45 : 1,
          radius: isEndpoint ? 8 : s.lines.length > 1 ? 6 : 4,
          // Green fill = start, white fill/green outline = destination, so
          // the two ends of the route are distinguishable at a glance.
          strokeColor: dimmed ? "#ccc" : isEndpoint ? ENDPOINT_COLOR : "#fff",
          strokeWidth: isEndpoint ? 4 : 1.5,
          fillColor: dimmed ? "#ddd" : isStart ? ENDPOINT_COLOR : stationLineColor(s, hiddenLines),
          fillOpacity: dimmed ? 0.7 : 1,
          isStart,
          isDestination,
          dimmed,
        };
      })
  );
}

export type LabelLanguage = "ui" | "en" | "th" | "both";

/** The text of a station label: the name(s) always, the code once zoomed in far enough. */
export interface LabelText {
  primary: string;
  /** The second language, smaller, when labels show both. */
  secondary?: string;
  code?: string;
}

/** Zoom (on MapLibre's scale) from which the code joins the name - there is room for a second line by then. */
export const LABEL_CODE_ZOOM = 14;

export function labelText(
  station: Pick<Station, "nameEn" | "nameTh" | "code" | "displayCode">,
  uiLang: Lang,
  labelLanguage: LabelLanguage,
  withCode: boolean,
): LabelText {
  const th = station.nameTh || station.nameEn;
  const code = withCode ? (station.displayCode ?? station.code) : undefined;
  if (labelLanguage === "both") return { primary: station.nameEn, secondary: th, code };
  const lang: Lang = labelLanguage === "ui" ? uiLang : labelLanguage;
  return { primary: lang === "th" ? th : station.nameEn, code };
}

/**
 * Google's zoom numbers run one ahead of MapLibre's (256 px tiles against 512),
 * and every zoom setting in this app is on MapLibre's scale.
 */
export const googleToMapLibreZoom = (zoom: number): number => zoom - 1;
export const mapLibreToGoogleZoom = (zoom: number): number => zoom + 1;

/**
 * Padding that keeps a fitted route in the part of the map the route sheet
 * (fixed to the bottom of the screen, up to 70 vh) leaves uncovered.
 * `mapBottom` and `mapHeight` are the map element's rect, `viewportHeight` the window's.
 */
export function routeFitPadding(
  sheetOpen: boolean,
  mapBottom: number,
  mapHeight: number,
  viewportHeight: number,
): { top: number; left: number; right: number; bottom: number } {
  const sheetTop = viewportHeight * 0.3;
  const covered = sheetOpen ? Math.max(0, mapBottom - sheetTop) : 0;
  // Never pad away the whole map (the fit refuses then).
  const bottom = Math.min(covered + 24, mapHeight - 120);
  return { top: 40, left: 40, right: 40, bottom: Math.max(40, bottom) };
}

/** Bounding box of a route's stops as [[minLon, minLat], [maxLon, maxLat]]. */
export function routeBounds(path: PathResult): [[number, number], [number, number]] {
  const lons = path.legs.map((l) => l.station.lon);
  const lats = path.legs.map((l) => l.station.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

/** Room for a card above a focused station, and for the header and pills. */
export const FOCUS_PADDING = { top: 200, bottom: 90, left: 40, right: 40 } as const;
/** Zoom a lone picked station is brought to at least, and the closest two ends of a route are fitted. (MapLibre scale.) */
export const FOCUS_ZOOM_FLOOR = 13;
export const FOCUS_ZOOM_CAP = 15;
/** Zoom the "locate me" button and a picked place fly to at least. (MapLibre scale.) */
export const LOCATE_ZOOM = 16;
export const PLACE_ZOOM = 15;
