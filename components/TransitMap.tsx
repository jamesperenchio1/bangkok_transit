"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LocateButton } from "@/components/LocateButton";
import { stations, type LineKey, type Station } from "@/data/stations";
import {
  fetchLineGeometry,
  loadedLineGeometry,
  loadLineGeometryInBackground,
  stationLineSegments,
  type LineSegments,
} from "@/lib/line-geometry";
import {
  ENDPOINT_COLOR,
  FOCUS_PADDING,
  FOCUS_ZOOM_CAP,
  FOCUS_ZOOM_FLOOR,
  LOCATE_ZOOM,
  MARKER_FACTOR,
  PLACE_ZOOM,
  lineKeys,
  lineTracks,
  routeBounds,
  routeFitPadding,
  routeParts,
  stationVisuals,
} from "@/lib/map-data";
import { markMapPainted } from "@/lib/map-ready";
import type { GeoPosition } from "@/lib/use-geolocation";
import type { PathOptions, PathResult } from "@/lib/transit-graph";
import type { FinalWalk } from "@/lib/place-station";
import { PlaceCard, StationCard } from "@/components/map-cards";
import type { Place } from "@/lib/google-places";
import { applyTrainStyle, startLiveTrainsWhenIdle } from "@/components/live-trains-layer";
import { routeHops } from "@/lib/live-trains";
import { LINE_COLORS } from "@/lib/line-colors";
import { useLangStore, useT, type Lang } from "@/lib/i18n";
import { motionDuration, useSettingsStore } from "@/lib/settings-store";
import { isDarkTheme, mapPalette, mapStyleUrl, resolveDarkTheme, systemPrefersDark } from "@/lib/map-style";

// MapLibre uses [lon, lat] everywhere, the opposite of Leaflet's [lat, lon] -
// every coordinate pair in this file is in that order.
const STATION_BOUNDS: [[number, number], [number, number]] = [
  [Math.min(...stations.map((s) => s.lon)), Math.min(...stations.map((s) => s.lat))],
  [Math.max(...stations.map((s) => s.lon)), Math.max(...stations.map((s) => s.lat))],
];

// Which basemap (light, or dark at night) is in lib/map-style.ts, together
// with what we paint on top of it. app/layout.tsx preloads the light style
// from its own copy of the URL so it downloads while the page hydrates - if
// that URL ever changes, change it there too.

/**
 * What the map shows when the basemap style cannot be loaded: a plain ground
 * colour, matched to the theme. Glyphs still point at the basemap's font
 * server, so station names appear whenever it is reachable (or its fonts are
 * cached).
 */
function fallbackStyle(dark: boolean): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {},
    layers: [
      {
        id: "fallback-background",
        type: "background",
        paint: { "background-color": mapPalette(dark).background },
      },
    ],
  };
}

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

// MapLibre's `new Worker(new URL('./maplibre-gl-worker.mjs', import.meta.url))`
// pattern doesn't resolve correctly under Next's bundler (Turbopack or
// webpack) from inside node_modules - the request 404s, so tiles never load
// and no error ever surfaces. Point it at a plain static copy instead (see
// scripts/copy-maplibre-worker.mjs, run on every `npm install`).
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export interface TransitMapProps {
  onSelectStation: (station: Station) => void;
  /**
   * /v2: a station tap opens the page's own sheet. When set, it replaces the
   * map card entirely (no popup is opened for that station).
   */
  onStationOpen?: (station: Station) => void;
  /** A place card passes its place, so the route can end with the walk to it. */
  onSetStart: (station: Station, place?: Place) => void;
  onSetDestination: (station: Station, place?: Place) => void;
  startCode: string | null;
  destinationCode: string | null;
  path: PathResult | null;
  /** The walk from the destination station to a place picked as the destination. */
  finalWalk?: FinalWalk | null;
  /** The walk from the rider to the first station (when starting from current location). */
  firstWalk?: FinalWalk | null;
  /** Route preferences, so a place card picks its station the same way the route does. */
  pathOptions?: PathOptions;
  userPosition: GeoPosition | null;
  /** Set (e.g. from a search result) to fly the map to a station on demand. */
  focusStation: Station | null;
  /** Set (from a place search result) to show a place and its nearest station. */
  focusPlace: Place | null;
  /** Whether the route sheet covers the bottom of the screen (up to 70vh). */
  sheetOpen: boolean;
  /** Called once, after the first style load and initial fit. */
  onLoad?: () => void;
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

const LINE_COLOR_MATCH = [
  "match",
  ["get", "line"],
  ...lineKeys.flatMap((line) => [line, LINE_COLORS[line]]),
  "#666",
] as unknown as maplibregl.ExpressionSpecification;

function baseLinesGeoJSON(segmentsByLine: LineSegments): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: lineTracks(segmentsByLine).map(({ line, points }) => ({
      type: "Feature",
      properties: { line },
      geometry: { type: "LineString", coordinates: points.map(([lat, lon]) => [lon, lat]) },
    })),
  };
}

function routeGeoJSON(
  path: PathResult,
  segmentsByLine: LineSegments,
  finalWalk?: FinalWalk | null,
  firstWalk?: FinalWalk | null,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: routeParts(path, segmentsByLine, finalWalk, firstWalk).map(({ line, walk, points }) => ({
      type: "Feature" as const,
      properties: { line, walk },
      geometry: { type: "LineString" as const, coordinates: points.map(([lat, lon]) => [lon, lat]) },
    })),
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
    features: stationVisuals(pathCodes, startCode, destinationCode, isRouting, hiddenLines).map((v) => ({
      type: "Feature",
      properties: {
        code: v.code, // the id: clicks look the station up by it
        shownCode: v.shownCode, // the operator's code, which is what the label shows
        nameEn: v.nameEn,
        nameTh: v.nameTh,
        sortKey: v.sortKey,
        labelOpacity: v.labelOpacity,
        radius: v.radius,
        strokeColor: v.strokeColor,
        strokeWidth: v.strokeWidth,
        fillColor: v.fillColor,
        fillOpacity: v.fillOpacity,
        isDestination: v.isDestination,
        // Off the highlighted route: the dark theme paints these in its own
        // grey instead of the light basemap's pale one (see lib/map-style.ts).
        dimmed: v.dimmed,
      },
      geometry: { type: "Point", coordinates: [v.station.lon, v.station.lat] },
    })),
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

/**
 * Runs `fn` now when our own layers are on the current style, otherwise after
 * the next `style.load` (which is where they are added). A theme switch calls
 * setStyle, which removes every source and layer for a moment; a settings or
 * data change that lands inside that window must wait rather than address
 * layers that are not there.
 */
function withTransitLayers(map: maplibregl.Map, loaded: boolean, fn: () => void): void {
  if (loaded && map.getLayer(LINES_LAYER)) fn();
  else map.once("style.load", fn);
}

export function TransitMap({
  onSelectStation,
  onStationOpen,
  onSetStart,
  onSetDestination,
  startCode,
  destinationCode,
  path,
  finalWalk,
  firstWalk,
  pathOptions,
  userPosition,
  focusStation,
  focusPlace,
  sheetOpen,
  onLoad,
}: TransitMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  // Keep the newest callback without re-running the map-creation effect.
  const onLoadRef = useRef(onLoad);
  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);
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
  const { lang } = useT();
  const settings = useSettingsStore((s) => s.settings);
  const { hiddenLines } = settings;

  // The basemap follows the app's theme, so the map is not a bright daytime
  // map at night. "system" follows the OS live, so it can change while the
  // map is open (same rule the Google map uses). Read at first render, not in
  // an effect: the map's own creation effect reads the same value, and the two
  // must agree or they would swap the style straight back.
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const dark = resolveDarkTheme(settings.theme, systemDark);
  // Read by the map's listeners, which are registered once and must see the
  // theme of the style that is actually loaded.
  const darkRef = useRef(dark);
  /** Bumped after a style switch, so the data/paint effects below re-apply themselves. */
  const [styleEpoch, setStyleEpoch] = useState(0);
  /** The theme the style on the map was loaded for (null until the map exists). */
  const appliedDarkRef = useRef<boolean | null>(null);
  /** Set by the map-creation effect; re-loads the basemap in the other theme. */
  const switchStyleRef = useRef<((nextDark: boolean) => void) | null>(null);

  // Keep the latest callbacks/state in refs so the map's own click handler
  // (registered once, at style-load time) always sees current values without
  // needing to be re-registered on every render.
  const latest = useRef({
    onSelectStation,
    onStationOpen,
    onSetStart,
    onSetDestination,
    startCode,
    destinationCode,
    pathOptions,
  });
  useEffect(() => {
    latest.current = { onSelectStation, onStationOpen, onSetStart, onSetDestination, startCode, destinationCode, pathOptions };
  });

  // Create the map once per mount. Like the Leaflet canvas renderer this
  // replaces, a maplibregl.Map binds to exactly one container/GL context for
  // its life - creating it fresh per mount (not as a module-level singleton)
  // avoids the same class of stale-binding bug under React Strict Mode's
  // dev double-mount.
  useEffect(() => {
    if (!containerRef.current) return;
    const popups = popupsRef.current;
    // The style the map starts on. Read from the store here (not from render
    // state): the map is created once, and saved settings arrive around the
    // same moment. If the saved theme lands after this, the effect below
    // re-issues setStyle with the right one - before the first style has
    // loaded there is nothing on screen to switch.
    const startDark = isDarkTheme();
    darkRef.current = startDark;
    appliedDarkRef.current = startDark;
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
    mapRef.current = map;

    // The basemap style currently requested (null once it has arrived, or when
    // the inline fallback is what is showing), so a failed fetch is recognised
    // as "the basemap itself", not a tile or a font.
    let requestedStyle: string | null = null;
    // transformStyle is only accepted by setStyle, not the constructor. It runs
    // for every style, including the dark one, which has the same sprite
    // deferral and its own bilingual labels to swap.
    const applyStyle = (url: string) => {
      requestedStyle = url;
      map.setStyle(url, { diff: false, transformStyle });
    };
    // A theme switch, from the effect below. Nothing is animated: setStyle has
    // no transition, which is what reduced-motion users want anyway.
    switchStyleRef.current = (nextDark: boolean) => {
      deferredSprite = undefined;
      applyStyle(mapStyleUrl(nextDark));
    };
    applyStyle(mapStyleUrl(startDark));

    // If the basemap style itself can't be fetched (offline, never cached, or
    // the host is down), draw the network on a plain background rather than
    // showing nothing: the lines and stations are ours and need none of it.
    // This applies to a theme switch too - a dark fallback stays dark.
    map.on("error", (e) => {
      const failed = (e.error as { url?: string } | undefined)?.url;
      if (!requestedStyle || !failed?.startsWith(requestedStyle)) return;
      requestedStyle = null;
      deferredSprite = undefined;
      map.setStyle(fallbackStyle(darkRef.current));
    });
    // Exposed for debugging and the e2e suite, which asserts on rendered
    // features rather than pixels.
    (window as { __map?: maplibregl.Map }).__map = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.on("dragstart", (e: { originalEvent?: unknown }) => {
      if (e.originalEvent && useSettingsStore.getState().settings.followMe) {
        useSettingsStore.getState().update({ followMe: false });
      }
    });

    /**
     * The app's own sources and layers, added to whatever style is loaded.
     *
     * They go on at `style.load`, not `load`: `load` waits for the basemap's
     * first tiles and fonts, and on a slow connection the transit network would
     * stay invisible for as long as the third-party basemap takes, though
     * nothing here depends on it. The basemap fills in beneath.
     *
     * A theme switch calls setStyle, which replaces the style wholesale - every
     * source and layer of ours goes with it - so this runs again on each
     * `style.load`. The guard keeps a repeated event from adding them twice.
     */
    const addTransitLayers = () => {
      if (map.getSource(LINES_SOURCE)) return;
      // What we draw on top depends on what is underneath: a label halo and a
      // "dimmed" grey made for white paper disappear on a night basemap.
      const palette = mapPalette(darkRef.current);

      // The lines are drawn from the first frame. If the curved track has
      // already arrived (it is requested while the map's own code downloads)
      // it is used straight away; if not, the network is drawn as straight
      // station-to-station track from data already in the bundle and the
      // curves swap in when they land. Either way no line is ever missing or
      // left unconnected while waiting on a second download.
      const known = geometryRef.current ?? loadedLineGeometry();
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
      // Started once per mount, not once per style: the request keeps going
      // across a style switch and its callback updates whichever source is
      // current (geometryRef is set before the source data is needed again).
      if (!known && !stopGeometryRef.current) {
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
        paint: { "line-color": palette.routeWalk, "line-width": 3, "line-dasharray": [0.5, 1.5] },
      });

      map.addSource(STATIONS_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // Attach the basemap's sprite once the stations have been drawn: wait for
      // their source to finish loading, then for the next frame to render. A
      // style switch holds the sprite back again (see transformStyle), so this
      // is registered for every style, not just the first.
      if (deferredSprite) {
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
      }
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
          // Official line colours stay; only the stations that are off the
          // highlighted route take the theme's muted grey.
          "circle-color": ["case", ["get", "dimmed"], palette.dimmedStationFill, ["get", "fillColor"]],
          "circle-opacity": ["get", "fillOpacity"],
          "circle-stroke-color": ["case", ["get", "dimmed"], palette.dimmedStationStroke, ["get", "strokeColor"]],
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
          // Light text with a dark halo on the night basemap, dark text with a
          // white halo on the day one (lib/map-style.ts).
          "text-color": palette.labelText,
          "text-halo-color": palette.labelHalo,
          "text-halo-width": 1.6,
          "text-opacity": ["get", "labelOpacity"],
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
    };

    // Estimated live train positions (BTS only), drawn under the station
    // names so labels stay readable. Fed from the arrivals the app already
    // holds, so it adds no requests (see lib/live-trains.ts). Added after the
    // map is idle, not at style.load: the map comes first. A style switch
    // starts it again, since its layers went with the old style.
    const startTrains = () => {
      stopTrainsRef.current?.();
      stopTrainsRef.current = startLiveTrainsWhenIdle(map, STATIONS_LABEL_LAYER, {
        getSegments: () => geometryRef.current,
        stationHitLayer: STATIONS_HIT_LAYER,
        isDimmed: () => dimmedRef.current,
        getRouteHops: () => routeHopsRef.current,
      });
    };

    // Stays for the life of the map: every style.load - the first one and each
    // theme switch - puts our layers back. The camera, the route and any open
    // card are untouched by a switch; only the basemap underneath changes.
    map.on("style.load", () => {
      // A late event from a map that has been torn down (the cleanup nulls the
      // ref before removing it) must not touch it.
      if (mapRef.current !== map) return;
      requestedStyle = null;
      addTransitLayers();
      if (loadedRef.current) {
        // A theme switch: the train layers are gone with the old style, and
        // the data/paint effects below re-apply themselves off `styleEpoch`.
        startTrains();
        setStyleEpoch((n) => n + 1);
        return;
      }
      loadedRef.current = true;

      map.on("click", STATIONS_HIT_LAYER, (e: maplibregl.MapLayerMouseEvent) => {
        const code = e.features?.[0]?.properties?.code as string | undefined;
        const station = code ? stations.find((s) => s.code === code) : undefined;
        if (!station) return;
        // A page that draws its own station sheet (the /v2 preview) takes the
        // tap instead of the map card. Everything else stays exactly as it was.
        if (latest.current.onStationOpen) {
          latest.current.onStationOpen(station);
          return;
        }
        latest.current.onSelectStation(station);
        openPopup(map, popupsRef, station, latest);
      });
      map.on(
        "mouseenter",
        STATIONS_HIT_LAYER,
        () => (map.getCanvas().style.cursor = "pointer"),
      );
      map.on("mouseleave", STATIONS_HIT_LAYER, () => (map.getCanvas().style.cursor = ""));

      startTrains();
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
      // offline-map download - and the instant SVG can hand over to the map.
      // See lib/map-ready.ts.
      map.once("idle", () => {
        markMapPainted();
        onLoadRef.current?.();
      });
    });

    return () => {
      switchStyleRef.current = null;
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

  // A theme change swaps the basemap (dark at night) without re-creating the
  // map: a remount would lose the camera, any route on screen and any open
  // card. setStyle replaces the style wholesale, which is why our own layers
  // are added again on the next `style.load` and the data/paint effects below
  // re-apply themselves off `styleEpoch`. Nothing is animated (a style swap has
  // no transition), so reduced motion needs no special case here.
  useEffect(() => {
    darkRef.current = dark;
    const map = mapRef.current;
    if (!map || appliedDarkRef.current === dark) return;
    appliedDarkRef.current = dark;
    // Before the first style has loaded there is nothing on screen to switch:
    // hand the map the right one now, which restarts the pending load.
    switchStyleRef.current?.(dark);
  }, [dark]);

  // Lines: grey while a route is highlighted (unless "dim" is off), width
  // from settings, and only the route's own lines when asked.
  const routeLineKeys = useMemo(() => (path ? [...new Set(path.legs.map((l) => l.line).filter(Boolean))] : []), [path]);
  const { dimLines, onlyRouteLines, lineWidth, hiddenLines: hidden } = settings;
  useEffect(() => {
    // Remembered for the trains layer, which is added later (once the map is idle).
    dimmedRef.current = isRouting;
    const map = mapRef.current;
    // While a theme switch is still loading, the style on screen is the old
    // one: painting the new theme's grey on it would look wrong until the
    // new style arrives. `styleEpoch` runs this again once it has.
    if (!map || appliedDarkRef.current !== dark) return;
    const apply = () => {
      const grey = isRouting && dimLines;
      map.setPaintProperty(LINES_LAYER, "line-color", grey ? mapPalette(dark).dimmedLine : LINE_COLOR_MATCH);
      map.setPaintProperty(LINES_LAYER, "line-width", grey ? Math.max(2, lineWidth - 1) : lineWidth);
      map.setPaintProperty(LINES_LAYER, "line-opacity", grey ? 0.6 : 0.9);
      // Hidden lines, and (while routing, if asked) every line the route doesn't use.
      const filters: maplibregl.ExpressionSpecification[] = [];
      if (hidden.length) filters.push(["!", ["in", ["get", "line"], ["literal", hidden]]]);
      if (isRouting && onlyRouteLines) filters.push(["in", ["get", "line"], ["literal", routeLineKeys]]);
      map.setFilter(LINES_LAYER, filters.length ? (["all", ...filters] as maplibregl.FilterSpecification) : null);
      applyTrainStyle(map, isRouting);
    };
    withTransitLayers(map, loadedRef.current, apply);
  }, [isRouting, dimLines, onlyRouteLines, lineWidth, hidden, routeLineKeys, dark, styleEpoch]);

  // What sits on the basemap follows the basemap: station names (and the halo
  // that separates them from the basemap's own labels), the muted grey of the
  // stations and track that are off the highlighted route, and the walking
  // dashes. Official line and station colours are the same in both themes.
  // `styleEpoch` re-applies this after a theme switch re-created the layers;
  // the layer creation above already used the right palette.
  useEffect(() => {
    const map = mapRef.current;
    // Same rule as the lines effect: not while the other theme's style is
    // still on its way in.
    if (!map || appliedDarkRef.current !== dark) return;
    const apply = () => {
      const palette = mapPalette(dark);
      map.setPaintProperty(STATIONS_LABEL_LAYER, "text-color", palette.labelText);
      map.setPaintProperty(STATIONS_LABEL_LAYER, "text-halo-color", palette.labelHalo);
      map.setPaintProperty(STATIONS_LAYER, "circle-color", [
        "case",
        ["get", "dimmed"],
        palette.dimmedStationFill,
        ["get", "fillColor"],
      ]);
      map.setPaintProperty(STATIONS_LAYER, "circle-stroke-color", [
        "case",
        ["get", "dimmed"],
        palette.dimmedStationStroke,
        ["get", "strokeColor"],
      ]);
      map.setPaintProperty(ROUTE_WALK_LAYER, "line-color", palette.routeWalk);
    };
    withTransitLayers(map, loadedRef.current, apply);
  }, [dark, styleEpoch]);

  // Highlighted route geometry. Needs the fetched line-geometry data (see
  // lib/line-geometry.ts) only when there's an actual path to draw; an
  // empty/cleared route never touches it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const applyWith = (segmentsByLine: LineSegments) => {
      const apply = () => {
        const source = map.getSource<maplibregl.GeoJSONSource>(ROUTE_SOURCE);
        source?.setData(
          path ? routeGeoJSON(path, segmentsByLine, finalWalk, firstWalk) : { type: "FeatureCollection", features: [] },
        );
      };
      withTransitLayers(map, loadedRef.current, apply);
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
  }, [path, finalWalk, firstWalk, styleEpoch]);

  // Keep a planned route in view: fitted to whatever part of the map the
  // route sheet (fixed to the bottom of the screen, up to 70vh) leaves
  // uncovered, and refitted when the sheet opens or closes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !path) return;
    const apply = () => {
      const rect = map.getContainer().getBoundingClientRect();
      map.fitBounds(routeBounds(path, finalWalk, firstWalk), {
        padding: routeFitPadding(sheetOpen, rect.bottom, rect.height, window.innerHeight),
        maxZoom: FOCUS_ZOOM_CAP,
        duration: motionMs(600),
      });
    };
    if (loadedRef.current) apply();
    else map.once("style.load", apply);
  }, [path, finalWalk, firstWalk, sheetOpen]);

  // Station marker styling (start/destination/on-path/dimmed).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const source = map.getSource<maplibregl.GeoJSONSource>(STATIONS_SOURCE);
      source?.setData(stationsGeoJSON(pathCodes, startCode, destinationCode, isRouting, hiddenLines));
    };
    withTransitLayers(map, loadedRef.current, apply);
  }, [pathCodes, startCode, destinationCode, isRouting, hiddenLines, styleEpoch]);

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
    withTransitLayers(map, loadedRef.current, apply);
  }, [showLabels, labelMinZoom, markerSize, routeWidth, basemapLabels, showLocation, rotateGestures, settings.showTrains, settings.otherTrains, settings.trainSize, settings.trainLabels, isRouting, styleEpoch]);

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
    withTransitLayers(map, loadedRef.current, apply);
  }, [userPosition, styleEpoch]);

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
    withTransitLayers(map, loadedRef.current, later);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      map.off("style.load", later);
    };
  }, [lang, labelLanguage, labelCodes, styleEpoch]);

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
      const padding = FOCUS_PADDING;
      // With "zoom in" off the camera only pans (and only when the station is
      // off screen); the rider's zoom level is never changed.
      const move = focusCamera(map, focusStation, other, padding, useSettingsStore.getState().settings.autoZoom);
      if (move) map.stop().easeTo({ ...move, duration: motionMs(600) });
      // /v2 replaces the map card with the page's own sheet everywhere,
      // including a station picked from search - otherwise the preview would
      // show two different station UIs depending on how it was opened.
      if (latest.current.onStationOpen) latest.current.onStationOpen(focusStation);
      else openPopup(map, popupsRef, focusStation, latest);
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
        zoom: useSettingsStore.getState().settings.autoZoom ? Math.max(map.getZoom(), PLACE_ZOOM) : map.getZoom(),
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
        <LocateButton
          position={userPosition}
          onLocate={(p) => {
            const map = mapRef.current;
            if (!map) return;
            map.flyTo({
              center: [p.lon, p.lat],
              zoom: Math.max(map.getZoom(), LOCATE_ZOOM),
              duration: motionMs(600),
            });
          }}
        />
      )}
    </div>
  );
}

/**
 * Where the camera should go to show `target` (and `other`, the far end of a
 * route in progress) - or null when everything is already comfortably on
 * screen, in which case the map stays exactly where the rider left it.
 *
 * - Already visible: no move.
 * - Both ends of a route: fit them together (never closer than FOCUS_ZOOM_CAP).
 * - Just one: centre it, zooming in only as far as FOCUS_ZOOM_FLOOR when the rider
 *   is zoomed further out than that, never past what they already chose.
 */
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
      { padding, maxZoom: FOCUS_ZOOM_CAP },
    );
    if (cam?.center && cam.zoom !== undefined) {
      const c = maplibregl.LngLat.convert(cam.center);
      return { center: [c.lng, c.lat], zoom: cam.zoom };
    }
  }
  return { center: [target.lon, target.lat], zoom: Math.max(map.getZoom(), FOCUS_ZOOM_FLOOR) };
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
    root.render(
      <StationCard
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
      />,
    );
  };
  popupsRef.current.set(station.code, { popup, root, render });
  render();
}

const PLACE_KEY = "__place";

function openPlacePopup(
  map: maplibregl.Map,
  popupsRef: RefObject<Map<string, { popup: maplibregl.Popup; root: Root; render: () => void }>>,
  place: Place,
  latest: RefObject<{
    onSetStart: (s: Station, place?: Place) => void;
    onSetDestination: (s: Station, place?: Place) => void;
    startCode: string | null;
    destinationCode: string | null;
    pathOptions?: PathOptions;
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
    root.render(
      <PlaceCard
        place={place}
        startCode={latest.current.startCode}
        destinationCode={latest.current.destinationCode}
        pathOptions={latest.current.pathOptions}
        onSetStart={(s) => {
          latest.current.onSetStart(s, place);
          queueMicrotask(() => popup.remove());
        }}
        onSetDestination={(s) => {
          latest.current.onSetDestination(s, place);
          queueMicrotask(() => popup.remove());
        }}
      />,
    );
  popupsRef.current.set(PLACE_KEY, { popup, root, render });
  render();
}
