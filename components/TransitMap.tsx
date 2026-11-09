"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LocateFixed } from "lucide-react";
import { shownCode, stations, type LineKey, type Station } from "@/data/stations";
import {
  fetchLineGeometry,
  fullLineSegments,
  loadedLineGeometry,
  loadLineGeometryInBackground,
  stationLineSegments,
  trackBetween,
  type LineSegments,
} from "@/lib/line-geometry";
import { markMapPainted } from "@/lib/map-ready";
import type { GeoPosition } from "@/lib/use-geolocation";
import type { PathResult } from "@/lib/transit-graph";
import { StationActions } from "@/components/StationActions";
import { distanceLabel, nearestStation } from "@/lib/nearest-station";
import type { Place } from "@/lib/place-search";
import { applyTrainStyle, startLiveTrainsWhenIdle } from "@/components/live-trains-layer";
import { routeHops } from "@/lib/live-trains";
import { LINE_COLORS, readableTextColor } from "@/lib/line-colors";
import { stationName, useLangStore, useT, type Lang } from "@/lib/i18n";
import { motionDuration, useSettingsStore } from "@/lib/settings-store";

// MapLibre uses [lon, lat] everywhere, the opposite of Leaflet's [lat, lon] -
// every coordinate pair in this file is in that order.
const STATION_BOUNDS: [[number, number], [number, number]] = [
  [Math.min(...stations.map((s) => s.lon)), Math.min(...stations.map((s) => s.lat))],
  [Math.max(...stations.map((s) => s.lon)), Math.max(...stations.map((s) => s.lat))],
];

// Also preloaded from app/layout.tsx (MAP_STYLE_URL) so the style JSON
// downloads while the page hydrates - keep the two URLs identical.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/**
 * What the map shows when the basemap style cannot be loaded: a plain ground
 * colour. Glyphs still point at the basemap's font server, so station names
 * appear whenever it is reachable (or its fonts are cached).
 */
const FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {},
  layers: [{ id: "fallback-background", type: "background", paint: { "background-color": "#f2efe9" } }],
};

/** Camera animations collapse to instant jumps for people who ask for less motion. */
const motionMs = motionDuration;

// Basemap layers this app has no use for. `poi_transit` is the basemap's own
// station icons/names, which would duplicate (and fight for space with) our
// labelled station markers; 3D buildings and the dense low-rank POI layers
// only cost GPU/decode time on phones without helping anyone find a station.
const DROPPED_STYLE_LAYERS = new Set(["poi_transit", "building-3d", "poi_r20", "poi_r7"]);

// The basemap labels places in both scripts at once ("Phetchaburi
// เพชรบุรี"); every layer that does so references `name:latin`. Those get
// swapped for a single-language field matching the EN/TH toggle; their ids
// are recorded so the toggle can find them again after the swap.
const basemapLabelLayers = new Set<string>();

function isBilingualLabel(layer: maplibregl.LayerSpecification): boolean {
  return layer.type === "symbol" && JSON.stringify(layer.layout?.["text-field"] ?? "").includes("name:latin");
}

function basemapLabelField(lang: Lang): maplibregl.ExpressionSpecification {
  return lang === "th"
    ? ["coalesce", ["get", "name:th"], ["get", "name:nonlatin"], ["get", "name"]]
    : ["coalesce", ["get", "name:latin"], ["get", "name_en"], ["get", "name"]];
}

// The basemap's icon sprite (road shields, POI icons), held back from the style
// and attached once our network is on screen - see `deferSprite` below.
let deferredSprite: maplibregl.SpriteSpecification | undefined;

function transformStyle(
  _previous: maplibregl.StyleSpecification | undefined,
  next: maplibregl.StyleSpecification,
): maplibregl.StyleSpecification {
  const lang = useLangStore.getState().lang;
  // Taken out of the style so MapLibre doesn't fetch the 117 KB sprite image
  // alongside the files the first draw needs; on a slow link that download
  // costs the network ~0.6 s (4G) to ~2 s (3G) of bandwidth. It arrives after
  // the first draw instead, and the basemap's icons appear a moment later.
  const { sprite, ...style } = next;
  if (sprite) deferredSprite = sprite;
  return {
    ...style,
    layers: next.layers
      .filter((layer) => !DROPPED_STYLE_LAYERS.has(layer.id))
      .map((layer) => {
        if (!isBilingualLabel(layer) || layer.type !== "symbol") return layer;
        basemapLabelLayers.add(layer.id);
        return { ...layer, layout: { ...layer.layout, "text-field": basemapLabelField(lang) } };
      }),
  };
}

/** Our own station labels: the name in the chosen language, plus the code once zoomed in. */
function stationLabelField(lang: Lang, codes = true, both = false): maplibregl.ExpressionSpecification {
  const nameOf = (l: Lang) => ["get", l === "th" ? "nameTh" : "nameEn"] as maplibregl.ExpressionSpecification;
  // `format` cannot nest, so each variant is one flat `format`: the name (and,
  // for "both", the second language, smaller) then, zoomed in, the code.
  const parts = (withCode: boolean): unknown[] => {
    const out: unknown[] = both
      ? [nameOf("en"), {}, "\n", {}, nameOf("th"), { "font-scale": 0.85 }]
      : [nameOf(lang), {}];
    if (withCode) out.push("\n", {}, ["get", "shownCode"], { "font-scale": 0.8 });
    return out;
  };
  const plain = both ? (["format", ...parts(false)] as unknown as maplibregl.ExpressionSpecification) : nameOf(lang);
  if (!codes) return plain;
  return ["step", ["zoom"], plain, 14, ["format", ...parts(true)]] as unknown as maplibregl.ExpressionSpecification;
}

const MARKER_FACTOR = { small: 0.75, medium: 1, large: 1.35 } as const;

// Start/destination marker accent color, shared by the station GeoJSON
// builder, the destination dashed-ring icon, and the popup content.
const ENDPOINT_COLOR = "#16a34a";

// MapLibre's `new Worker(new URL('./maplibre-gl-worker.mjs', import.meta.url))`
// pattern doesn't resolve correctly under Next's bundler (Turbopack or
// webpack) from inside node_modules - the request 404s, so tiles never load
// and no error ever surfaces. Point it at a plain static copy instead (see
// scripts/copy-maplibre-worker.mjs, run on every `npm install`).
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export interface TransitMapProps {
  onSelectStation: (station: Station) => void;
  onSetStart: (station: Station) => void;
  onSetDestination: (station: Station) => void;
  startCode: string | null;
  destinationCode: string | null;
  path: PathResult | null;
  userPosition: GeoPosition | null;
  /** Set (e.g. from a search result) to fly the map to a station on demand. */
  focusStation: Station | null;
  /** Set (from a place search result) to show a place and its nearest station. */
  focusPlace: Place | null;
  /** Whether the route sheet covers the bottom of the screen (up to 70vh). */
  sheetOpen: boolean;
}

const LINES_SOURCE = "transit-lines";
const LINES_LAYER = "transit-lines-layer";
const ROUTE_SOURCE = "highlighted-route";
const ROUTE_LAYER = "highlighted-route-layer";
const ROUTE_WALK_LAYER = "highlighted-route-walk-layer";
const STATIONS_SOURCE = "stations";
const STATIONS_HIT_LAYER = "stations-hit-layer";
const STATIONS_LAYER = "stations-layer";
const STATIONS_LABEL_LAYER = "stations-label-layer";
const DEST_RING_ICON = "destination-ring-icon";
const DEST_RING_LAYER = "destination-ring-layer";
const GPS_SOURCE = "gps-position";
const GPS_ACCURACY_SOURCE = "gps-accuracy";
const GPS_RING_LAYER = "gps-ring-layer";
const GPS_RING_OUTLINE_LAYER = "gps-ring-outline-layer";
const GPS_DOT_LAYER = "gps-dot-layer";

const lineKeys = [...new Set(stations.flatMap((s) => s.lines.map((l) => l.line)))];

const LINE_COLOR_MATCH = [
  "match",
  ["get", "line"],
  ...lineKeys.flatMap((line) => [line, LINE_COLORS[line]]),
  "#666",
] as unknown as maplibregl.ExpressionSpecification;

/** The line-brand color for a station's primary line, or a neutral fallback. */
function stationLineColor(station: Station, hidden: readonly LineKey[] = []): string {
  // The first line still on the map, so an interchange doesn't keep the colour of a hidden line.
  const line = station.lines.find((l) => !hidden.includes(l.line)) ?? station.lines[0];
  return line ? LINE_COLORS[line.line] : "#666";
}

function baseLinesGeoJSON(segmentsByLine: LineSegments): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: lineKeys.flatMap((line) =>
      fullLineSegments(segmentsByLine, line).map((positions) => ({
        type: "Feature",
        properties: { line },
        geometry: {
          type: "LineString",
          coordinates: positions.map(([lat, lon]) => [lon, lat]),
        },
      })),
    ),
  };
}

function routeGeoJSON(
  path: PathResult,
  segmentsByLine: LineSegments,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: path.legs.slice(1).map((leg, i) => {
      const prevStation = path.legs[i].station;
      // Rides follow the real track; a walking transfer is a short straight
      // dashed line between the two stations.
      const positions =
        leg.mode === "ride" && leg.line
          ? trackBetween(segmentsByLine, leg.line, prevStation, leg.station)
          : [
              [prevStation.lat, prevStation.lon],
              [leg.station.lat, leg.station.lon],
            ];
      return {
        type: "Feature" as const,
        properties: { line: leg.line ?? "", walk: leg.mode === "walk" },
        geometry: {
          type: "LineString" as const,
          coordinates: positions.map(([lat, lon]) => [lon, lat]),
        },
      };
    }),
  };
}

function stationsGeoJSON(
  pathCodes: Set<string>,
  startCode: string | null,
  destinationCode: string | null,
  isRouting: boolean,
  hiddenLines: readonly LineKey[] = [],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: stations
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
      // Lower sorts first and so wins label collisions: route ends, then the
      // rest of the route, then interchanges, then everything else.
      const sortKey = isEndpoint ? 0 : onPath ? 1 : s.lines.length > 1 ? 2 : 3;
      return {
        type: "Feature",
        properties: {
          code: s.code, // the id: clicks look the station up by it
          shownCode: shownCode(s), // the operator's code, which is what the label shows
          nameEn: s.nameEn,
          nameTh: s.nameTh || s.nameEn,
          sortKey,
          labelOpacity: dimmed ? 0.45 : 1,
          radius: isEndpoint ? 8 : s.lines.length > 1 ? 6 : 4,
          // Green fill = start, white fill/green outline = destination, so
          // the two ends of the route are distinguishable at a glance.
          strokeColor: dimmed ? "#ccc" : isEndpoint ? ENDPOINT_COLOR : "#fff",
          strokeWidth: isEndpoint ? 4 : 1.5,
          fillColor: dimmed ? "#ddd" : isStart ? ENDPOINT_COLOR : stationLineColor(s, hiddenLines),
          fillOpacity: dimmed ? 0.7 : 1,
          isDestination,
        },
        geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      };
    }),
  };
}

function gpsGeoJSON(position: GeoPosition | null): GeoJSON.FeatureCollection<GeoJSON.Point> {
  if (!position) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [position.lon, position.lat] },
      },
    ],
  };
}

/**
 * The accuracy estimate as a real circle on the ground (radius = the
 * browser's reported accuracy in meters), like Google Maps: it grows and
 * shrinks with the map as you zoom, so you can see how big the uncertainty
 * actually is relative to streets and stations. A screen-pixel circle can't
 * do that. A flat-earth offset is plenty accurate at these radii.
 */
function gpsAccuracyGeoJSON(position: GeoPosition | null): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  if (!position || !(position.accuracy > 0)) return { type: "FeatureCollection", features: [] };
  const STEPS = 64;
  const metersPerDegLat = 111_320;
  const metersPerDegLon = metersPerDegLat * Math.cos((position.lat * Math.PI) / 180);
  const ring: [number, number][] = [];
  for (let i = 0; i <= STEPS; i++) {
    const angle = (i / STEPS) * 2 * Math.PI;
    ring.push([
      position.lon + (position.accuracy * Math.cos(angle)) / metersPerDegLon,
      position.lat + (position.accuracy * Math.sin(angle)) / metersPerDegLat,
    ]);
  }
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }],
  };
}

export function TransitMap({
  onSelectStation,
  onSetStart,
  onSetDestination,
  startCode,
  destinationCode,
  path,
  userPosition,
  focusStation,
  focusPlace,
  sheetOpen,
}: TransitMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const geometryRef = useRef<LineSegments | null>(null);
  const stopTrainsRef = useRef<(() => void) | null>(null);
  const stopGeometryRef = useRef<(() => void) | null>(null);
  const dimmedRef = useRef(false);
  // The hops the planned route rides, for the trains layer (null: no route).
  const routeHopsRef = useRef<Set<string> | null>(null);
  const popupsRef = useRef(new Map<string, { popup: maplibregl.Popup; root: Root; render: () => void }>());

  const pathCodes = useMemo(
    () => new Set(path?.legs.map((leg) => leg.station.code) ?? []),
    [path],
  );
  const isRouting = path !== null;
  const routeHopsSet = useMemo(() => (path ? routeHops(path.legs) : null), [path]);
  useEffect(() => {
    routeHopsRef.current = routeHopsSet;
  }, [routeHopsSet]);
  const { lang, t } = useT();
  const settings = useSettingsStore((s) => s.settings);
  const { hiddenLines } = settings;

  // Keep the latest callbacks/state in refs so the map's own click handler
  // (registered once, at style-load time) always sees current values without
  // needing to be re-registered on every render.
  const latest = useRef({
    onSelectStation,
    onSetStart,
    onSetDestination,
    startCode,
    destinationCode,
  });
  useEffect(() => {
    latest.current = { onSelectStation, onSetStart, onSetDestination, startCode, destinationCode };
  });

  // Create the map once per mount. Like the Leaflet canvas renderer this
  // replaces, a maplibregl.Map binds to exactly one container/GL context for
  // its life - creating it fresh per mount (not as a module-level singleton)
  // avoids the same class of stale-binding bug under React Strict Mode's
  // dev double-mount.
  useEffect(() => {
    if (!containerRef.current) return;
    const popups = popupsRef.current;
    const map = new maplibregl.Map({
      container: containerRef.current,
      // Start on the station bounds directly rather than a fixed
      // center/zoom that fitBounds then replaces: otherwise the first round
      // of tiles is fetched for a view that's thrown away immediately.
      bounds: STATION_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      clickTolerance: 15,
      attributionControl: { compact: true },
    });
    // transformStyle is only accepted by setStyle, not the constructor - the
    // style is fetched once, here.
    map.setStyle(STYLE_URL, { transformStyle });
    mapRef.current = map;
    // If the basemap style itself can't be fetched (offline, never cached, or
    // the host is down), draw the network on a plain background rather than
    // showing nothing: the lines and stations are ours and need none of it.
    let styleReady = false;
    let fellBack = false;
    map.on("error", (e) => {
      const failed = (e.error as { url?: string } | undefined)?.url;
      if (styleReady || fellBack || !failed?.startsWith(STYLE_URL)) return;
      fellBack = true;
      map.setStyle(FALLBACK_STYLE);
    });
    // Exposed for debugging and the e2e suite, which asserts on rendered
    // features rather than pixels.
    (window as { __map?: maplibregl.Map }).__map = map;

    // Attach the basemap's sprite once the stations have been drawn: wait for
    // their source to finish loading, then for the next frame to render.
    const deferSprite = (e: maplibregl.MapSourceDataEvent) => {
      if (e.sourceId !== STATIONS_SOURCE || !e.isSourceLoaded) return;
      map.off("sourcedata", deferSprite);
      map.once("render", () => {
        if (mapRef.current !== map || !deferredSprite) return;
        if (typeof deferredSprite === "string") map.setSprite(deferredSprite);
        else for (const { id, url } of deferredSprite) map.addSprite(id, url);
      });
    };
    map.on("sourcedata", deferSprite);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.on("dragstart", (e: { originalEvent?: unknown }) => {
      if (e.originalEvent && useSettingsStore.getState().settings.followMe) {
        useSettingsStore.getState().update({ followMe: false });
      }
    });

    // Our own layers go on at `style.load`, not `load`. `load` waits for the
    // basemap's first tiles and fonts - on a slow connection the transit
    // network would stay invisible for as long as the third-party basemap
    // takes, though nothing here depends on it. The basemap fills in beneath.
    map.once("style.load", () => {
      styleReady = true;
      // The lines are drawn from the first frame. If the curved track has
      // already arrived (it is requested while the map's own code downloads)
      // it is used straight away; if not, the network is drawn as straight
      // station-to-station track from data already in the bundle and the
      // curves swap in when they land. Either way no line is ever missing or
      // left unconnected while waiting on a second download.
      const known = loadedLineGeometry();
      if (known) geometryRef.current = known;
      map.addSource(LINES_SOURCE, {
        type: "geojson",
        data: baseLinesGeoJSON(known ?? stationLineSegments()),
      });
      map.addLayer({
        id: LINES_LAYER,
        type: "line",
        source: LINES_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": LINE_COLOR_MATCH,
          "line-width": 4,
          "line-opacity": 0.9,
        },
      });
      if (!known) {
        stopGeometryRef.current = loadLineGeometryInBackground((segmentsByLine) => {
          // The component may have unmounted (and torn down `map`) before
          // this resolved - `mapRef` is nulled out in that cleanup.
          if (mapRef.current !== map) return;
          geometryRef.current = segmentsByLine;
          map.getSource<maplibregl.GeoJSONSource>(LINES_SOURCE)?.setData(baseLinesGeoJSON(segmentsByLine));
        });
      }

      map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: ROUTE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        filter: ["!=", ["get", "walk"], true],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": LINE_COLOR_MATCH,
          "line-width": 5,
          "line-opacity": 1,
        },
      });
      map.addLayer({
        id: ROUTE_WALK_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        filter: ["==", ["get", "walk"], true],
        layout: { "line-cap": "round" },
        paint: { "line-color": "#525252", "line-width": 3, "line-dasharray": [0.5, 1.5] },
      });

      map.addSource(STATIONS_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // Invisible, larger-radius layer used only for hit-testing - a real
      // fingertip is much wider than the smallest (4px) marker, and this
      // pads the tappable area without padding the drawn shape. Structural
      // equivalent of the old Leaflet canvas renderer's `tolerance` option.
      map.addLayer({
        id: STATIONS_HIT_LAYER,
        type: "circle",
        source: STATIONS_SOURCE,
        paint: {
          "circle-radius": ["+", ["get", "radius"], 12],
          "circle-opacity": 0,
        },
      });
      map.addLayer({
        id: STATIONS_LAYER,
        type: "circle",
        source: STATIONS_SOURCE,
        paint: {
          "circle-radius": ["get", "radius"],
          "circle-color": ["get", "fillColor"],
          "circle-opacity": ["get", "fillOpacity"],
          "circle-stroke-color": ["get", "strokeColor"],
          "circle-stroke-width": ["get", "strokeWidth"],
        },
      });
      // A dashed ring on the destination marker specifically, so it reads
      // as distinct from the start marker even without comparing fill
      // colors. MapLibre's circle layer has no native dashed-stroke paint
      // property (unlike Leaflet's dashArray), so this draws a small dashed
      // ring onto an offscreen canvas once and places it as a fixed-size
      // icon - screen-pixel-sized like the circle markers, not a geo-space
      // dashed line (which would scale oddly with zoom).
      if (!map.hasImage(DEST_RING_ICON)) {
        const size = 28;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.strokeStyle = ENDPOINT_COLOR;
          ctx.lineWidth = 3;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
          ctx.stroke();
          map.addImage(DEST_RING_ICON, ctx.getImageData(0, 0, size, size));
        }
      }
      map.addLayer({
        id: DEST_RING_LAYER,
        type: "symbol",
        source: STATIONS_SOURCE,
        filter: ["==", ["get", "isDestination"], true],
        layout: { "icon-image": DEST_RING_ICON, "icon-allow-overlap": true },
      });
      // Station names next to each marker. MapLibre's own collision
      // detection hides whichever labels would overlap, with sortKey
      // deciding who wins, so the zoomed-out view thins out on its own and
      // every name appears as you zoom in. Codes join the name once there's
      // room for a second line.
      map.addLayer({
        id: STATIONS_LABEL_LAYER,
        type: "symbol",
        source: STATIONS_SOURCE,
        minzoom: 11,
        layout: {
          "text-field": stationLabelField(useLangStore.getState().lang),
          "text-font": ["Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 14, 12, 16, 14],
          "text-variable-anchor": ["left", "right", "top", "bottom"],
          "text-radial-offset": 0.8,
          "text-justify": "auto",
          "text-max-width": 8,
          "text-padding": 2,
          "symbol-sort-key": ["get", "sortKey"],
        },
        paint: {
          "text-color": "#1f2937",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.6,
          "text-opacity": ["get", "labelOpacity"],
        },
      });

      // Estimated live train positions (BTS only), drawn under the station
      // names so labels stay readable. Fed from the arrivals the app already
      // holds, so it adds no requests (see lib/live-trains.ts).
      // Added after the map is idle, not here: the map comes first.
      stopTrainsRef.current = startLiveTrainsWhenIdle(map, STATIONS_LABEL_LAYER, {
        getSegments: () => geometryRef.current,
        stationHitLayer: STATIONS_HIT_LAYER,
        isDimmed: () => dimmedRef.current,
        getRouteHops: () => routeHopsRef.current,
      });

      map.addSource(GPS_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource(GPS_ACCURACY_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // Under the stations, so a wide (poor-fix) circle tints the map
      // without washing out the markers on top of it.
      map.addLayer(
        {
          id: GPS_RING_LAYER,
          type: "fill",
          source: GPS_ACCURACY_SOURCE,
          paint: { "fill-color": "#2563eb", "fill-opacity": 0.12 },
        },
        STATIONS_HIT_LAYER,
      );
      map.addLayer(
        {
          id: GPS_RING_OUTLINE_LAYER,
          type: "line",
          source: GPS_ACCURACY_SOURCE,
          paint: { "line-color": "#2563eb", "line-opacity": 0.35, "line-width": 1 },
        },
        STATIONS_HIT_LAYER,
      );
      map.addLayer({
        id: GPS_DOT_LAYER,
        type: "circle",
        source: GPS_SOURCE,
        paint: {
          "circle-radius": 7,
          "circle-color": "#2563eb",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
      });

      map.on("click", STATIONS_HIT_LAYER, (e: maplibregl.MapLayerMouseEvent) => {
        const code = e.features?.[0]?.properties?.code as string | undefined;
        const station = code ? stations.find((s) => s.code === code) : undefined;
        if (!station) return;
        latest.current.onSelectStation(station);
        openPopup(map, popupsRef, station, latest);
      });
      map.on(
        "mouseenter",
        STATIONS_HIT_LAYER,
        () => (map.getCanvas().style.cursor = "pointer"),
      );
      map.on("mouseleave", STATIONS_HIT_LAYER, () => (map.getCanvas().style.cursor = ""));

      loadedRef.current = true;
      // Fit to station bounds once the style (and therefore layout) is
      // ready. Mirrors the old FitStationBounds retry: a container that
      // reads zero-size at mount (flex-layout race, backgrounded tab) can
      // otherwise lock onto a wrong zoom with no way to recover.
      const container = map.getContainer();
      const tryFit = () => {
        map.resize();
        if (container.clientWidth === 0 || container.clientHeight === 0) return false;
        map.fitBounds(STATION_BOUNDS, { padding: 24, duration: 0 });
        return true;
      };
      if (!tryFit()) {
        const observer = new ResizeObserver(() => {
          if (tryFit()) {
            observer.disconnect();
            resizeObserverRef.current = null;
          }
        });
        resizeObserverRef.current = observer;
        observer.observe(container);
      }
      // First view fully drawn (lines, stations, basemap tiles): from here the
      // page may start everything that is not the map - live times, the
      // offline-map download. See lib/map-ready.ts.
      map.once("idle", markMapPainted);
    });

    return () => {
      stopTrainsRef.current?.();
      stopTrainsRef.current = null;
      stopGeometryRef.current?.();
      stopGeometryRef.current = null;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      popups.forEach(({ popup, root }) => {
        root.unmount();
        popup.remove();
      });
      popups.clear();
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  // Lines: grey while a route is highlighted (unless "dim" is off), width
  // from settings, and only the route's own lines when asked.
  const routeLineKeys = useMemo(() => (path ? [...new Set(path.legs.map((l) => l.line).filter(Boolean))] : []), [path]);
  const { dimLines, onlyRouteLines, lineWidth, hiddenLines: hidden } = settings;
  useEffect(() => {
    // Remembered for the trains layer, which is added later (once the map is idle).
    dimmedRef.current = isRouting;
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const grey = isRouting && dimLines;
      map.setPaintProperty(LINES_LAYER, "line-color", grey ? "#ccc" : LINE_COLOR_MATCH);
      map.setPaintProperty(LINES_LAYER, "line-width", grey ? Math.max(2, lineWidth - 1) : lineWidth);
      map.setPaintProperty(LINES_LAYER, "line-opacity", grey ? 0.6 : 0.9);
      // Hidden lines, and (while routing, if asked) every line the route doesn't use.
      const filters: maplibregl.ExpressionSpecification[] = [];
      if (hidden.length) filters.push(["!", ["in", ["get", "line"], ["literal", hidden]]]);
      if (isRouting && onlyRouteLines) filters.push(["in", ["get", "line"], ["literal", routeLineKeys]]);
      map.setFilter(LINES_LAYER, filters.length ? (["all", ...filters] as maplibregl.FilterSpecification) : null);
      applyTrainStyle(map, isRouting);
    };
    if (loadedRef.current) apply();
    else map.once("style.load", apply);
  }, [isRouting, dimLines, onlyRouteLines, lineWidth, hidden, routeLineKeys]);

  // Highlighted route geometry. Needs the fetched line-geometry data (see
  // lib/line-geometry.ts) only when there's an actual path to draw; an
  // empty/cleared route never touches it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const applyWith = (segmentsByLine: LineSegments) => {
      const apply = () => {
        const source = map.getSource<maplibregl.GeoJSONSource>(ROUTE_SOURCE);
        source?.setData(path ? routeGeoJSON(path, segmentsByLine) : { type: "FeatureCollection", features: [] });
      };
      if (loadedRef.current) apply();
      else map.once("style.load", apply);
    };
    if (!path) {
      applyWith({});
    } else if (geometryRef.current) {
      applyWith(geometryRef.current);
    } else {
      fetchLineGeometry().then((segmentsByLine) => {
        if (mapRef.current !== map) return;
        applyWith(segmentsByLine);
      });
    }
  }, [path]);

  // Keep a planned route in view: fitted to whatever part of the map the
  // route sheet (fixed to the bottom of the screen, up to 70vh) leaves
  // uncovered, and refitted when the sheet opens or closes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !path) return;
    const apply = () => {
      const lons = path.legs.map((l) => l.station.lon);
      const lats = path.legs.map((l) => l.station.lat);
      const rect = map.getContainer().getBoundingClientRect();
      const sheetTop = window.innerHeight * 0.3;
      const covered = sheetOpen ? Math.max(0, rect.bottom - sheetTop) : 0;
      // Never pad away the whole map (MapLibre refuses to fit then).
      const bottom = Math.min(covered + 24, rect.height - 120);
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding: { top: 40, left: 40, right: 40, bottom: Math.max(40, bottom) }, maxZoom: 15, duration: motionMs(600) },
      );
    };
    if (loadedRef.current) apply();
    else map.once("style.load", apply);
  }, [path, sheetOpen]);

  // Station marker styling (start/destination/on-path/dimmed).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const source = map.getSource<maplibregl.GeoJSONSource>(STATIONS_SOURCE);
      source?.setData(stationsGeoJSON(pathCodes, startCode, destinationCode, isRouting, hiddenLines));
    };
    if (loadedRef.current) apply();
    else map.once("style.load", apply);
  }, [pathCodes, startCode, destinationCode, isRouting, hiddenLines]);

  // Settings: station labels, markers, route width, basemap names, the GPS
  // marker, trains, gestures and the map's buttons. The route highlight is
  // never filtered - hiding a line must not break a planned trip.
  const { showLabels, labelCodes, labelLanguage, labelMinZoom, markerSize, routeWidth, basemapLabels, showLocation, rotateGestures } =
    settings;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.setLayoutProperty(STATIONS_LABEL_LAYER, "visibility", showLabels ? "visible" : "none");
      map.setLayerZoomRange(STATIONS_LABEL_LAYER, labelMinZoom, 24);
      const k = MARKER_FACTOR[markerSize];
      map.setPaintProperty(STATIONS_LAYER, "circle-radius", ["*", ["get", "radius"], k]);
      map.setPaintProperty(STATIONS_HIT_LAYER, "circle-radius", ["+", ["*", ["get", "radius"], k], 12]);
      map.setPaintProperty(ROUTE_LAYER, "line-width", routeWidth);
      map.setPaintProperty(ROUTE_WALK_LAYER, "line-width", Math.max(2, routeWidth - 2));
      for (const id of basemapLabelLayers) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", basemapLabels ? "visible" : "none");
      }
      for (const id of [GPS_RING_LAYER, GPS_RING_OUTLINE_LAYER, GPS_DOT_LAYER]) {
        map.setLayoutProperty(id, "visibility", showLocation ? "visible" : "none");
      }
      applyTrainStyle(map, isRouting);
      if (rotateGestures) {
        map.dragRotate.enable();
        map.touchZoomRotate.enableRotation();
      } else {
        map.dragRotate.disable();
        map.touchZoomRotate.disableRotation();
        if (map.getBearing() !== 0 || map.getPitch() !== 0) map.easeTo({ bearing: 0, pitch: 0, duration: motionMs(300) });
      }
    };
    if (loadedRef.current) apply();
    else map.once("style.load", apply);
  }, [showLabels, labelMinZoom, markerSize, routeWidth, basemapLabels, showLocation, rotateGestures, settings.showTrains, settings.otherTrains, settings.trainSize, settings.trainLabels, isRouting]);

  // Keep any open popup's Start/Destination checkmarks in sync if route
  // state changes from elsewhere (e.g. search) while it's still open.
  useEffect(() => {
    popupsRef.current.forEach(({ render }) => render());
  }, [startCode, destinationCode]);

  // GPS position.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.getSource<maplibregl.GeoJSONSource>(GPS_SOURCE)?.setData(gpsGeoJSON(userPosition));
      map.getSource<maplibregl.GeoJSONSource>(GPS_ACCURACY_SOURCE)?.setData(gpsAccuracyGeoJSON(userPosition));
    };
    if (loadedRef.current) apply();
    else map.once("style.load", apply);
  }, [userPosition]);

  // Station and basemap labels follow the EN/TH toggle. (The initial
  // language is applied at style load, in transformStyle/addLayer.)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const labelLang: Lang = labelLanguage === "ui" || labelLanguage === "both" ? lang : labelLanguage;
      map.setLayoutProperty(STATIONS_LABEL_LAYER, "text-field", stationLabelField(labelLang, labelCodes, labelLanguage === "both"));
      for (const id of basemapLabelLayers) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "text-field", basemapLabelField(labelLang));
      }
    };
    // React flushes effects synchronously inside a click, so doing this here
    // would hold the toggle's own repaint (the header text) behind relabelling
    // every basemap label layer. Run it after the next paint instead.
    let frame = 0;
    let timer = 0;
    const later = () => {
      frame = requestAnimationFrame(() => {
        timer = window.setTimeout(apply, 0);
      });
    };
    if (loadedRef.current) later();
    else map.once("style.load", later);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      map.off("style.load", later);
    };
  }, [lang, labelLanguage, labelCodes]);

  // "Follow me": keep the map centred on the rider as they move, at the zoom
  // they chose. Dragging the map turns it off (they moved it on purpose), as
  // in other map apps; the Settings switch turns it back on.
  useEffect(() => {
    const map = mapRef.current;
    // Not while the camera is already travelling (a route fit, a station
    // pick): the next GPS fix must not cancel it.
    if (!map || !userPosition || !settings.followMe || map.isMoving()) return;
    map.easeTo({ center: [userPosition.lon, userPosition.lat], duration: motionMs(500) });
  }, [userPosition, settings.followMe]);

  // Bring a station into view on demand (a search result, "nearest station")
  // and open its card, same as tapping it. The camera moves as little as it
  // can: a rider who has framed the map the way they want must not be
  // thrown into a street-level zoom on every pick.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusStation) return;
    const apply = () => {
      const { startCode, destinationCode } = latest.current;
      // The other end of a route in progress, if any: picking a destination
      // must keep the start in view (and vice versa), not replace it.
      const otherCode = [startCode, destinationCode].find((c) => c && c !== focusStation.code);
      const other = otherCode ? stations.find((s) => s.code === otherCode) : undefined;
      // Room for the card above the marker, and for the header/pills.
      const padding = { top: 200, bottom: 90, left: 40, right: 40 };
      // With "zoom in" off the camera only pans (and only when the station is
      // off screen); the rider's zoom level is never changed.
      const move = focusCamera(map, focusStation, other, padding, useSettingsStore.getState().settings.autoZoom);
      if (move) map.stop().easeTo({ ...move, duration: motionMs(600) });
      openPopup(map, popupsRef, focusStation, latest);
    };
    if (loadedRef.current) apply();
    else map.once("style.load", apply);
  }, [focusStation]);

  // A place picked from search: a pin, and a card naming its nearest station
  // with the usual Start / Destination buttons, so "go to the mall" is one tap.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusPlace) return;
    const apply = () => {
      const move = {
        center: [focusPlace.lon, focusPlace.lat] as [number, number],
        zoom: useSettingsStore.getState().settings.autoZoom ? Math.max(map.getZoom(), 15) : map.getZoom(),
      };
      map.stop().easeTo({ ...move, duration: motionMs(600) });
      openPlacePopup(map, popupsRef, focusPlace, latest);
    };
    if (loadedRef.current) apply();
    else map.once("style.load", apply);
  }, [focusPlace]);

  return (
    <div className={`relative h-full w-full ${settings.zoomButtons ? "" : "[&_.maplibregl-ctrl-top-left]:hidden"}`}>
      <div ref={containerRef} className="h-full w-full" />
      {settings.locateButton && (
      <button
        type="button"
        onClick={() => {
          const map = mapRef.current;
          if (map && userPosition) {
            map.flyTo({
              center: [userPosition.lon, userPosition.lat],
              zoom: Math.max(map.getZoom(), 16),
              duration: motionMs(600),
            });
          }
        }}
        disabled={!userPosition}
        aria-label={t.centerOnMe}
        title={userPosition ? t.centerOnMe : t.waitingLocation}
        className="absolute top-3 right-3 z-[1000] flex h-11 w-11 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700 shadow-md hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <LocateFixed size={18} />
      </button>
      )}
    </div>
  );
}

// Its own component so the name re-renders when the language changes - the
// popup is a separate React root that only re-renders on demand otherwise.
function PopupStationName({ station }: { station: Station }) {
  const { lang } = useT();
  return (
    <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
      {stationName(station, lang)}
    </span>
  );
}

/**
 * Where the camera should go to show `target` (and `other`, the far end of a
 * route in progress) - or null when everything is already comfortably on
 * screen, in which case the map stays exactly where the rider left it.
 *
 * - Already visible: no move.
 * - Both ends of a route: fit them together (never closer than ZOOM_CAP).
 * - Just one: centre it, zooming in only as far as ZOOM_FLOOR when the rider
 *   is zoomed further out than that, never past what they already chose.
 */
const ZOOM_FLOOR = 13;
const ZOOM_CAP = 15;
function focusCamera(
  map: maplibregl.Map,
  target: Station,
  other: Station | undefined,
  padding: { top: number; bottom: number; left: number; right: number },
  allowZoom = true,
): { center: [number, number]; zoom: number } | null {
  const { width, height } = map.getCanvas().getBoundingClientRect();
  const visible = (s: Station) => {
    const p = map.project([s.lon, s.lat]);
    return p.x >= padding.left && p.x <= width - padding.right && p.y >= padding.top && p.y <= height - padding.bottom;
  };
  const points = other ? [target, other] : [target];
  if (points.every(visible)) return null;
  if (!allowZoom) return { center: [target.lon, target.lat], zoom: map.getZoom() };
  if (other) {
    const cam = map.cameraForBounds(
      [
        [Math.min(target.lon, other.lon), Math.min(target.lat, other.lat)],
        [Math.max(target.lon, other.lon), Math.max(target.lat, other.lat)],
      ],
      { padding, maxZoom: ZOOM_CAP },
    );
    if (cam?.center && cam.zoom !== undefined) {
      const c = maplibregl.LngLat.convert(cam.center);
      return { center: [c.lng, c.lat], zoom: cam.zoom };
    }
  }
  return { center: [target.lon, target.lat], zoom: Math.max(map.getZoom(), ZOOM_FLOOR) };
}

function openPopup(
  map: maplibregl.Map,
  popupsRef: RefObject<Map<string, { popup: maplibregl.Popup; root: Root; render: () => void }>>,
  station: Station,
  latest: RefObject<{
    onSetStart: (s: Station) => void;
    onSetDestination: (s: Station) => void;
    startCode: string | null;
    destinationCode: string | null;
  }>,
) {
  // One card at a time: a popup opened programmatically (search, nearest
  // station) isn't dismissed by MapLibre's own close-on-map-click.
  popupsRef.current.forEach(({ popup }) => popup.remove());

  const container = document.createElement("div");
  const root = createRoot(container);
  // focusAfterOpen is off because MapLibre's own focus() scrolls the page to
  // reveal the button while the camera is still flying and the card is still
  // off-screen (WebKit scrolls even `overflow: hidden` ancestors), leaving the
  // whole app shifted sideways. It is focused below without scrolling, which
  // keeps the keyboard behaviour.
  const popup = new maplibregl.Popup({
    offset: 12,
    maxWidth: "min(300px, calc(100vw - 24px))",
    closeButton: true,
    focusAfterOpen: false,
  })
    .setLngLat([station.lon, station.lat])
    .setDOMContent(container)
    .addTo(map);

  // MapLibre sizes its close button from the glyph (~7×20). Set the 44 px
  // target inline so its own stylesheet cannot win the cascade, matching the
  // WCAG 2.5.8 minimum used everywhere else.
  const closeButton = popup.getElement()?.querySelector<HTMLElement>(".maplibregl-popup-close-button");
  if (closeButton) {
    closeButton.style.width = "44px";
    closeButton.style.height = "44px";
    closeButton.style.display = "flex";
    closeButton.style.alignItems = "center";
    closeButton.style.justifyContent = "center";
    closeButton.style.padding = "0";
    closeButton.focus({ preventScroll: true });
  }

  popup.on("close", () => {
    // Deferred: a close can now be triggered from inside a React effect (the
    // focus effect replacing this card), where a synchronous unmount of
    // another root is unsafe.
    queueMicrotask(() => root.unmount());
    if (popupsRef.current.get(station.code)?.popup === popup) {
      popupsRef.current.delete(station.code);
    }
  });

  const render = () => {
    const color = stationLineColor(station);
    root.render(
      <div className="flex flex-col gap-2 py-0.5">
        <div className="flex items-center gap-2">
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold"
            style={{ backgroundColor: color, color: readableTextColor(color) }}
          >
            {shownCode(station)}
          </span>
          <PopupStationName station={station} />
        </div>
        <StationActions
          station={station}
          startCode={latest.current.startCode}
          destinationCode={latest.current.destinationCode}
          onSetStart={(s) => {
            latest.current.onSetStart(s);
            // Deferred: popup.remove() unmounts this very React root, which
            // is unsafe to do synchronously from inside its own event
            // handler while React is still flushing this click.
            queueMicrotask(() => popup.remove());
          }}
          onSetDestination={(s) => {
            latest.current.onSetDestination(s);
            queueMicrotask(() => popup.remove());
          }}
        />
      </div>,
    );
  };
  popupsRef.current.set(station.code, { popup, root, render });
  render();
}

const PLACE_KEY = "__place";

function PlaceCard({
  place,
  latest,
  close,
}: {
  place: Place;
  latest: RefObject<{
    onSetStart: (s: Station) => void;
    onSetDestination: (s: Station) => void;
    startCode: string | null;
    destinationCode: string | null;
  }>;
  close: () => void;
}) {
  const { lang, t } = useT();
  const { station, meters } = nearestStation(place.lat, place.lon);
  const color = stationLineColor(station);
  return (
    <div className="flex flex-col gap-2 py-0.5">
      <div className="pr-8">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{place.name}</p>
        {(place.kind || place.detail) && (
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            {[place.kind, place.detail].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-700 dark:text-neutral-300">
        {t.placeNearest}:
        <span
          className="shrink-0 rounded px-1.5 py-0.5 font-semibold"
          style={{ backgroundColor: color, color: readableTextColor(color) }}
        >
          {shownCode(station)}
        </span>
        <span lang={lang}>{stationName(station, lang)}</span>
        <span>· {t.placeAway(distanceLabel(meters))}</span>
      </p>
      <StationActions
        station={station}
        startCode={latest.current.startCode}
        destinationCode={latest.current.destinationCode}
        onSetStart={(s) => {
          latest.current.onSetStart(s);
          close();
        }}
        onSetDestination={(s) => {
          latest.current.onSetDestination(s);
          close();
        }}
      />
    </div>
  );
}

function openPlacePopup(
  map: maplibregl.Map,
  popupsRef: RefObject<Map<string, { popup: maplibregl.Popup; root: Root; render: () => void }>>,
  place: Place,
  latest: RefObject<{
    onSetStart: (s: Station) => void;
    onSetDestination: (s: Station) => void;
    startCode: string | null;
    destinationCode: string | null;
  }>,
) {
  // One card at a time, same as station cards.
  popupsRef.current.forEach(({ popup }) => popup.remove());

  const container = document.createElement("div");
  const root = createRoot(container);
  const marker = new maplibregl.Marker({ color: "#dc2626" }).setLngLat([place.lon, place.lat]).addTo(map);
  const popup = new maplibregl.Popup({
    offset: 36,
    maxWidth: "min(300px, calc(100vw - 24px))",
    closeButton: true,
    focusAfterOpen: false,
  })
    .setLngLat([place.lon, place.lat])
    .setDOMContent(container)
    .addTo(map);

  const closeButton = popup.getElement()?.querySelector<HTMLElement>(".maplibregl-popup-close-button");
  if (closeButton) {
    closeButton.style.width = "44px";
    closeButton.style.height = "44px";
    closeButton.style.display = "flex";
    closeButton.style.alignItems = "center";
    closeButton.style.justifyContent = "center";
    closeButton.style.padding = "0";
    closeButton.focus({ preventScroll: true });
  }

  popup.on("close", () => {
    marker.remove();
    queueMicrotask(() => root.unmount());
    if (popupsRef.current.get(PLACE_KEY)?.popup === popup) popupsRef.current.delete(PLACE_KEY);
  });

  const render = () =>
    root.render(<PlaceCard place={place} latest={latest} close={() => queueMicrotask(() => popup.remove())} />);
  popupsRef.current.set(PLACE_KEY, { popup, root, render });
  render();
}
