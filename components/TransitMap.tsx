"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChevronRight, LocateFixed } from "lucide-react";
import { stations, type Station } from "@/data/stations";
import { fetchLineGeometry, fullLineSegments, trackBetween, type LineSegments } from "@/lib/line-geometry";
import type { GeoPosition } from "@/lib/use-geolocation";
import { interchangeCodes, type PathResult } from "@/lib/transit-graph";
import { StationActions } from "@/components/StationActions";
import { LINE_COLORS, readableTextColor } from "@/lib/line-colors";
import { lineName, stationName, useLangStore, useT, type Lang } from "@/lib/i18n";
import { distanceLabel } from "@/lib/format-distance";

// MapLibre uses [lon, lat] everywhere, the opposite of Leaflet's [lat, lon] -
// every coordinate pair in this file is in that order.
const STATION_BOUNDS: [[number, number], [number, number]] = [
  [Math.min(...stations.map((s) => s.lon)), Math.min(...stations.map((s) => s.lat))],
  [Math.max(...stations.map((s) => s.lon)), Math.max(...stations.map((s) => s.lat))],
];

// Also preloaded from app/layout.tsx (MAP_STYLE_URL) so the style JSON
// downloads while the page hydrates - keep the two URLs identical.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

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

function transformStyle(
  _previous: maplibregl.StyleSpecification | undefined,
  next: maplibregl.StyleSpecification,
): maplibregl.StyleSpecification {
  const lang = useLangStore.getState().lang;
  return {
    ...next,
    layers: next.layers
      .filter((layer) => !DROPPED_STYLE_LAYERS.has(layer.id))
      .map((layer) => {
        if (!isBilingualLabel(layer) || layer.type !== "symbol") return layer;
        basemapLabelLayers.add(layer.id);
        return { ...layer, layout: { ...layer.layout, "text-field": basemapLabelField(lang) } };
      }),
  };
}

function transferLabelField(lang: Lang): maplibregl.ExpressionSpecification {
  return ["get", lang === "th" ? "labelTh" : "labelEn"];
}

/** Our own station labels: the name in the chosen language, plus the code once zoomed in. */
function stationLabelField(lang: Lang): maplibregl.ExpressionSpecification {
  const name = ["get", lang === "th" ? "nameTh" : "nameEn"] as maplibregl.ExpressionSpecification;
  return [
    "step",
    ["zoom"],
    name,
    14,
    ["format", name, {}, "\n", {}, ["get", "code"], { "font-scale": 0.8 }],
  ];
}

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
  /** Open a station's own page (its name in the card was tapped). */
  onOpenStation: (station: Station) => void;
}

const LINES_SOURCE = "transit-lines";
const LINES_LAYER = "transit-lines-layer";
const ROUTE_SOURCE = "highlighted-route";
const ROUTE_LAYER = "highlighted-route-layer";
const ROUTE_WALK_LAYER = "highlighted-route-walk-layer";
const TRANSFER_SOURCE = "route-transfers";
const TRANSFER_LAYER = "route-transfers-layer";
const TRANSFER_ICON = "transfer-icon";
const WALK_ICON = "walk-icon";
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
function stationLineColor(station: Station): string {
  return station.lines[0] ? LINE_COLORS[station.lines[0].line] : "#666";
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
    features: path.slice(1).flatMap((leg, i) => {
      const prevStation = path[i].station;
      if (!leg.line) return [];
      // A walk between two nearby stations follows no track - draw it as a
      // plain dashed hop rather than snapping it onto either line.
      const positions: [number, number][] = leg.isWalk
        ? [
            [prevStation.lat, prevStation.lon],
            [leg.station.lat, leg.station.lon],
          ]
        : trackBetween(segmentsByLine, leg.line, prevStation, leg.station);
      return [
        {
          type: "Feature" as const,
          properties: { line: leg.line, walk: leg.isWalk },
          geometry: {
            type: "LineString" as const,
            coordinates: positions.map(([lat, lon]) => [lon, lat]),
          },
        },
      ];
    }),
  };
}

/** One badge per line change on the route, at the interchange itself. */
function transfersGeoJSON(path: PathResult | null): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: (path ?? []).flatMap((leg) => {
      const change = leg.change;
      if (!change) return [];
      const walk = change.walkMeters !== undefined;
      const label = (lang: Lang) =>
        walk
          ? `${lang === "th" ? "เดิน" : "Walk"} ${distanceLabel(change.walkMeters!)}`
          : `${lang === "th" ? "เปลี่ยนสาย" : "Change"} → ${lineName(change.toLine, lang, true)}`;
      return [
        {
          type: "Feature" as const,
          properties: { walk, labelEn: label("en"), labelTh: label("th") },
          geometry: { type: "Point" as const, coordinates: [leg.station.lon, leg.station.lat] },
        },
      ];
    }),
  };
}

/**
 * The interchange sign drawn onto a canvas once and used as a map icon: two
 * opposing arrows (the near-universal "change here" pictogram) or, for a
 * walking transfer, a walking figure - in a white disc with a dark ring,
 * matching TransferIcon in the route list. Drawn at 2x for sharp edges.
 */
function drawTransferIcon(walk: boolean): ImageData | null {
  const scale = 2;
  const size = 30 * scale;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const c = size / 2;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#262626";
  ctx.lineWidth = 3 * scale;
  ctx.beginPath();
  ctx.arc(c, c, c - ctx.lineWidth / 2 - scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.5 * scale;
  if (!walk) {
    const u = scale;
    // Upper arrow pointing right, lower arrow pointing left.
    const arrow = (y: number, dir: 1 | -1) => {
      const x0 = c - 7 * u * dir;
      const x1 = c + 7 * u * dir;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.moveTo(x1 - 4 * u * dir, y - 4 * u);
      ctx.lineTo(x1, y);
      ctx.lineTo(x1 - 4 * u * dir, y + 4 * u);
      ctx.stroke();
    };
    arrow(c - 4 * u, 1);
    arrow(c + 4 * u, -1);
  } else {
    const u = scale;
    // A stick figure mid-stride.
    ctx.fillStyle = "#262626";
    ctx.beginPath();
    ctx.arc(c + 1 * u, c - 8 * u, 2.4 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(c, c - 4 * u);
    ctx.lineTo(c - 1 * u, c + 3 * u);
    ctx.moveTo(c - 1 * u, c + 3 * u);
    ctx.lineTo(c - 5 * u, c + 9 * u);
    ctx.moveTo(c - 1 * u, c + 3 * u);
    ctx.lineTo(c + 4 * u, c + 9 * u);
    ctx.moveTo(c - 5 * u, c + 1 * u);
    ctx.lineTo(c, c - 4 * u);
    ctx.lineTo(c + 5 * u, c);
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, size, size);
}

function stationsGeoJSON(
  pathCodes: Set<string>,
  startCode: string | null,
  destinationCode: string | null,
  isRouting: boolean,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: stations.map((s) => {
      const onPath = pathCodes.has(s.code);
      const isStart = s.code === startCode;
      const isDestination = s.code === destinationCode;
      const isEndpoint = isStart || isDestination;
      const dimmed = isRouting && !onPath;
      // Lower sorts first and so wins label collisions: route ends, then the
      // rest of the route, then interchanges, then everything else.
      const isInterchange = interchangeCodes.has(s.code);
      const sortKey = isEndpoint ? 0 : onPath ? 1 : isInterchange ? 2 : 3;
      // Interchanges use the standard metro-map sign: white with a dark
      // ring (as on Bangkok's own network maps), not a line color.
      const interchangeStyle = isInterchange && !isEndpoint && !dimmed;
      return {
        type: "Feature",
        properties: {
          code: s.code,
          nameEn: s.nameEn,
          nameTh: s.nameTh || s.nameEn,
          sortKey,
          labelOpacity: dimmed ? 0.45 : 1,
          radius: isEndpoint ? 8 : isInterchange ? 6 : 4,
          // Green fill = start, white fill/green outline = destination, so
          // the two ends of the route are distinguishable at a glance.
          strokeColor: dimmed ? "#ccc" : isEndpoint ? ENDPOINT_COLOR : interchangeStyle ? "#262626" : "#fff",
          strokeWidth: isEndpoint ? 4 : interchangeStyle ? 2.5 : 1.5,
          fillColor: dimmed ? "#ddd" : isStart ? ENDPOINT_COLOR : interchangeStyle ? "#fff" : stationLineColor(s),
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
  onOpenStation,
}: TransitMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const geometryRef = useRef<LineSegments | null>(null);
  const popupsRef = useRef(new Map<string, { popup: maplibregl.Popup; root: Root; render: () => void }>());

  const pathCodes = useMemo(
    () => new Set(path?.map((leg) => leg.station.code) ?? []),
    [path],
  );
  const isRouting = path !== null;
  const { lang, t } = useT();

  // Keep the latest callbacks/state in refs so the map's own click handler
  // (registered once, at style-load time) always sees current values without
  // needing to be re-registered on every render.
  const latest = useRef({
    onSelectStation,
    onSetStart,
    onSetDestination,
    onOpenStation,
    startCode,
    destinationCode,
  });
  useEffect(() => {
    latest.current = { onSelectStation, onSetStart, onSetDestination, onOpenStation, startCode, destinationCode };
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
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

    map.on("load", () => {
      // Starts empty and fills in once the line-geometry fetch (kicked off
      // below, in parallel with the map/style itself) resolves, rather than
      // blocking the rest of this handler (fitBounds, click handlers, other
      // sources) on that fetch.
      map.addSource(LINES_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
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
      fetchLineGeometry().then((segmentsByLine) => {
        geometryRef.current = segmentsByLine;
        // The component may have unmounted (and torn down `map`) before
        // this fetch resolved - `mapRef` is nulled out in that cleanup.
        if (mapRef.current !== map) return;
        map.getSource<maplibregl.GeoJSONSource>(LINES_SOURCE)?.setData(baseLinesGeoJSON(segmentsByLine));
      });

      map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: ROUTE_WALK_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        filter: ["==", ["get", "walk"], true],
        layout: { "line-cap": "round" },
        paint: { "line-color": "#525252", "line-width": 3, "line-dasharray": [0.5, 2] },
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

      // Change-here badges, above the station markers and labels so a
      // transfer is never hidden behind a neighbouring name.
      for (const [id, walk] of [[TRANSFER_ICON, false], [WALK_ICON, true]] as const) {
        if (map.hasImage(id)) continue;
        const image = drawTransferIcon(walk);
        if (image) map.addImage(id, image, { pixelRatio: 2 });
      }
      map.addSource(TRANSFER_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: TRANSFER_LAYER,
        type: "symbol",
        source: TRANSFER_SOURCE,
        layout: {
          "icon-image": ["case", ["get", "walk"], WALK_ICON, TRANSFER_ICON],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": transferLabelField(useLangStore.getState().lang),
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
          "text-variable-anchor": ["top", "bottom", "left", "right"],
          "text-radial-offset": 1.4,
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#111827",
          "text-halo-color": "#ffffff",
          "text-halo-width": 2,
        },
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
    });

    return () => {
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

  // Base line styling: dim to grey while a route is highlighted.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.setPaintProperty(LINES_LAYER, "line-color", isRouting ? "#ccc" : LINE_COLOR_MATCH);
      map.setPaintProperty(LINES_LAYER, "line-width", isRouting ? 3 : 4);
      map.setPaintProperty(LINES_LAYER, "line-opacity", isRouting ? 0.6 : 0.9);
    };
    if (loadedRef.current) apply();
    else map.once("load", apply);
  }, [isRouting]);

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
        map.getSource<maplibregl.GeoJSONSource>(TRANSFER_SOURCE)?.setData(transfersGeoJSON(path));
      };
      if (loadedRef.current) apply();
      else map.once("load", apply);
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

  // Station marker styling (start/destination/on-path/dimmed).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const source = map.getSource<maplibregl.GeoJSONSource>(STATIONS_SOURCE);
      source?.setData(stationsGeoJSON(pathCodes, startCode, destinationCode, isRouting));
    };
    if (loadedRef.current) apply();
    else map.once("load", apply);
  }, [pathCodes, startCode, destinationCode, isRouting]);

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
    else map.once("load", apply);
  }, [userPosition]);

  // Station and basemap labels follow the EN/TH toggle. (The initial
  // language is applied at style load, in transformStyle/addLayer.)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.setLayoutProperty(STATIONS_LABEL_LAYER, "text-field", stationLabelField(lang));
      map.setLayoutProperty(TRANSFER_LAYER, "text-field", transferLabelField(lang));
      for (const id of basemapLabelLayers) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "text-field", basemapLabelField(lang));
      }
    };
    if (loadedRef.current) apply();
    else map.once("load", apply);
  }, [lang]);

  // Fly to a station on demand (a search result or "nearest station") and
  // open its card, same as tapping it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusStation) return;
    const apply = () => {
      map.flyTo({
        center: [focusStation.lon, focusStation.lat],
        zoom: Math.max(map.getZoom(), 14),
        duration: 600,
      });
      openPopup(map, popupsRef, focusStation, latest);
    };
    if (loadedRef.current) apply();
    else map.once("load", apply);
  }, [focusStation]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <button
        type="button"
        onClick={() => {
          const map = mapRef.current;
          if (map && userPosition) {
            map.flyTo({
              center: [userPosition.lon, userPosition.lat],
              zoom: Math.max(map.getZoom(), 16),
              duration: 600,
            });
          }
        }}
        disabled={!userPosition}
        aria-label={t.centerOnMe}
        title={userPosition ? t.centerOnMe : t.waitingLocation}
        className="absolute top-3 right-3 z-[1000] rounded-full border border-neutral-300 bg-white p-2.5 text-neutral-700 shadow-md hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <LocateFixed size={18} />
      </button>
    </div>
  );
}

// Its own component so the name re-renders when the language changes - the
// popup is a separate React root that only re-renders on demand otherwise.
// Tapping the name opens the station's own page.
function PopupStationName({ station, onOpen }: { station: Station; onOpen: () => void }) {
  const { lang, t } = useT();
  return (
    <button
      onClick={onOpen}
      title={t.stationDetails}
      className="flex min-w-0 items-center gap-0.5 text-left text-sm font-semibold text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-600 dark:text-neutral-100"
    >
      <span className="truncate">{stationName(station, lang)}</span>
      <ChevronRight size={16} className="shrink-0 text-neutral-500" />
    </button>
  );
}

function openPopup(
  map: maplibregl.Map,
  popupsRef: RefObject<Map<string, { popup: maplibregl.Popup; root: Root; render: () => void }>>,
  station: Station,
  latest: RefObject<{
    onSetStart: (s: Station) => void;
    onOpenStation: (s: Station) => void;
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
  const popup = new maplibregl.Popup({ offset: 12, maxWidth: "300px", closeButton: true })
    .setLngLat([station.lon, station.lat])
    .setDOMContent(container)
    .addTo(map);

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
            {station.code}
          </span>
          <PopupStationName
            station={station}
            onOpen={() => {
              latest.current.onOpenStation(station);
              queueMicrotask(() => popup.remove());
            }}
          />
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
