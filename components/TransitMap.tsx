"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LocateFixed } from "lucide-react";
import { stations, type Station } from "@/data/stations";
import { fetchLineGeometry, fullLineSegments, trackBetween, type LineSegments } from "@/lib/line-geometry";
import type { GeoPosition } from "@/lib/use-geolocation";
import type { PathResult } from "@/lib/transit-graph";
import { StationActions } from "@/components/StationActions";
import { LINE_COLORS, readableTextColor } from "@/lib/line-colors";

// MapLibre uses [lon, lat] everywhere, the opposite of Leaflet's [lat, lon] -
// every coordinate pair in this file is in that order.
const STATION_BOUNDS: [[number, number], [number, number]] = [
  [Math.min(...stations.map((s) => s.lon)), Math.min(...stations.map((s) => s.lat))],
  [Math.max(...stations.map((s) => s.lon)), Math.max(...stations.map((s) => s.lat))],
];

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

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
}

const LINES_SOURCE = "transit-lines";
const LINES_LAYER = "transit-lines-layer";
const ROUTE_SOURCE = "highlighted-route";
const ROUTE_LAYER = "highlighted-route-layer";
const STATIONS_SOURCE = "stations";
const STATIONS_HIT_LAYER = "stations-hit-layer";
const STATIONS_LAYER = "stations-layer";
const DEST_RING_ICON = "destination-ring-icon";
const DEST_RING_LAYER = "destination-ring-layer";
const GPS_SOURCE = "gps-position";
const GPS_RING_LAYER = "gps-ring-layer";
const GPS_DOT_LAYER = "gps-dot-layer";
const HEADING_ICON = "gps-heading-icon";
const HEADING_LAYER = "gps-heading-layer";

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
      const positions = trackBetween(segmentsByLine, leg.line, prevStation, leg.station);
      return [
        {
          type: "Feature" as const,
          properties: { line: leg.line },
          geometry: {
            type: "LineString" as const,
            coordinates: positions.map(([lat, lon]) => [lon, lat]),
          },
        },
      ];
    }),
  };
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
      return {
        type: "Feature",
        properties: {
          code: s.code,
          radius: isEndpoint ? 8 : s.lines.length > 1 ? 6 : 4,
          // Green fill = start, white fill/green outline = destination, so
          // the two ends of the route are distinguishable at a glance.
          strokeColor: dimmed ? "#ccc" : isEndpoint ? ENDPOINT_COLOR : "#fff",
          strokeWidth: isEndpoint ? 4 : 1.5,
          fillColor: dimmed ? "#ddd" : isStart ? ENDPOINT_COLOR : stationLineColor(s),
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
        properties: {
          accuracy: position.accuracy,
          // Omitted (not set to null) so the heading-arrow layer can filter
          // on it with a plain ["has", "heading"], matching DEST_RING_LAYER's
          // filter style.
          ...(position.heading !== null ? { heading: position.heading } : {}),
        },
        geometry: { type: "Point", coordinates: [position.lon, position.lat] },
      },
    ],
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Shortest-path interpolation between two compass bearings, so e.g. 350deg
// -> 10deg sweeps 20deg through north instead of the long way around.
function lerpAngle(a: number, b: number, t: number): number {
  const delta = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
}

// MapLibre's circle-radius is in screen pixels, but GPS accuracy is a
// real-world meter figure - feeding it straight in (as this used to) makes
// the circle a huge, zoom-invariant blob that doesn't actually represent the
// accuracy radius on the ground. Convert using the standard Web Mercator
// meters-per-pixel formula (resolution doubles each zoom level) so the ring
// shrinks/grows correctly as the map is zoomed, like every other "GPS
// accuracy circle" implementation. metersPerPixelAtZoom0 depends on
// latitude (Mercator stretches pixels further from the equator) - the GPS
// position effect recomputes it from each fix's actual latitude and pushes
// a fresh expression via setPaintProperty, since expressions have no trig
// functions to do that conversion themselves.
const GPS_REFERENCE_LATITUDE = 13.75;
const METERS_PER_PIXEL_AT_ZOOM_0 =
  (156_543.03392 * Math.cos((GPS_REFERENCE_LATITUDE * Math.PI) / 180));
function gpsRingRadiusExpression(metersPerPixelAtZoom0: number): maplibregl.ExpressionSpecification {
  return [
    "max",
    8,
    [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      0,
      ["/", ["get", "accuracy"], metersPerPixelAtZoom0],
      20,
      ["*", ["/", ["get", "accuracy"], metersPerPixelAtZoom0], 2 ** 20],
    ],
  ] as unknown as maplibregl.ExpressionSpecification;
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
}: TransitMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const geometryRef = useRef<LineSegments | null>(null);
  const popupsRef = useRef(new Map<string, { popup: maplibregl.Popup; root: Root; render: () => void }>());
  const gpsAnimFrameRef = useRef<number | null>(null);
  // The last GPS point actually drawn on the map - either settled at the
  // latest fix, or mid-flight through the animation interpolating toward it.
  const gpsRenderedPositionRef = useRef<GeoPosition | null>(null);

  const pathCodes = useMemo(
    () => new Set(path?.map((leg) => leg.station.code) ?? []),
    [path],
  );
  const isRouting = path !== null;

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
      center: [100.55, 13.75],
      zoom: 11,
      style: STYLE_URL,
      clickTolerance: 15,
      attributionControl: { compact: true },
    });
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
        id: ROUTE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
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

      map.addSource(GPS_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: GPS_RING_LAYER,
        type: "circle",
        source: GPS_SOURCE,
        paint: {
          // Bootstrap value using the fixed reference latitude - nothing is
          // visible yet anyway since GPS_SOURCE starts empty. The GPS
          // position effect replaces this with an exact-latitude expression
          // on the first real fix.
          "circle-radius": gpsRingRadiusExpression(METERS_PER_PIXEL_AT_ZOOM_0),
          "circle-color": "#2563eb",
          "circle-opacity": 0.15,
          "circle-stroke-color": "#2563eb",
          "circle-stroke-width": 1,
        },
      });
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

      // A small arrow drawn on top of the dot, pointing north on its own
      // (icon-rotation-alignment: "map" then rotates it by heading), so it
      // tracks true north regardless of how the map itself is rotated -
      // shown only for fixes that report a heading (see gpsGeoJSON).
      if (!map.hasImage(HEADING_ICON)) {
        const size = 22;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#2563eb";
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(size / 2, 0);
          ctx.lineTo(size * 0.78, size * 0.42);
          ctx.lineTo(size / 2, size * 0.3);
          ctx.lineTo(size * 0.22, size * 0.42);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          map.addImage(HEADING_ICON, ctx.getImageData(0, 0, size, size));
        }
      }
      map.addLayer({
        id: HEADING_LAYER,
        type: "symbol",
        source: GPS_SOURCE,
        filter: ["has", "heading"],
        layout: {
          "icon-image": HEADING_ICON,
          "icon-rotate": ["get", "heading"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
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

  // GPS position. Animates smoothly from the last drawn point to the new
  // fix instead of snapping, since fixes land roughly a second apart and an
  // instant jump reads as jank (especially at high zoom).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const setGpsData = (position: GeoPosition | null) => {
      map.getSource<maplibregl.GeoJSONSource>(GPS_SOURCE)?.setData(gpsGeoJSON(position));
      gpsRenderedPositionRef.current = position;
    };

    const run = () => {
      if (gpsAnimFrameRef.current !== null) {
        cancelAnimationFrame(gpsAnimFrameRef.current);
        gpsAnimFrameRef.current = null;
      }

      // The circle-radius paint expression bakes in a meters-per-pixel
      // constant derived from latitude (expressions have no trig functions,
      // so this can't be computed inline) - rebuilt once per real fix, not
      // once per animation frame below, since consecutive fixes are close
      // enough that re-deriving it every frame would be pure waste.
      if (userPosition) {
        const metersPerPixelAtZoom0 = 156_543.03392 * Math.cos((userPosition.lat * Math.PI) / 180);
        map.setPaintProperty(GPS_RING_LAYER, "circle-radius", gpsRingRadiusExpression(metersPerPixelAtZoom0));
      }

      const from = gpsRenderedPositionRef.current;
      if (!userPosition || !from) {
        // Nothing to animate from (first fix), or position cleared: snap.
        setGpsData(userPosition);
        return;
      }

      const to = userPosition;
      const start = performance.now();
      const DURATION_MS = 400;
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION_MS);
        const eased = 1 - (1 - t) * (1 - t);
        setGpsData({
          lat: lerp(from.lat, to.lat, eased),
          lon: lerp(from.lon, to.lon, eased),
          accuracy: lerp(from.accuracy, to.accuracy, eased),
          heading:
            from.heading !== null && to.heading !== null
              ? lerpAngle(from.heading, to.heading, eased)
              : to.heading,
        });
        gpsAnimFrameRef.current = t < 1 ? requestAnimationFrame(tick) : null;
      };
      gpsAnimFrameRef.current = requestAnimationFrame(tick);
    };

    if (loadedRef.current) run();
    else map.once("load", run);

    return () => {
      if (gpsAnimFrameRef.current !== null) {
        cancelAnimationFrame(gpsAnimFrameRef.current);
        gpsAnimFrameRef.current = null;
      }
    };
  }, [userPosition]);

  // Fly to a station on demand (e.g. a search result was picked).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusStation) return;
    map.flyTo({
      center: [focusStation.lon, focusStation.lat],
      zoom: Math.max(map.getZoom(), 13),
      duration: 600,
    });
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
        aria-label="Center on my location"
        title={userPosition ? "Center on my location" : "Waiting for your location…"}
        className="absolute top-3 right-3 z-[1000] rounded-full border border-neutral-300 bg-white p-2.5 text-neutral-700 shadow-md hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <LocateFixed size={18} />
      </button>
    </div>
  );
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
  const existing = popupsRef.current.get(station.code);
  if (existing) {
    existing.popup.remove();
    popupsRef.current.delete(station.code);
  }

  const container = document.createElement("div");
  const root = createRoot(container);
  const popup = new maplibregl.Popup({ offset: 12, maxWidth: "240px", closeButton: true })
    .setLngLat([station.lon, station.lat])
    .setDOMContent(container)
    .addTo(map);

  popup.on("close", () => {
    root.unmount();
    popupsRef.current.delete(station.code);
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
          <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {station.nameEn}
          </span>
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
