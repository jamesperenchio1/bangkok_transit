"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { stations, type LineKey, type Station } from "@/data/stations";
import { LocateButton } from "@/components/LocateButton";
import { PlaceCard, StationCard, TrainCard } from "@/components/map-cards";
import { createTransitLayer, textWidth, type TransitLayer } from "@/components/google-layer";
import { serverNow, useArrivalsStore } from "@/lib/arrivals-store";
import { googleMapStyles } from "@/lib/google-map-style";
import { loadGoogleMaps } from "@/lib/google-maps";
import type { Place } from "@/lib/google-places";
import { useT, strings, useLangStore } from "@/lib/i18n";
import { labelFontSize, layoutLabels, type LabelAnchor, type LabelCandidate, type Rect } from "@/lib/label-layout";
import { LINE_COLORS } from "@/lib/line-colors";
import {
  fetchLineGeometry,
  loadedLineGeometry,
  loadLineGeometryInBackground,
  stationLineSegments,
  type LineSegments,
} from "@/lib/line-geometry";
import { estimateTrains, routeHops, trainOnRoute, type TrainEstimate } from "@/lib/live-trains";
import { markMapPainted, whenMapPainted } from "@/lib/map-ready";
import {
  ENDPOINT_COLOR,
  FOCUS_ZOOM_CAP,
  FOCUS_ZOOM_FLOOR,
  focusPadding,
  panToReveal,
  LABEL_CODE_ZOOM,
  LOCATE_ZOOM,
  MARKER_FACTOR,
  PLACE_ZOOM,
  googleToMapLibreZoom,
  labelText,
  lineTracks,
  mapLibreToGoogleZoom,
  routeBounds,
  routeFitPadding,
  routeParts,
  stationVisuals,
  type StationVisual,
} from "@/lib/map-data";
import { easeOut, revealParts, ROUTE_DRAW_MS } from "@/lib/route-reveal";
import { motionDuration, useSettingsStore } from "@/lib/settings-store";
import type { PathOptions, PathResult } from "@/lib/transit-graph";
import type { FinalWalk } from "@/lib/place-station";
import {
  TRAIN_FRAME_MS,
  TRAIN_LABEL_ZOOM,
  TRAIN_SIZE_FACTOR,
  TRAIN_SLOW_FRAME_MS,
  TRAIN_TAP_RADIUS_PX,
  TRAIN_ARROW_PATH,
  TRAIN_ICON_SIZE,
  createTrainPlacer,
  describeTrain,
  summariseTrain,
  trainScale,
} from "@/lib/train-model";
import type { GeoPosition } from "@/lib/use-geolocation";

export interface GoogleTransitMapProps {
  onSelectStation: (station: Station) => void;
  /** A place card passes its place, so the route can end with the walk to it. */
  onSetStart: (station: Station, place?: Place) => void;
  onSetDestination: (station: Station, place?: Place) => void;
  startCode: string | null;
  destinationCode: string | null;
  path: PathResult | null;
  /** The walk from the destination station to a place picked as the destination. */
  finalWalk?: FinalWalk | null;
  /** Route preferences, so a place card picks its station the same way the route does. */
  pathOptions?: PathOptions;
  userPosition: GeoPosition | null;
  focusStation: Station | null;
  focusPlace: Place | null;
  sheetOpen: boolean;
  /** Called once, after the first view has finished drawing. */
  onLoad?: () => void;
  /** Google could not be used (offline, no key, blocked, bad key): the caller falls back to MapLibre. */
  onError?: (reason: string) => void;
}

const STATION_BOUNDS = {
  west: Math.min(...stations.map((s) => s.lon)),
  south: Math.min(...stations.map((s) => s.lat)),
  east: Math.max(...stations.map((s) => s.lon)),
  north: Math.max(...stations.map((s) => s.lat)),
};

/** The map has this long to show its first tiles before Google is given up on. */
const LOAD_TIMEOUT_MS = 15_000;

const WALK_COLOR = "#525252";
const GPS_COLOR = "#2563eb";
const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Thai", sans-serif`;

// Stacking inside the overlay layer, lowest first.
// A station's tap target sits above the trains (a station under the finger wins,
// as in MapLibre), while its drawn dot and the names stay below/above as drawn.
const Z = { dot: 10, train: 20, hit: 25, label: 30, pin: 40, gps: 45, card: 100 } as const;

interface StationNode {
  station: Station;
  dot: HTMLElement;
  ring: HTMLElement;
  /** The "this card belongs to me" ring, shown while the station's card is open. */
  sel: HTMLElement;
  fill: HTMLElement;
  label: HTMLElement;
  text: HTMLElement;
  visual: StationVisual;
  radius: number;
  /** What the label last showed, so an unchanged label is not rewritten. */
  shown: string;
}

interface TrainNode {
  root: HTMLElement;
  arrow: SVGSVGElement;
  label: HTMLElement;
  hit: HTMLElement;
  train: TrainEstimate;
  at: [number, number];
}

interface OpenCard {
  id: string;
  close: () => void;
  refresh: () => void;
}

function isDarkNow(theme: "system" | "light" | "dark"): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = css;
  if (className) node.className = className;
  return node;
}

function centered(css: string): string {
  return `position:absolute;left:0;top:0;transform:translate(-50%,-50%);${css}`;
}

/**
 * The opt-in Google basemap. It draws exactly what the MapLibre map draws -
 * lines, the route, station dots and names, live trains, the GPS dot, the
 * station and place cards - from the same shared data (lib/map-data.ts,
 * lib/train-model.ts, components/map-cards.tsx) and honours the same settings.
 * Only the drawing is different: native polylines for the track, and one DOM
 * layer (components/google-layer.ts) for everything that marks a point.
 */
export function GoogleTransitMap({
  onSelectStation,
  onSetStart,
  onSetDestination,
  startCode,
  destinationCode,
  path,
  finalWalk,
  pathOptions,
  userPosition,
  focusStation,
  focusPlace,
  sheetOpen,
  onLoad,
  onError,
}: GoogleTransitMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const layerRef = useRef<TransitLayer | null>(null);
  /** The track that is drawn: curved when known, straight stand-in until it arrives. */
  const [segments, setSegments] = useState<LineSegments | null>(null);
  /** The real curved track, or null until it has arrived (trains and routes wait for it). */
  const realGeometryRef = useRef<LineSegments | null>(null);
  const [ready, setReady] = useState(false);
  const baseLines = useRef<google.maps.Polyline[]>([]);
  const routeLines = useRef<google.maps.Polyline[]>([]);
  const gpsCircle = useRef<google.maps.Circle | null>(null);
  const nodes = useRef(new Map<string, StationNode>());
  const trainNodes = useRef(new Map<string, TrainNode>());
  const cardRef = useRef<OpenCard | null>(null);
  /** The train the open card follows, if the open card is a train's. */
  const trainCardRef = useRef<string | null>(null);
  const movingRef = useRef(false);
  const relayoutRef = useRef<() => void>(() => {});
  /** Boxes the station names occupy, so train labels (placed after them) stay clear of them. */
  const stationLabelRects = useRef<Rect[]>([]);

  const { lang } = useT();
  const settings = useSettingsStore((s) => s.settings);
  // "System" follows the OS live: Google's basemap does not follow our theme on its own.
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const isDark = settings.theme === "system" ? systemDark : settings.theme === "dark";

  const pathCodes = useMemo(() => new Set(path?.legs.map((l) => l.station.code) ?? []), [path]);
  const isRouting = path !== null;
  const routeLineKeys = useMemo(
    () => (path ? [...new Set(path.legs.map((l) => l.line).filter((l): l is LineKey => Boolean(l)))] : []),
    [path],
  );
  const routeHopsRef = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    routeHopsRef.current = path ? routeHops(path.legs) : null;
  }, [path]);

  // The newest props and settings, for handlers created once.
  const latest = useRef({ onSelectStation, onSetStart, onSetDestination, startCode, destinationCode, pathOptions, onLoad, onError, settings, lang, sheetOpen });
  useEffect(() => {
    latest.current = { onSelectStation, onSetStart, onSetDestination, startCode, destinationCode, pathOptions, onLoad, onError, settings, lang, sheetOpen };
  });

  const reducedMotion = () => motionDuration(1) === 0;

  /** Move the camera, animated unless the rider asked for less motion. */
  function moveTo(center: google.maps.LatLngLiteral, zoom?: number) {
    const map = mapRef.current;
    if (!map) return;
    movingRef.current = true;
    if (reducedMotion()) map.moveCamera({ center, ...(zoom !== undefined ? { zoom } : {}) });
    else {
      map.panTo(center);
      if (zoom !== undefined && zoom !== map.getZoom()) map.setZoom(zoom);
    }
  }

  // ---- Cards -------------------------------------------------------------

  function closeCard() {
    const open = cardRef.current;
    if (!open) return;
    cardRef.current = null;
    trainCardRef.current = null;
    open.close();
  }

  /** One card at a time, anchored above a point. `content` is re-run to refresh it. */
  function showCard(id: string, lat: number, lon: number, offset: number, content: (close: () => void) => ReactNode, extra?: () => void) {
    const layer = layerRef.current;
    if (!layer) return;
    closeCard();
    const g = window.google;
    const root = document.createElement("div");
    const card = document.createElement("div");
    card.className = "bt-card";
    card.style.setProperty("--bt-card-offset", `${offset}px`);
    const body = document.createElement("div");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "bt-card-close";
    close.setAttribute("aria-label", strings[latest.current.lang].close);
    close.textContent = "×";
    card.append(body, close);
    root.append(card);
    // Taps and wheel/drag on the card are the card's, not the map's.
    g.maps.OverlayView.preventMapHitsAndGesturesFrom(card);
    layer.add(id, lat, lon, root, Z.card);
    const react: Root = createRoot(body);
    const dismiss = () => {
      if (cardRef.current?.id === id) cardRef.current = null;
      document.removeEventListener("keydown", onKey);
      // Deferred: a close can be triggered from inside a React handler of this very root.
      queueMicrotask(() => react.unmount());
      layer.remove(id);
      extra?.();
    };
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeCard();
    }
    document.addEventListener("keydown", onKey);
    close.addEventListener("click", () => closeCard());
    const render = () => react.render(<>{content(() => closeCard())}</>);
    cardRef.current = { id, close: dismiss, refresh: render };
    render();
    close.focus({ preventScroll: true });
  }

  /** Ring on the tapped station (or none); it grows out of the dot like the MapLibre one. */
  function setSelected(code: string | null) {
    for (const [c, node] of nodes.current) {
      const on = c === code;
      if (on && node.sel.style.display !== "block") {
        node.sel.style.display = "block";
        if (!reducedMotion()) {
          node.sel.animate(
            [{ transform: "translate(-50%,-50%) scale(0.4)", opacity: 0.4 }, { transform: "translate(-50%,-50%) scale(1)", opacity: 1 }],
            { duration: 220, easing: "cubic-bezier(0.22,1,0.36,1)" },
          );
        }
      } else if (!on) node.sel.style.display = "none";
    }
  }

  /** Pan just enough that the tapped station and its card are fully on screen. */
  function revealStation(station: Station) {
    const map = mapRef.current;
    const container = containerRef.current;
    const projection = map?.getProjection();
    const center = map?.getCenter();
    if (!map || !container || !projection || !center) return;
    const g = window.google;
    const scale = Math.pow(2, map.getZoom() ?? 0);
    const at = projection.fromLatLngToPoint(new g.maps.LatLng(station.lat, station.lon));
    const mid = projection.fromLatLngToPoint(center);
    if (!at || !mid) return;
    const { width, height } = container.getBoundingClientRect();
    const move = panToReveal({ x: width / 2 + (at.x - mid.x) * scale, y: height / 2 + (at.y - mid.y) * scale }, { width, height });
    if (!move) return;
    movingRef.current = true;
    if (reducedMotion()) {
      // panBy always animates; jump to the same place instead.
      const to = projection.fromPointToLatLng(new g.maps.Point(mid.x + move.dx / scale, mid.y + move.dy / scale));
      if (to) map.moveCamera({ center: to });
    } else map.panBy(move.dx, move.dy);
  }

  function openStationCard(station: Station) {
    // After a choice the card lingers a beat so the button's tick is seen; it
    // only closes if this very card is still the open one (not one opened, or
    // closed and replaced, since).
    let mine: OpenCard | null = null;
    const closeSoon = (close: () => void) => setTimeout(() => cardRef.current === mine && close(), motionDuration(380));
    showCard(
      "card",
      station.lat,
      station.lon,
      14,
      (close) => (
        <StationCard
          station={station}
          startCode={latest.current.startCode}
          destinationCode={latest.current.destinationCode}
          onSetStart={(s) => {
            latest.current.onSetStart(s);
            closeSoon(close);
          }}
          onSetDestination={(s) => {
            latest.current.onSetDestination(s);
            closeSoon(close);
          }}
        />
      ),
      () => setSelected(null),
    );
    // After showCard: it closes the previous card first, whose cleanup clears the ring.
    mine = cardRef.current;
    setSelected(station.code);
  }

  function openPlaceCard(place: Place) {
    const layer = layerRef.current;
    if (!layer) return;
    const pin = el("div", "");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "28");
    svg.setAttribute("height", "38");
    svg.setAttribute("viewBox", "0 0 28 38");
    svg.style.cssText = "position:absolute;left:-14px;top:-38px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4));pointer-events:none";
    const body = document.createElementNS("http://www.w3.org/2000/svg", "path");
    body.setAttribute("d", "M14 0C6.3 0 0 6.2 0 13.8 0 24 14 38 14 38s14-14 14-24.2C28 6.2 21.7 0 14 0z");
    body.setAttribute("fill", "#dc2626");
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", "14");
    dot.setAttribute("cy", "13.5");
    dot.setAttribute("r", "5");
    dot.setAttribute("fill", "#ffffff");
    svg.append(body, dot);
    pin.append(svg);
    showCard(
      "card",
      place.lat,
      place.lon,
      38,
      (close) => (
        <PlaceCard
          place={place}
          startCode={latest.current.startCode}
          destinationCode={latest.current.destinationCode}
          pathOptions={latest.current.pathOptions}
          onSetStart={(s) => {
            latest.current.onSetStart(s, place);
            queueMicrotask(close);
          }}
          onSetDestination={(s) => {
            latest.current.onSetDestination(s, place);
            queueMicrotask(close);
          }}
        />
      ),
      () => layer.remove("pin"),
    );
    layer.add("pin", place.lat, place.lon, pin, Z.pin);
  }

  // ---- Boot --------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    let stopGeometry: (() => void) | null = null;
    let loadTimer: ReturnType<typeof setTimeout> | undefined;
    const listeners: google.maps.MapsEventListener[] = [];
    const base = nodes.current;
    const trains = trainNodes.current;

    const fail = (reason: string) => {
      if (cancelled) return;
      cancelled = true;
      // HomeClient keeps the build-time network on screen, then swaps in MapLibre.
      containerRef.current?.setAttribute("data-google-error", reason);
      latest.current.onError?.(reason);
    };

    async function boot() {
      // Google calls this when the key or its restrictions are rejected: the
      // map would otherwise stay a grey "for development purposes only" tile.
      (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => fail("auth");
      const g = await loadGoogleMaps();
      if (cancelled || !containerRef.current) return;

      const s = latest.current.settings;
      const startDark = isDarkNow(s.theme);
      const map = new g.maps.Map(containerRef.current, {
        center: { lat: (STATION_BOUNDS.north + STATION_BOUNDS.south) / 2, lng: (STATION_BOUNDS.east + STATION_BOUNDS.west) / 2 },
        zoom: 11,
        minZoom: 8,
        disableDefaultUI: true,
        zoomControl: s.zoomButtons,
        zoomControlOptions: { position: g.maps.ControlPosition.LEFT_TOP },
        gestureHandling: "greedy",
        clickableIcons: false,
        mapTypeId: s.googleMapType,
        styles: googleMapStyles({ dark: startDark, basemapLabels: s.basemapLabels }),
        backgroundColor: startDark ? "#1f2430" : "#f2efe9",
      });
      mapRef.current = map;
      (window as unknown as { __googleMap?: google.maps.Map }).__googleMap = map;
      map.fitBounds(STATION_BOUNDS, 24);

      loadTimer = setTimeout(() => fail("timeout"), LOAD_TIMEOUT_MS);
      listeners.push(
        g.maps.event.addListenerOnce(map, "tilesloaded", () => clearTimeout(loadTimer)),
        // The first view fully drawn: live times and the offline download may start.
        g.maps.event.addListenerOnce(map, "idle", () => {
          markMapPainted();
          latest.current.onLoad?.();
        }),
        map.addListener("dragstart", () => {
          movingRef.current = true;
          if (latest.current.settings.followMe) useSettingsStore.getState().update({ followMe: false });
        }),
        map.addListener("idle", () => {
          movingRef.current = false;
          relayoutRef.current();
        }),
        map.addListener("zoom_changed", () => relayoutRef.current()),
        // A tap on empty map closes the open card, like MapLibre's popups.
        map.addListener("click", () => closeCard()),
      );

      // The lines are drawn from the first frame: the curved track if it has
      // already arrived, straight station-to-station track otherwise, with the
      // curves swapped in when they land. Never a missing or unconnected line.
      const known = loadedLineGeometry();
      if (known) realGeometryRef.current = known;
      setSegments(known ?? stationLineSegments());
      if (!known) {
        stopGeometry = loadLineGeometryInBackground((real) => {
          if (cancelled) return;
          realGeometryRef.current = real;
          setSegments(real);
        });
      }

      const layer = createTransitLayer(g);
      layerRef.current = layer;
      layer.onDraw = () => relayoutRef.current();
      layer.onReady = () => {
        if (!cancelled) setReady(true);
      };
      layer.setMap(map);
    }

    void boot().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));

    return () => {
      cancelled = true;
      clearTimeout(loadTimer);
      stopGeometry?.();
      for (const l of listeners) l.remove();
      for (const line of [...baseLines.current, ...routeLines.current]) line.setMap(null);
      baseLines.current = [];
      routeLines.current = [];
      gpsCircle.current?.setMap(null);
      gpsCircle.current = null;
      closeCard();
      layerRef.current?.setMap(null);
      layerRef.current = null;
      base.clear();
      trains.clear();
      mapRef.current = null;
      (window as unknown as { __googleMap?: unknown }).__googleMap = undefined;
    };
    // The map is created once; every setting and prop is applied by the effects below.
  }, []);

  // ---- Map options: buttons, map type, theme, basemap names ---------------

  const { zoomButtons, googleMapType, basemapLabels } = settings;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setOptions({
      zoomControl: zoomButtons,
      mapTypeId: googleMapType,
      styles: googleMapStyles({ dark: isDark, basemapLabels }),
      backgroundColor: isDark ? "#1f2430" : "#f2efe9",
    });
  }, [ready, zoomButtons, googleMapType, isDark, basemapLabels]);

  // ---- Lines -------------------------------------------------------------

  const { dimLines, onlyRouteLines, lineWidth, hiddenLines, routeWidth } = settings;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !segments) return;
    const g = window.google;
    for (const line of baseLines.current) line.setMap(null);
    const grey = isRouting && dimLines;
    baseLines.current = lineTracks(segments)
      // Hidden lines, and (while routing, if asked) every line the route doesn't use.
      .filter(({ line }) => !hiddenLines.includes(line) && !(isRouting && onlyRouteLines && !routeLineKeys.includes(line)))
      .map(
        ({ line, points }) =>
          new g.maps.Polyline({
            map,
            path: points.map(([lat, lng]) => ({ lat, lng })),
            strokeColor: grey ? "#cccccc" : LINE_COLORS[line],
            strokeOpacity: grey ? 0.6 : 0.9,
            strokeWeight: grey ? Math.max(2, lineWidth - 1) : lineWidth,
            clickable: false,
            zIndex: 2,
          }),
      );
  }, [ready, segments, isRouting, dimLines, onlyRouteLines, lineWidth, hiddenLines, routeLineKeys]);

  // ---- The highlighted route ----------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const line of routeLines.current) line.setMap(null);
    routeLines.current = [];
    if (!path) return;
    let stale = false;
    let raf = 0;
    void fetchLineGeometry().then((real) => {
      if (stale) return;
      const g = window.google;
      const fullParts = routeParts(path, real, finalWalk);
      routeLines.current = fullParts.map(({ line, walk, points }) => {
        const pathLatLng = points.map(([lat, lng]) => ({ lat, lng }));
        return walk
          ? new g.maps.Polyline({
              map,
              path: pathLatLng,
              strokeOpacity: 0,
              clickable: false,
              zIndex: 20,
              // Dots: Google has no dash style, so a repeated circle symbol draws it.
              icons: [
                {
                  icon: {
                    path: g.maps.SymbolPath.CIRCLE,
                    fillOpacity: 1,
                    fillColor: WALK_COLOR,
                    strokeColor: "#ffffff",
                    strokeWeight: 1,
                    scale: Math.max(2.5, routeWidth / 2 - 0.5),
                  },
                  offset: "0",
                  repeat: "10px",
                },
              ],
            })
          : new g.maps.Polyline({
              map,
              path: pathLatLng,
              strokeColor: LINE_COLORS[line as LineKey] ?? "#666666",
              strokeOpacity: 1,
              strokeWeight: routeWidth,
              clickable: false,
              zIndex: 20,
            });
      });
      // Same draw-in as the MapLibre twin: the route travels origin to destination.
      const total = motionDuration(ROUTE_DRAW_MS);
      if (total === 0) return;
      const toLatLng = (pts: [number, number][]) => pts.map(([lat, lng]) => ({ lat, lng }));
      const t0 = performance.now();
      const step = (now: number) => {
        if (stale) return;
        const t = Math.min(1, (now - t0) / total);
        revealParts(fullParts, easeOut(t)).forEach((part, i) => routeLines.current[i]?.setPath(toLatLng(part.points)));
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
    return () => {
      stale = true;
      cancelAnimationFrame(raf);
    };
  }, [ready, path, finalWalk, routeWidth]);

  // Keep a planned route in view, in whatever the route sheet leaves uncovered.
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container || !ready || !path) return;
    const g = window.google;
    const rect = container.getBoundingClientRect();
    const [[west, south], [east, north]] = routeBounds(path, finalWalk);
    movingRef.current = true;
    map.fitBounds({ west, south, east, north }, routeFitPadding(sheetOpen, rect.bottom, rect.height, window.innerHeight));
    const cap = mapLibreToGoogleZoom(FOCUS_ZOOM_CAP);
    const listener = g.maps.event.addListenerOnce(map, "idle", () => {
      if ((map.getZoom() ?? 0) > cap) map.setZoom(cap);
    });
    return () => listener.remove();
  }, [ready, path, finalWalk, sheetOpen]);

  // ---- Stations: dots, tap targets and names -------------------------------

  const { markerSize, showLabels, labelCodes, labelLanguage, labelMinZoom } = settings;

  function buildStationNode(station: Station): StationNode {
    const layer = layerRef.current!;
    const dot = el("div", "");
    const hitRoot = el("div", "");
    const hit = el("button", centered("width:44px;height:44px;border:0;padding:0;background:transparent;border-radius:9999px;cursor:pointer"));
    hit.type = "button";
    hit.tabIndex = -1;
    hit.setAttribute("aria-label", station.nameEn);
    hit.addEventListener("click", (e) => {
      e.stopPropagation();
      latest.current.onSelectStation(station);
      openStationCard(station);
      revealStation(station);
    });
    const ring = el("span", centered(`width:28px;height:28px;box-sizing:border-box;border:3px dashed ${ENDPOINT_COLOR};border-radius:9999px;display:none;pointer-events:none`));
    const fill = el("span", centered("border-radius:9999px;box-sizing:border-box;pointer-events:none"));
    const sel = el("span", centered(`width:34px;height:34px;box-sizing:border-box;border:3px solid ${ENDPOINT_COLOR};background:rgba(22,163,74,.18);border-radius:9999px;display:none;pointer-events:none`));
    dot.append(sel, ring, fill);
    hitRoot.append(hit);
    layer.add(`d:${station.code}`, station.lat, station.lon, dot, Z.dot);
    layer.add(`h:${station.code}`, station.lat, station.lon, hitRoot, Z.hit);

    const label = el("div", "");
    const text = el("div", `position:absolute;left:0;top:0;white-space:nowrap;pointer-events:none;font:700 12px/1.2 ${FONT}`);
    label.append(text);
    label.style.display = "none";
    layer.add(`l:${station.code}`, station.lat, station.lon, label, Z.label);
    return { station, dot, ring, sel, fill, label, text, visual: undefined as unknown as StationVisual, radius: 4, shown: "" };
  }

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !ready) return;
    const visuals = stationVisuals(pathCodes, startCode, destinationCode, isRouting, hiddenLines);
    const k = MARKER_FACTOR[markerSize];
    const keep = new Set<string>();
    for (const v of visuals) {
      keep.add(v.code);
      const node = nodes.current.get(v.code) ?? buildStationNode(v.station);
      nodes.current.set(v.code, node);
      node.visual = v;
      node.radius = v.radius * k;
      const size = node.radius * 2 + v.strokeWidth;
      Object.assign(node.fill.style, {
        width: `${size}px`,
        height: `${size}px`,
        background: v.fillColor,
        opacity: String(v.fillOpacity),
        border: `${v.strokeWidth}px solid ${v.strokeColor}`,
      });
      node.ring.style.display = v.isDestination ? "block" : "none";
      node.shown = "";
    }
    for (const code of [...nodes.current.keys()]) {
      if (keep.has(code)) continue;
      layer.remove(`d:${code}`);
      layer.remove(`h:${code}`);
      layer.remove(`l:${code}`);
      nodes.current.delete(code);
    }
    relayoutRef.current();
    // buildStationNode only reads refs and the stable `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pathCodes, startCode, destinationCode, isRouting, hiddenLines, markerSize]);

  // Names: which show, where, and in what text - the same rules as MapLibre's
  // label layer (zoom threshold, sort-key priority, variable anchor, language,
  // code on a second line once zoomed in), computed in lib/label-layout.ts.
  useEffect(() => {
    relayoutRef.current = () => {
      const layer = layerRef.current;
      const map = mapRef.current;
      if (!layer || !map || nodes.current.size === 0) return;
      const s = latest.current.settings;
      const zoom = googleToMapLibreZoom(map.getZoom() ?? 11);
      if (!s.showLabels || zoom < s.labelMinZoom) {
        for (const node of nodes.current.values()) node.label.style.display = "none";
        return;
      }
      const size = labelFontSize(zoom);
      const withCode = s.labelCodes && zoom >= LABEL_CODE_ZOOM;
      const candidates: LabelCandidate[] = [];
      const texts = new Map<string, ReturnType<typeof labelText>>();
      for (const [code, node] of nodes.current) {
        const p = layer.pointOf(node.station.lat, node.station.lon);
        if (!p) continue;
        const text = labelText(node.station, latest.current.lang, s.labelLanguage, withCode);
        texts.set(code, text);
        const widths = [textWidth(text.primary, size)];
        if (text.secondary) widths.push(textWidth(text.secondary, size * 0.85));
        if (text.code) widths.push(textWidth(text.code, size * 0.8));
        const lines = 1 + (text.secondary ? 0.85 : 0) + (text.code ? 0.8 : 0);
        candidates.push({
          id: code,
          x: p.x,
          y: p.y,
          w: Math.max(...widths) + 2,
          h: size * 1.2 * lines,
          sortKey: node.visual.sortKey,
          radius: node.radius,
        });
      }
      const { anchors, rects } = layoutLabels(candidates);
      stationLabelRects.current = rects;
      const dark = isDarkNow(s.theme);
      for (const [code, node] of nodes.current) {
        const anchor = anchors.get(code);
        const text = texts.get(code);
        if (!anchor || !text) {
          node.label.style.display = "none";
          continue;
        }
        node.label.style.display = "block";
        applyLabel(node, text, anchor, size, dark);
      }
    };
    relayoutRef.current();
  }, [ready, showLabels, labelCodes, labelLanguage, labelMinZoom, lang, isDark, markerSize, hiddenLines, pathCodes]);

  // ---- GPS -----------------------------------------------------------------

  const { showLocation, followMe } = settings;
  useEffect(() => {
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!layer || !map || !ready) return;
    const g = window.google;
    if (!userPosition || !showLocation) {
      layer.remove("gps");
      gpsCircle.current?.setMap(null);
      gpsCircle.current = null;
      return;
    }
    const { lat, lon } = userPosition;
    // Move the dot in place. Re-creating it on every fix (the old approach)
    // tore down and rebuilt the overlay element several times a minute, which
    // reads as flicker on a phone - the very thing a live dot must not do.
    if (layer.has("gps")) {
      layer.move("gps", lat, lon);
    } else {
      const dot = el("div", "");
      dot.append(el("span", centered(`width:18px;height:18px;box-sizing:border-box;border-radius:9999px;background:${GPS_COLOR};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.15)`)));
      layer.add("gps", lat, lon, dot, Z.gps);
    }
    // The accuracy estimate as a real circle on the ground, like MapLibre's.
    if (userPosition.accuracy > 0) {
      if (gpsCircle.current) {
        gpsCircle.current.setCenter({ lat, lng: lon });
        gpsCircle.current.setRadius(userPosition.accuracy);
        gpsCircle.current.setMap(map);
      } else {
        gpsCircle.current = new g.maps.Circle({
          map,
          center: { lat, lng: lon },
          radius: userPosition.accuracy,
          fillColor: GPS_COLOR,
          fillOpacity: 0.12,
          strokeColor: GPS_COLOR,
          strokeOpacity: 0.35,
          strokeWeight: 1,
          clickable: false,
          zIndex: 1,
        });
      }
    } else {
      gpsCircle.current?.setMap(null);
      gpsCircle.current = null;
    }
  }, [ready, userPosition, showLocation]);

  // "Follow me": keep the map centred on the rider; dragging the map turns it off.
  useEffect(() => {
    if (!ready || !userPosition || !followMe || movingRef.current) return;
    moveTo({ lat: userPosition.lat, lng: userPosition.lon });
    // moveTo reads only refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, userPosition, followMe]);

  // ---- Cards stay in step with the route state -----------------------------

  useEffect(() => {
    cardRef.current?.refresh();
  }, [startCode, destinationCode]);

  // ---- Camera: a picked station, a picked place ----------------------------

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const container = containerRef.current;
    if (!map || !layer || !container || !ready || !focusStation) return;
    const g = window.google;
    const { startCode: s, destinationCode: d } = latest.current;
    // The other end of a route in progress, if any: picking a destination
    // must keep the start in view (and vice versa), not replace it.
    const otherCode = [s, d].find((c) => c && c !== focusStation.code);
    const other = otherCode ? stations.find((x) => x.code === otherCode) : undefined;
    const rect = container.getBoundingClientRect();
    // With the route sheet open, what it covers is not free map.
    const padding = focusPadding(latest.current.sheetOpen, rect.bottom, rect.height, window.innerHeight);
    const visible = (st: Station) => {
      const p = layer.containerPointOf(st.lat, st.lon);
      return (
        !!p &&
        p.x >= padding.left &&
        p.x <= rect.width - padding.right &&
        p.y >= padding.top &&
        p.y <= rect.height - padding.bottom
      );
    };
    const points = other ? [focusStation, other] : [focusStation];
    if (!points.every(visible)) {
      const base = { lat: focusStation.lat, lng: focusStation.lon };
      // Centre the station in the free part of the map: the camera centre sits
      // below it by half of (covered bottom - card room above).
      const projection = map.getProjection();
      // The shift is in screen pixels, so measure it at the zoom the camera
      // will end at (a lone pick is raised to the focus floor), not the current one.
      const zoom =
        latest.current.settings.autoZoom && !other
          ? Math.max(map.getZoom() ?? 11, mapLibreToGoogleZoom(FOCUS_ZOOM_FLOOR))
          : (map.getZoom() ?? 11);
      const target = (() => {
        const shiftPx = (padding.bottom - padding.top) / 2;
        if (!projection || shiftPx === 0) return base;
        const world = projection.fromLatLngToPoint(new g.maps.LatLng(base.lat, base.lng));
        const moved = world && projection.fromPointToLatLng(new g.maps.Point(world.x, world.y + shiftPx / Math.pow(2, zoom)));
        return moved ? { lat: moved.lat(), lng: moved.lng() } : base;
      })();
      if (!latest.current.settings.autoZoom) moveTo(target);
      else if (other) {
        movingRef.current = true;
        map.fitBounds(
          {
            west: Math.min(focusStation.lon, other.lon),
            east: Math.max(focusStation.lon, other.lon),
            south: Math.min(focusStation.lat, other.lat),
            north: Math.max(focusStation.lat, other.lat),
          },
          padding,
        );
        const cap = mapLibreToGoogleZoom(FOCUS_ZOOM_CAP);
        g.maps.event.addListenerOnce(map, "idle", () => {
          if ((map.getZoom() ?? 0) > cap) map.setZoom(cap);
        });
      } else {
        moveTo(target, Math.max(map.getZoom() ?? 11, mapLibreToGoogleZoom(FOCUS_ZOOM_FLOOR)));
      }
    }
    openStationCard(focusStation);
    // The camera and card are driven by the pick alone; the rest is read from `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focusStation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focusPlace) return;
    const zoom = latest.current.settings.autoZoom ? Math.max(map.getZoom() ?? 11, mapLibreToGoogleZoom(PLACE_ZOOM)) : undefined;
    moveTo({ lat: focusPlace.lat, lng: focusPlace.lon }, zoom);
    openPlaceCard(focusPlace);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focusPlace]);

  // ---- Live trains ---------------------------------------------------------

  // Train settings are read fresh on every frame, so a change shows within a
  // quarter of a second and nothing here needs to restart.
  useEffect(() => {
    const layer = layerRef.current;
    const container = containerRef.current;
    if (!layer || !container || !ready) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const place = createTrainPlacer();
    const live = trainNodes.current;
    const list = document.createElement("ul");
    list.className = "sr-only";
    list.setAttribute("aria-label", strings[useLangStore.getState().lang].trainsRegion);
    container.after(list);
    let listSignature = "";

    function openTrainCard(id: string) {
      const node = live.get(id);
      if (!node) return;
      showCard(
        "card",
        node.at[1],
        node.at[0],
        20,
        () => {
          const current = live.get(id);
          return current ? <TrainCard trainNo={current.train.trainNo} text={describeTrain(current.train)} /> : null;
        },
      );
      trainCardRef.current = id;
    }

    function buildTrain(id: string): TrainNode {
      const root = el("div", "");
      const hit = el(
        "button",
        centered(`width:${TRAIN_TAP_RADIUS_PX * 2}px;height:${TRAIN_TAP_RADIUS_PX * 2}px;border:0;padding:0;background:transparent;border-radius:9999px;cursor:pointer`),
      );
      hit.type = "button";
      hit.tabIndex = -1;
      hit.addEventListener("click", (e) => {
        e.stopPropagation();
        openTrainCard(id);
      });
      const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      arrow.setAttribute("viewBox", `0 0 ${TRAIN_ICON_SIZE} ${TRAIN_ICON_SIZE}`);
      arrow.style.cssText = centered("pointer-events:none;overflow:visible;transition:transform .25s linear");
      // Outer dark edge, then white outline, then the navy body: contrast against any basemap.
      for (const [stroke, width, fill] of [["#0b1220", 8, "none"], ["#ffffff", 6, "none"], ["none", 0, "#0b2a6b"]] as const) {
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", TRAIN_ARROW_PATH);
        p.setAttribute("stroke", stroke);
        p.setAttribute("stroke-width", String(width));
        p.setAttribute("stroke-linejoin", "round");
        p.setAttribute("fill", fill);
        arrow.appendChild(p);
      }
      const label = el("div", `position:absolute;left:0;top:0;white-space:nowrap;pointer-events:none;font:700 13px/1.2 ${FONT};color:#0b2a6b;-webkit-text-stroke:5px #fff;paint-order:stroke fill;text-shadow:0 0 3px #fff`);
      root.append(arrow, hit, label);
      return { root, arrow, label, hit, train: undefined as unknown as TrainEstimate, at: [0, 0] };
    }

    function frame() {
      if (cancelled || document.hidden) return;
      const s = useSettingsStore.getState().settings;
      const segs = realGeometryRef.current;
      if (!s.showTrains || !segs) {
        for (const [id] of live) layer!.remove(`t:${id}`);
        live.clear();
        paintList([]);
        if (trainCardRef.current) closeCard();
        return;
      }
      const hops = routeHopsRef.current;
      const routing = hops !== null;
      const zoom = googleToMapLibreZoom(mapRef.current?.getZoom() ?? 11);
      const scale = trainScale(zoom, TRAIN_SIZE_FACTOR[s.trainSize]);
      const seen = new Set<string>();
      const items: { id: string; text: string }[] = [];
      const labelCandidates: LabelCandidate[] = [];
      for (const train of estimateTrains(useArrivalsStore.getState().map, serverNow())) {
        const onRoute = trainOnRoute(train, hops);
        // "Hide": a train that isn't on the route being shown doesn't exist as
        // far as the map, the tap targets and the screen-reader list go.
        if (!onRoute && s.otherTrains === "hide") continue;
        const placed = place(train, segs);
        if (!placed) continue;
        seen.add(train.id);
        let node = live.get(train.id);
        if (!node) {
          node = buildTrain(train.id);
          live.set(train.id, node);
          layer!.add(`t:${train.id}`, placed.at[1], placed.at[0], node.root, Z.train);
        } else {
          layer!.move(`t:${train.id}`, placed.at[1], placed.at[0]);
        }
        node.train = train;
        node.at = placed.at;
        const summary = summariseTrain(train);
        items.push({ id: train.id, text: summary.sentence });
        const greyed = routing && s.otherTrains === "dim" && !onRoute;
        node.arrow.style.width = `${TRAIN_ICON_SIZE * scale}px`;
        node.arrow.style.height = `${TRAIN_ICON_SIZE * scale}px`;
        node.arrow.style.transform = `translate(-50%,-50%) rotate(${placed.bearing}deg)`;
        // Trains ease back a little while a route is shown; the ones off it fade right back.
        node.arrow.style.opacity = greyed ? "0.22" : routing ? "0.85" : "1";
        // Greyed-out trains carry no text and cannot be tapped.
        node.hit.style.display = greyed ? "none" : "block";
        const showText = s.trainLabels && zoom >= TRAIN_LABEL_ZOOM && !greyed;
        node.label.style.display = "none";
        const point = showText ? layer!.pointOf(placed.at[1], placed.at[0]) : null;
        if (point) {
          if (node.label.textContent !== summary.label) node.label.textContent = summary.label;
          const radius = (TRAIN_ICON_SIZE * scale) / 2;
          node.label.style.transform = `translate(-50%, ${radius + 4}px)`;
          labelCandidates.push({
            id: train.id,
            x: point.x,
            y: point.y,
            w: textWidth(summary.label, 13) + 2,
            h: 13 * 1.2,
            sortKey: onRoute ? 0 : 1,
            radius,
          });
        }
      }
      // Like MapLibre's "text-optional" labels: the text goes where it fits
      // (below the arrow, clear of station names and of other trains' text)
      // and is left off where it would pile up.
      const { anchors: shownText } = layoutLabels(labelCandidates, { anchors: ["bottom"], obstacles: stationLabelRects.current });
      for (const [id, node] of live) node.label.style.display = shownText.has(id) ? "block" : "none";
      for (const [id] of live) {
        if (seen.has(id)) continue;
        layer!.remove(`t:${id}`);
        live.delete(id);
      }
      paintList(items);
      // The open card follows its train, and closes when the train is gone.
      if (trainCardRef.current) {
        const node = live.get(trainCardRef.current);
        if (!node) closeCard();
        else {
          layer!.move("card", node.at[1], node.at[0]);
          cardRef.current?.refresh();
        }
      }
    }

    // The same visually hidden list MapLibre keeps, so a screen reader or the
    // keyboard can reach every train; rebuilt only when its text changes.
    function paintList(items: { id: string; text: string }[]) {
      const signature = items.map((i) => `${i.id}|${i.text}`).join("\n");
      list.setAttribute("aria-label", strings[useLangStore.getState().lang].trainsRegion);
      if (signature === listSignature) return;
      listSignature = signature;
      list.replaceChildren(
        ...items.map((item) => {
          const li = document.createElement("li");
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = item.text;
          button.className =
            "focus:not-sr-only focus:fixed focus:bottom-4 focus:left-4 focus:z-[2000] focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-neutral-900 focus:shadow-lg";
          button.addEventListener("click", () => {
            const node = live.get(item.id);
            if (!node) return;
            moveTo({ lat: node.at[1], lng: node.at[0] }, Math.max(mapRef.current?.getZoom() ?? 11, mapLibreToGoogleZoom(FOCUS_ZOOM_CAP)));
            openTrainCard(item.id);
          });
          li.append(button);
          return li;
        }),
      );
    }

    // A timeout chain rather than an interval so the battery-saver setting
    // takes effect on the next tick without restarting anything.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      if (cancelled) return;
      frame();
      const s = useSettingsStore.getState().settings;
      timer = setTimeout(tick, reduced || s.reduceMotion || s.trainRate === "saver" ? TRAIN_SLOW_FRAME_MS : TRAIN_FRAME_MS);
    };
    // Trains are a second thought: the map and stations come first.
    void whenMapPainted().then(() => {
      if (!cancelled) tick();
    });
    document.addEventListener("visibilitychange", frame);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", frame);
      for (const [id] of live) layer.remove(`t:${id}`);
      live.clear();
      list.remove();
    };
    // showCard/closeCard only read refs and `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {settings.locateButton && (
        <LocateButton
          position={userPosition}
          onLocate={(p) => {
            const map = mapRef.current;
            if (!map) return;
            moveTo({ lat: p.lat, lng: p.lon }, Math.max(map.getZoom() ?? 11, mapLibreToGoogleZoom(LOCATE_ZOOM)));
          }}
        />
      )}
    </div>
  );
}

/** Write a station label's text, anchor and colours. Skips the DOM work when nothing changed. */
function applyLabel(node: StationNode, text: ReturnType<typeof labelText>, anchor: LabelAnchor, size: number, dark: boolean) {
  const key = [text.primary, text.secondary ?? "", text.code ?? "", anchor, size.toFixed(1), dark, node.visual.labelOpacity, node.radius].join("|");
  if (key === node.shown) return;
  node.shown = key;
  const d = node.radius + 4;
  const place: Record<LabelAnchor, { transform: string; align: string }> = {
    right: { transform: `translate(${d}px,-50%)`, align: "left" },
    left: { transform: `translate(calc(-100% - ${d}px),-50%)`, align: "right" },
    top: { transform: `translate(-50%,calc(-100% - ${d}px))`, align: "center" },
    bottom: { transform: `translate(-50%,${d}px)`, align: "center" },
  };
  const halo = dark ? "#111827" : "#ffffff";
  Object.assign(node.text.style, {
    transform: place[anchor].transform,
    textAlign: place[anchor].align,
    fontSize: `${size}px`,
    color: dark ? "#e5e7eb" : "#1f2937",
    opacity: String(node.visual.labelOpacity),
    // White (or dark) halo so names stay readable over any basemap, like MapLibre's text-halo.
    webkitTextStroke: `3.2px ${halo}`,
    paintOrder: "stroke fill",
    textShadow: `0 0 2px ${halo}, 0 0 2px ${halo}`,
  });
  const line = (content: string, scale: number) => {
    const row = document.createElement("div");
    row.textContent = content;
    if (scale !== 1) row.style.fontSize = `${size * scale}px`;
    return row;
  };
  node.text.replaceChildren(
    line(text.primary, 1),
    ...(text.secondary ? [line(text.secondary, 0.85)] : []),
    ...(text.code ? [line(text.code, 0.8)] : []),
  );
}
