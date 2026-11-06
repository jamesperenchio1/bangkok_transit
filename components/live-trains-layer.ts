import * as maplibregl from "maplibre-gl";
import { stations } from "@/data/stations";
import { serverNow, useArrivalsStore } from "@/lib/arrivals-store";
import { stationName, strings, useLangStore } from "@/lib/i18n";
import { haversineMeters, trackBetween, type LatLon, type LineSegments } from "@/lib/line-geometry";
import { estimateTrains, type TrainEstimate, type TrainLine } from "@/lib/live-trains";

export const TRAINS_SOURCE = "live-trains";
export const TRAINS_LAYER = "live-trains-layer";
const TRAINS_HIT_LAYER = "live-trains-hit-layer";

/** ~4 fps: a train moves a few pixels a second, so this reads as smooth without a render loop. */
const FRAME_MS = 250;
/** For people who ask for less motion: positions still refresh, just without a steady glide. */
const REDUCED_MOTION_FRAME_MS = 5_000;
/**
 * Radius of the invisible tap target around each train. 22 px is a 44 px
 * circle - the WCAG 2.5.8 minimum the rest of the app holds to - and far more
 * than the train itself covers at city zoom, so a moving train is easy to hit.
 */
const TAP_RADIUS_PX = 22;

/** Smaller than this on screen is invisible: not worth a map render. */
const VISIBLE_MOVE_PX = 0.75;

/** A turn smaller than this is not visible on a train icon. */
const VISIBLE_TURN_DEG = 5;

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
    const turn = Math.abs(((bearing - before.bearing + 540) % 360) - 180);
    if (turn >= VISIBLE_TURN_DEG) return true;
    const a = map.project(at);
    const b = map.project(before.at);
    if (Math.hypot(a.x - b.x, a.y - b.y) >= VISIBLE_MOVE_PX) return true;
  }
  return false;
}

const stationsByCode = new Map(stations.map((s) => [s.code, s]));
const TRAIN_ICON = "live-train";

interface Track {
  /** [lon, lat] points, the order MapLibre wants. */
  points: [number, number][];
  /** Metres from the start to each point. */
  along: number[];
}

/**
 * A four-car train seen from above, nose up, drawn the way the real thing
 * looks from a drone: a silver roof shaded to read as curved, a dark
 * charcoal outline, rubber gangways between the cars, a row of air-conditioning
 * units along the roof, a dark windscreen and pale light bar at the front, a
 * smaller cab window and red tail lights at the back. Deliberately not tinted
 * by line - the track already carries the colour, and a train in the same
 * green or blue disappears into it. A soft shadow and white halo lift it off
 * any basemap. Drawn at 2x so it stays sharp on phones.
 */
function drawTrainIcon(): ImageData | null {
  const ratio = 2;
  const W = 20;
  const H = 76;
  const canvas = document.createElement("canvas");
  canvas.width = W * ratio;
  canvas.height = H * ratio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  ctx.lineJoin = "round";

  const left = 3;
  const right = 17;
  const mid = (left + right) / 2;
  // A car from y0 to y1; `nose` is how much its end is rounded off (0 = square-ish).
  const car = (y0: number, y1: number, front: number, back: number) => {
    const p = new Path2D();
    if (front > 2) {
      p.moveTo(left, y0 + front * 1.5);
      p.bezierCurveTo(left, y0 + front * 0.5, left + 2.5, y0, mid, y0);
      p.bezierCurveTo(right - 2.5, y0, right, y0 + front * 0.5, right, y0 + front * 1.5);
    } else {
      p.moveTo(left, y0 + 1.5);
      p.quadraticCurveTo(left, y0, left + 1.5, y0);
      p.lineTo(right - 1.5, y0);
      p.quadraticCurveTo(right, y0, right, y0 + 1.5);
    }
    if (back > 2) {
      p.lineTo(right, y1 - back * 1.5);
      p.bezierCurveTo(right, y1 - back * 0.5, right - 2.5, y1, mid, y1);
      p.bezierCurveTo(left + 2.5, y1, left, y1 - back * 0.5, left, y1 - back * 1.5);
    } else {
      p.lineTo(right, y1 - 1.5);
      p.quadraticCurveTo(right, y1, right - 1.5, y1);
      p.lineTo(left + 1.5, y1);
      p.quadraticCurveTo(left, y1, left, y1 - 1.5);
    }
    p.closePath();
    return p;
  };
  const cars = [car(3, 20, 5, 0), car(22.5, 36.75, 0, 0), car(39.25, 53.5, 0, 0), car(56, 73, 0, 4)];
  const gangways: [number, number][] = [
    [19, 23.5],
    [35.75, 40.25],
    [52.5, 57],
  ];

  // Halo and shadow first, underneath everything.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  for (const c of cars) {
    ctx.stroke(c);
    ctx.fill(c);
  }
  for (const [y0, y1] of gangways) ctx.fillRect(7, y0, 6, y1 - y0);
  ctx.restore();

  // Gangways: dark, with a few ribs for the folded rubber.
  for (const [y0, y1] of gangways) {
    ctx.fillStyle = "#334155";
    ctx.fillRect(6.4, y0, 7.2, y1 - y0);
    ctx.fillStyle = "#64748b";
    ctx.fillRect(6.4, y0 + (y1 - y0) / 2 - 0.3, 7.2, 0.6);
  }

  // Cars: silver roof shaded lighter down the middle, charcoal outline.
  const shade = ctx.createLinearGradient(left, 0, right, 0);
  shade.addColorStop(0, "#b6c0cc");
  shade.addColorStop(0.5, "#f5f7fa");
  shade.addColorStop(1, "#b6c0cc");
  ctx.fillStyle = shade;
  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 1.2;
  for (const c of cars) {
    ctx.fill(c);
    ctx.stroke(c);
  }

  // Air-conditioning units along the roof, with fins.
  const unit = (y: number, h: number) => {
    ctx.fillStyle = "#8b97a6";
    ctx.fillRect(6, y, 8, h);
    ctx.strokeStyle = "#5b6676";
    ctx.lineWidth = 0.6;
    ctx.strokeRect(6, y, 8, h);
    ctx.beginPath();
    for (let fy = y + 1.1; fy < y + h - 0.4; fy += 1.1) {
      ctx.moveTo(6.6, fy);
      ctx.lineTo(13.4, fy);
    }
    ctx.stroke();
  };
  unit(14, 4);
  unit(24.5, 4.2);
  unit(30.8, 4.2);
  unit(41.2, 4.2);
  unit(47.5, 4.2);
  unit(58.5, 4);

  // Front cab: a big dark windscreen and a pale light bar on the nose.
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.moveTo(5.3, 11.5);
  ctx.bezierCurveTo(5.3, 7.5, 7.2, 5.6, mid, 5.6);
  ctx.bezierCurveTo(12.8, 5.6, 14.7, 7.5, 14.7, 11.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(7, 9.5);
  ctx.lineTo(8.6, 7.2);
  ctx.stroke();
  ctx.fillStyle = "#fde68a";
  ctx.fillRect(7.8, 3.5, 4.4, 0.9);

  // Rear cab: a smaller window, and red tail lights.
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.moveTo(6, 67);
  ctx.lineTo(14, 67);
  ctx.lineTo(13, 70.3);
  ctx.lineTo(7, 70.3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(7.6, 71.2, 4.8, 0.9);

  return ctx.getImageData(0, 0, W * ratio, H * ratio);
}

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
        "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.3, 12, 0.42, 15, 0.65, 17, 0.85],
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
  /** A tap on a station marker takes priority over a train beside it. */
  stationHitLayer: string;
}

/**
 * Keep the trains layer updated from the arrivals store until the returned
 * function is called. Reads only what the app already holds - it never
 * fetches - and pauses while the tab is hidden. Tapping a train opens a small
 * card that follows it.
 */
export function startLiveTrains(map: maplibregl.Map, { getSegments, stationHitLayer }: LiveTrainsOptions): () => void {
  const tracks = new Map<string, Track>();
  let drawn = false;
  let latest = new Map<string, { train: TrainEstimate; at: [number, number] }>();
  let selected: { id: string; popup: maplibregl.Popup; title: HTMLElement; toward: HTMLElement; next: HTMLElement } | null =
    null;

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

  /** Compass bearing (degrees clockwise from north) of the step from point i-1 to i. */
  function bearing(track: Track, i: number): number {
    const [x0, y0] = track.points[i - 1];
    const [x1, y1] = track.points[i];
    const east = (x1 - x0) * Math.cos(((y0 + y1) / 2) * (Math.PI / 180));
    const north = y1 - y0;
    return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  }

  /** Where the train is and which way it faces, both along the real track. */
  function place(train: TrainEstimate, segments: LineSegments): { at: [number, number]; bearing: number } | null {
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
  }

  // --- The card that opens when a train is tapped ---

  function describe(train: TrainEstimate) {
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

  function paintCard(train: TrainEstimate) {
    if (!selected) return;
    const text = describe(train);
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
    const bearings = new Map<string, number>();
    for (const train of estimateTrains(useArrivalsStore.getState().map, serverNow())) {
      const placed = place(train, segments);
      if (!placed) continue;
      placedNow.set(train.id, { train, at: placed.at });
      bearings.set(train.id, placed.bearing);
      features.push({
        type: "Feature",
        properties: { id: train.id, line: train.line, bearing: placed.bearing },
        geometry: { type: "Point", coordinates: placed.at },
      });
    }
    latest = placedNow;

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
    if (!trainsMoved(map, placedDrawn, drawnAt)) return;
    drawnAt = placedDrawn;
    drawn = features.length > 0;
    source.setData({ type: "FeatureCollection", features });
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const timer = setInterval(frame, reduced ? REDUCED_MOTION_FRAME_MS : FRAME_MS);
  frame();
  document.addEventListener("visibilitychange", frame);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", frame);
    map.off("click", TRAINS_HIT_LAYER, onTrainClick);
    map.off("mouseenter", TRAINS_HIT_LAYER, onEnter);
    map.off("mouseleave", TRAINS_HIT_LAYER, onLeave);
    selected?.popup.remove();
  };
}
