import * as maplibregl from "maplibre-gl";
import { serverNow, useArrivalsStore } from "@/lib/arrivals-store";
import { strings, useLangStore } from "@/lib/i18n";
import type { LineSegments } from "@/lib/line-geometry";
import { estimateTrains, trainOnRoute, type TrainEstimate } from "@/lib/live-trains";
import { useSettingsStore, type Settings } from "@/lib/settings-store";
import {
  TRAIN_FRAME_MS as FRAME_MS,
  TRAIN_ARROW_PATH,
  TRAIN_ICON_SIZE,
  TRAIN_SIZE_FACTOR as SIZE_FACTOR,
  TRAIN_SLOW_FRAME_MS as REDUCED_MOTION_FRAME_MS,
  TRAIN_TAP_RADIUS_PX as TAP_RADIUS_PX,
  TRAIN_ZOOM_STOPS,
  VISIBLE_MOVE_PX,
  VISIBLE_TURN_DEG,
  createTrainPlacer,
  describeTrain,
  summariseTrain,
  turnBetween,
} from "@/lib/train-model";

export const TRAINS_SOURCE = "live-trains";
export const TRAINS_LAYER = "live-trains-layer";
const TRAINS_LABEL_LAYER = "live-trains-label-layer";
const TRAINS_HIT_LAYER = "live-trains-hit-layer";

interface DrawnTrain {
  at: [number, number];
  bearing: number;
}

function trainsMoved(
  map: maplibregl.Map,
  now: Map<string, DrawnTrain>,
  drawn: Map<string, DrawnTrain>,
): boolean {
  if (now.size !== drawn.size) return true;
  for (const [id, { at, bearing }] of now) {
    const before = drawn.get(id);
    if (!before) return true;
    // At a bend the icon turns while its centre barely moves.
    if (turnBetween(bearing, before.bearing) >= VISIBLE_TURN_DEG) return true;
    const a = map.project(at);
    const b = map.project(before.at);
    if (Math.hypot(a.x - b.x, a.y - b.y) >= VISIBLE_MOVE_PX) return true;
  }
  return false;
}

const TRAIN_ICON = "live-train";

/**
 * A bold navigation arrow, tip up, so direction reads from the shape alone:
 * dark navy fill, a thick white outline and a thin dark edge outside that,
 * which keeps at least 3:1 contrast (WCAG 1.4.11) against light, dark, green
 * and water basemap pixels alike. It is deliberately large and not tinted by
 * line: colour never carries meaning here, the text label and the card do.
 * Drawn at 2x so it stays sharp on phones.
 */
function drawTrainIcon(): ImageData | null {
  const ratio = 2;
  const S = TRAIN_ICON_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = S * ratio;
  canvas.height = S * ratio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  ctx.lineJoin = "round";
  const arrow = new Path2D(TRAIN_ARROW_PATH);
  // Outer dark edge, then white outline, then the navy body.
  ctx.strokeStyle = "#0b1220";
  ctx.lineWidth = 8;
  ctx.stroke(arrow);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.stroke(arrow);
  ctx.fillStyle = "#0b2a6b";
  ctx.fill(arrow);
  return ctx.getImageData(0, 0, S * ratio, S * ratio);
}

/** Icon size by zoom, scaled (a zoom expression can only sit at the top level, so the factor goes into the stops). */
function iconSize(factor: number): maplibregl.ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    ...TRAIN_ZOOM_STOPS.flatMap(([zoom, scale]) => [zoom, scale * factor]),
  ] as unknown as maplibregl.ExpressionSpecification;
}

/** Train features carry `onRoute`; this keeps only the ones that are. */
const ON_ROUTE: maplibregl.FilterSpecification = ["==", ["get", "onRoute"], true];

/** Layer to add; call once the style has loaded, before the station labels so names stay on top. */
export function addLiveTrainsLayer(map: maplibregl.Map, beforeId: string): void {
  const image = drawTrainIcon();
  if (image && !map.hasImage(TRAIN_ICON)) map.addImage(TRAIN_ICON, image, { pixelRatio: 2 });
  map.addSource(TRAINS_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer(
    {
      id: TRAINS_LAYER,
      type: "symbol",
      source: TRAINS_SOURCE,
      layout: {
        "icon-image": TRAIN_ICON,
        "icon-size": iconSize(1),
        // Turn with the map, not the screen: a train keeps pointing along its track.
        "icon-rotate": ["get", "bearing"],
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
    beforeId,
  );
  // Text next to the arrow once zoomed in, so direction is also written down.
  map.addLayer(
    {
      id: TRAINS_LABEL_LAYER,
      type: "symbol",
      source: TRAINS_SOURCE,
      minzoom: 14,
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 13,
        "text-anchor": "top",
        "text-offset": [0, 1.3],
        "text-max-width": 10,
        "text-optional": true,
      },
      paint: { "text-color": "#0b2a6b", "text-halo-color": "#ffffff", "text-halo-width": 2.5 },
    },
    beforeId,
  );
  // Invisible and bigger than the train: a fingertip is far wider than a
  // 10 px-wide icon, and the train is moving. Same trick as the station
  // markers' hit layer.
  map.addLayer(
    {
      id: TRAINS_HIT_LAYER,
      type: "circle",
      source: TRAINS_SOURCE,
      paint: { "circle-radius": TAP_RADIUS_PX, "circle-opacity": 0 },
    },
    beforeId,
  );
}

interface LiveTrainsOptions {
  getSegments: () => LineSegments | null;
  /** Directed hops of the route being shown, or null when there is none. */
  getRouteHops?: () => ReadonlySet<string> | null;
  /** A tap on a station marker takes priority over a train beside it. */
  stationHitLayer: string;
}

/**
 * Keep the trains layer updated from the arrivals store until the returned
 * function is called. Reads only what the app already holds - it never
 * fetches - and pauses while the tab is hidden. Tapping a train opens a small
 * card that follows it.
 */
export function startLiveTrains(map: maplibregl.Map, { getSegments, getRouteHops, stationHitLayer }: LiveTrainsOptions): () => void {
  const place = createTrainPlacer();
  let drawn = false;
  let latest = new Map<string, { train: TrainEstimate; at: [number, number] }>();
  let selected: { id: string; popup: maplibregl.Popup; title: HTMLElement; toward: HTMLElement; next: HTMLElement } | null =
    null;

  // A visually hidden list of the same trains, outside the canvas, so a screen
  // reader or the keyboard can reach them. Each entry shows itself when
  // focused and opens the train's card. Rebuilt only when its text changes,
  // never per frame, and not a live region, so it doesn't chatter.
  const list = document.createElement("ul");
  list.className = "sr-only";
  list.setAttribute("aria-label", strings[useLangStore.getState().lang].trainsRegion);
  map.getContainer().after(list);
  let listSignature = "";
  function paintList(items: { id: string; text: string; at: [number, number] }[]) {
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
          const entry = latest.get(item.id);
          if (!entry) return;
          map.easeTo({ center: entry.at, zoom: Math.max(map.getZoom(), 15), duration: 0 });
          openCard(entry.train, entry.at);
        });
        li.append(button);
        return li;
      }),
    );
  }

  // --- The card that opens when a train is tapped ---

  function paintCard(train: TrainEstimate) {
    if (!selected) return;
    const text = describeTrain(train);
    if (selected.title.textContent !== text.title) selected.title.textContent = text.title;
    if (selected.toward.textContent !== text.toward) selected.toward.textContent = text.toward;
    if (selected.next.textContent !== text.next) selected.next.textContent = text.next;
    selected.next.hidden = text.next === "";
  }

  function openCard(train: TrainEstimate, at: [number, number]) {
    selected?.popup.remove();
    const container = document.createElement("div");
    container.className = "flex flex-col gap-0.5 py-0.5";
    const head = document.createElement("div");
    head.className = "flex items-center gap-2";
    const chip = document.createElement("span");
    // Neutral, like the train itself: the line is already clear from the track it's on.
    chip.className =
      "shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-xs font-semibold text-white dark:bg-neutral-200 dark:text-neutral-900";
    chip.textContent = train.trainNo;
    const title = document.createElement("span");
    title.className = "text-sm font-semibold";
    head.append(chip, title);
    const toward = document.createElement("div");
    toward.className = "text-sm";
    const next = document.createElement("div");
    next.className = "text-xs text-neutral-600 dark:text-neutral-300";
    container.append(head, toward, next);

    const popup = new maplibregl.Popup({
      offset: 20,
      maxWidth: "min(300px, calc(100vw - 24px))",
      closeButton: true,
      focusAfterOpen: false,
    })
      .setLngLat(at)
      .setDOMContent(container)
      .addTo(map);
    // Same 44 px close target as the station cards.
    const closeButton = popup.getElement()?.querySelector<HTMLElement>(".maplibregl-popup-close-button");
    if (closeButton) {
      Object.assign(closeButton.style, {
        width: "44px",
        height: "44px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0",
      });
    }
    const card = { id: train.id, popup, title, toward, next };
    selected = card;
    popup.on("close", () => {
      if (selected === card) selected = null;
    });
    paintCard(train);
  }

  const onTrainClick = (e: maplibregl.MapLayerMouseEvent) => {
    // A station marker under the finger wins: a train dwelling at a station
    // is reachable through the station's own card, which lists it.
    if (map.queryRenderedFeatures(e.point, { layers: [stationHitLayer] }).length > 0) return;
    // Of the trains in reach, take the one nearest the tap.
    let best: { id: string; d: number } | null = null;
    for (const f of e.features ?? []) {
      const id = f.properties?.id as string | undefined;
      const entry = id ? latest.get(id) : undefined;
      if (!id || !entry) continue;
      const p = map.project(entry.at);
      const d = Math.hypot(p.x - e.point.x, p.y - e.point.y);
      if (!best || d < best.d) best = { id, d };
    }
    const entry = best ? latest.get(best.id) : undefined;
    if (entry) openCard(entry.train, entry.at);
  };
  const onEnter = () => (map.getCanvas().style.cursor = "pointer");
  const onLeave = () => (map.getCanvas().style.cursor = "");
  map.on("click", TRAINS_HIT_LAYER, onTrainClick);
  map.on("mouseenter", TRAINS_HIT_LAYER, onEnter);
  map.on("mouseleave", TRAINS_HIT_LAYER, onLeave);

  let drawnAt = new Map<string, DrawnTrain>();
  let drawnStyle = "";
  function frame() {
    if (document.hidden) return;
    // Until the track geometry arrives, hop paths would fall back to straight
    // chords - don't cache those, just wait a tick.
    const segments = getSegments();
    if (!segments) return;
    const source = map.getSource<maplibregl.GeoJSONSource>(TRAINS_SOURCE);
    if (!source) return;

    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
    const placedNow = new Map<string, { train: TrainEstimate; at: [number, number] }>();
    const items: { id: string; text: string; at: [number, number] }[] = [];
    const bearings = new Map<string, number>();
    const hops = getRouteHops?.() ?? null;
    const others = useSettingsStore.getState().settings.otherTrains;
    for (const train of estimateTrains(useArrivalsStore.getState().map, serverNow())) {
      const onRoute = trainOnRoute(train, hops);
      // "Hide": a train that isn't on the route being shown doesn't exist as
      // far as the map, the tap targets and the screen-reader list go.
      if (!onRoute && others === "hide") continue;
      const placed = place(train, segments);
      if (!placed) continue;
      placedNow.set(train.id, { train, at: placed.at });
      bearings.set(train.id, placed.bearing);
      const summary = summariseTrain(train);
      items.push({ id: train.id, text: summary.sentence, at: placed.at });
      features.push({
        type: "Feature",
        properties: { id: train.id, line: train.line, bearing: placed.bearing, label: summary.label, onRoute },
        geometry: { type: "Point", coordinates: placed.at },
      });
    }
    latest = placedNow;
    paintList(items);

    // The open card follows its train, and closes when the train is gone.
    if (selected) {
      const entry = placedNow.get(selected.id);
      if (entry) {
        selected.popup.setLngLat(entry.at);
        paintCard(entry.train);
      } else {
        selected.popup.remove();
      }
    }

    // Nothing to draw and nothing drawn: skip the no-op update.
    if (features.length === 0 && !drawn) return;
    // A setData is a worker round trip plus a full map render. Zoomed out, a
    // train moves a fraction of a pixel per frame, so most frames would
    // repaint the map for a change nobody can see - and keep the main thread
    // busy enough to delay taps. Redraw only when a train has moved at least
    // VISIBLE_MOVE_PX from where it was last drawn (or the set changed).
    const placedDrawn = new Map<string, DrawnTrain>(
      [...placedNow].map(([id, v]) => [id, { at: v.at, bearing: bearings.get(id) ?? 0 }]),
    );
    // A new route, or a changed setting, re-labels trains without moving them.
    const styleKey = `${hops ? [...hops].join(",") : ""}|${others}`;
    const restyled = styleKey !== drawnStyle;
    drawnStyle = styleKey;
    if (!restyled && !trainsMoved(map, placedDrawn, drawnAt)) return;
    drawnAt = placedDrawn;
    drawn = features.length > 0;
    source.setData({ type: "FeatureCollection", features });
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // A timeout chain rather than an interval so the battery-saver setting
  // takes effect on the next tick without restarting anything.
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    frame();
    const settings = useSettingsStore.getState().settings;
    timer = setTimeout(tick, reduced || settings.reduceMotion || settings.trainRate === "saver" ? REDUCED_MOTION_FRAME_MS : FRAME_MS);
  };
  tick();
  document.addEventListener("visibilitychange", frame);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", frame);
    map.off("click", TRAINS_HIT_LAYER, onTrainClick);
    map.off("mouseenter", TRAINS_HIT_LAYER, onEnter);
    map.off("mouseleave", TRAINS_HIT_LAYER, onLeave);
    selected?.popup.remove();
    list.remove();
  };
}

/**
 * Trains are a second thought: the map, lines, stations and routing are
 * interactive first, and the train layer (icon, source, polling loop) is only
 * added once the map has gone idle and the browser has a spare moment. The
 * returned function cancels a pending start or tears down a running one.
 */
export function startLiveTrainsWhenIdle(
  map: maplibregl.Map,
  beforeId: string,
  options: LiveTrainsOptions & { isDimmed: () => boolean; isVisible?: () => boolean },
): () => void {
  let stop: (() => void) | null = null;
  let cancelled = false;
  let idleHandle: number | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const start = () => {
    idleHandle = null;
    timeout = null;
    if (cancelled || !map.isStyleLoaded()) return;
    addLiveTrainsLayer(map, beforeId);
    applyTrainStyle(map, options.isDimmed());
    stop = startLiveTrains(map, options);
  };
  const onIdle = () => {
    if (cancelled) return;
    if (typeof requestIdleCallback === "function") idleHandle = requestIdleCallback(start, { timeout: 3_000 });
    else timeout = setTimeout(start, 500);
  };
  map.once("idle", onIdle);

  return () => {
    cancelled = true;
    map.off("idle", onIdle);
    if (idleHandle !== null && typeof cancelIdleCallback === "function") cancelIdleCallback(idleHandle);
    if (timeout !== null) clearTimeout(timeout);
    stop?.();
    stop = null;
  };
}

/**
 * Everything about how the train markers look, from the settings and from
 * whether a route is on screen: shown or hidden, size, whether the text
 * beside them shows, and how the trains that are not on the route look
 * ("dim": light and faint). A no-op until the layers exist; the idle
 * starter applies it when it adds them.
 */
export function applyTrainStyle(map: maplibregl.Map, routing: boolean): void {
  if (!map.getLayer(TRAINS_LAYER)) return;
  const s: Settings = useSettingsStore.getState().settings;
  const show = s.showTrains ? "visible" : "none";
  map.setLayoutProperty(TRAINS_LAYER, "visibility", show);
  map.setLayoutProperty(TRAINS_HIT_LAYER, "visibility", show);
  map.setLayoutProperty(TRAINS_LABEL_LAYER, "visibility", s.showTrains && s.trainLabels ? "visible" : "none");
  map.setLayoutProperty(TRAINS_LAYER, "icon-size", iconSize(SIZE_FACTOR[s.trainSize]));
  // Trains ease back a little while a route is highlighted (not far: the
  // arrow must stay high-contrast); the ones off the route fade right back.
  // Greyed-out trains carry no text and cannot be tapped (they are not what
  // the rider is looking at); "show" leaves every train fully interactive.
  const greyOthers = routing && s.otherTrains === "dim";
  map.setFilter(TRAINS_LABEL_LAYER, greyOthers ? ON_ROUTE : null);
  map.setFilter(TRAINS_HIT_LAYER, greyOthers ? ON_ROUTE : null);
  const base = routing ? 0.85 : 1;
  map.setPaintProperty(
    TRAINS_LAYER,
    "icon-opacity",
    routing && s.otherTrains === "dim" ? ["case", ["==", ["get", "onRoute"], true], base, 0.22] : base,
  );
}
