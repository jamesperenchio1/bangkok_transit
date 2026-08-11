"use client";

/**
 * The BTS route map, drawn as SVG from committed schematic coordinates.
 *
 * Positions come from data/canonical/bts-schematic.json (see the extraction
 * script for provenance). Drawing them ourselves rather than shipping the
 * operator's 4.5MB raster is what buys crisp zoom, dark mode, live crowd tinting
 * and real focusable click targets instead of hotspots layered over an image.
 *
 * No topology is hardcoded here: line order, colours and branch segments all
 * come from the data file.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { btsSchematic } from "@/lib/bts";
import type { SchematicLine, SchematicStation } from "@/data/schemas";

type Point = { x: number; y: number };

interface Props {
  selectedCode: string | null;
  onSelect: (code: string) => void;
  onPrefetch?: (code: string) => void;
  crowding?: Record<string, number>;
  language: "en" | "th";
}

/** Padding around the station extents so nothing is flush against the edge. */
const PAD = 46;

/** Labels are unreadable when the whole map is in view; they appear on zoom in. */
const LABEL_SCALE = 1.55;

/** Movement under this is a tap, not a pan. */
const DRAG_SLOP_PX = 4;

const MIN_SCALE = 0.9;
const MAX_SCALE = 7;

/**
 * Labels kept visible at every zoom: Siam and the end of each line, which are
 * what people orient by. Deliberately excludes busy interchanges like Asok and
 * Samrong — they sit mid-run on the dense east-west stretches, where a
 * permanent label overlaps its neighbours at the fit-to-screen zoom.
 */
const ALWAYS_LABELLED = new Set(["CEN", "N24", "E23", "W1", "S12", "N8", "G3"]);

function useContentBox() {
  return useMemo(() => {
    const all = btsSchematic.lines.flatMap((l) => l.stations);
    const xs = all.map((s) => s.x);
    const ys = all.map((s) => s.y);
    const minX = Math.min(...xs) - PAD;
    const minY = Math.min(...ys) - PAD;
    return {
      minX,
      minY,
      width: Math.max(...xs) + PAD - minX,
      height: Math.max(...ys) + PAD - minY,
    };
  }, []);
}

/**
 * Where a station's label sits, based on the direction of its own line at that
 * point. On vertical runs the label sits beside the dot; on horizontal runs
 * (the Pink and Yellow lines run mostly east-west) it is angled so that
 * neighbouring labels don't collide.
 */
function labelPlacement(station: SchematicStation, neighbours: Point[]) {
  if (neighbours.length === 0) return { dx: 11, dy: 4, rotate: 0, anchor: "start" as const };

  const from = neighbours[0];
  const to = neighbours[neighbours.length - 1];
  const horizontal = Math.abs(to.x - from.x) > Math.abs(to.y - from.y);

  if (horizontal) {
    return { dx: 7, dy: -8, rotate: -45, anchor: "start" as const };
  }
  // Keep labels on the outside of the map so they read away from other lines.
  const right = station.x >= 690;
  return { dx: right ? 12 : -12, dy: 4, rotate: 0, anchor: right ? ("start" as const) : ("end" as const) };
}

export function BtsRouteMap({ selectedCode, onSelect, onPrefetch, crowding, language }: Props) {
  const box = useContentBox();
  const svgRef = useRef<SVGSVGElement>(null);

  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });

  /**
   * Pixels per SVG unit at the current viewport size.
   *
   * Strokes, dots and labels are specified in real pixels and converted through
   * this. Sizing them in SVG units instead makes them shrink with the viewBox —
   * the same 11-unit label renders at 11px on a wide desktop and 6px on a phone,
   * which is illegible exactly where it matters most.
   */
  const [fit, setFit] = useState(1);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const r = svg.getBoundingClientRect();
      if (r.width && r.height) setFit(Math.min(r.width / box.width, r.height / box.height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [box]);

  /** Convert a size in screen pixels to SVG units at the current zoom. */
  const px = useCallback((pixels: number) => pixels / (fit * view.scale), [fit, view.scale]);

  const drag = useRef<{
    id: number;
    startX: number;
    startY: number;
    fromTx: number;
    fromTy: number;
    moved: boolean;
  } | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  /** Whether the gesture that just ended was a pan, read by the click handler. */
  const panned = useRef(false);

  const byCode = useMemo(() => {
    const map = new Map<string, SchematicStation & { line: SchematicLine }>();
    for (const line of btsSchematic.lines) {
      for (const s of line.stations) {
        // Siam is on two lines; the first (Sukhumvit) wins for label placement.
        if (!map.has(s.code)) map.set(s.code, { ...s, line });
      }
    }
    return map;
  }, []);

  const placements = useMemo(() => {
    const out = new Map<string, ReturnType<typeof labelPlacement>>();
    for (const line of btsSchematic.lines) {
      const at = new Map(line.stations.map((s) => [s.code, s]));
      for (const seg of line.segments) {
        seg.forEach((code, i) => {
          if (out.has(code)) return;
          const s = at.get(code);
          if (!s) return;
          const neighbours = [seg[i - 1], seg[i + 1]]
            .map((c) => (c ? at.get(c) : undefined))
            .filter((n): n is SchematicStation => Boolean(n));
          out.set(code, labelPlacement(s, neighbours.length ? neighbours : [s]));
        });
      }
    }
    return out;
  }, []);

  /** Convert a client point into schematic coordinates, so zoom anchors under the cursor. */
  const toContent = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      // The SVG scales its viewBox to fit; recover that factor to stay accurate.
      const fit = Math.min(rect.width / box.width, rect.height / box.height);
      const offsetX = (rect.width - box.width * fit) / 2;
      const offsetY = (rect.height - box.height * fit) / 2;
      return {
        x: (clientX - rect.left - offsetX) / fit,
        y: (clientY - rect.top - offsetY) / fit,
      };
    },
    [box]
  );

  const zoomAt = useCallback(
    (factor: number, at: Point) => {
      setView((v) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
        const k = scale / v.scale;
        return { scale, tx: at.x - (at.x - v.tx) * k, ty: at.y - (at.y - v.ty) * k };
      });
    },
    []
  );

  // Registered manually: React marks wheel listeners passive, which forbids the
  // preventDefault needed to stop the page scrolling while zooming the map.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * 0.0016), toContent(e.clientX, e.clientY));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt, toContent]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(b.x - a.x, b.y - a.y), scale: view.scale };
      drag.current = null;
      return;
    }
    // Note: no pointer capture yet. Capturing here would retarget the pointerup
    // to this <svg>, so the resulting click fires on the SVG instead of the
    // station group under the finger and tapping a station would do nothing.
    // Capture is taken in onPointerMove, once this is actually a drag.
    drag.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      fromTx: view.tx,
      fromTy: view.ty,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const mid = toContent((a.x + b.x) / 2, (a.y + b.y) / 2);
      const target = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinch.current.scale * (dist / pinch.current.dist)));
      setView((v) => {
        const k = target / v.scale;
        return { scale: target, tx: mid.x - (mid.x - v.tx) * k, ty: mid.y - (mid.y - v.ty) * k };
      });
      return;
    }

    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;

    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;

    // A few pixels of slop, so a slightly imprecise tap still selects a station
    // rather than being treated as a pan.
    if (!d.moved) {
      if (Math.hypot(dx, dy) <= DRAG_SLOP_PX) return;
      d.moved = true;
      // Now that it is a drag, capture so it survives leaving the SVG.
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    // Screen pixels to content units: the transform translates before scaling,
    // so tx is in unscaled viewBox units and only `fit` applies.
    setView((v) => ({ ...v, tx: d.fromTx + dx / fit, ty: d.fromTy + dy / fit }));
  };

  const endPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (drag.current?.id === e.pointerId) {
      // `click` fires after `pointerup`, so remember whether this gesture was a
      // pan; otherwise the station handler can no longer tell and every drag
      // that happens to end on a dot would select it.
      panned.current = drag.current.moved;
      drag.current = null;
    }
  };

  const showLabels = view.scale >= LABEL_SCALE;
  const reset = () => setView({ scale: 1, tx: 0, ty: 0 });

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--map-bg)]">
      <svg
        ref={svgRef}
        role="img"
        aria-label="BTS Skytrain route map"
        viewBox={`${box.minX} ${box.minY} ${box.width} ${box.height}`}
        // Cursor via CSS rather than reading the drag ref during render, which
        // would be a render-phase ref read.
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          {/* Track first, so station dots always sit on top of every line. */}
          {btsSchematic.lines.map((line) => {
            const at = new Map(line.stations.map((s) => [s.code, s]));
            return (
              <g key={`track-${line.key}`}>
                {line.segments.map((seg, i) => {
                  const points = seg
                    .map((c) => at.get(c))
                    .filter(Boolean)
                    .map((s) => `${s!.x},${s!.y}`)
                    .join(" ");
                  return (
                    <g key={i}>
                      {/* Casing, as printed transit maps use. The operator's
                          colours are fixed, and the Yellow line (#FAD53D) all but
                          disappears against a light ground; a darker edge keeps
                          every line legible without altering its colour. */}
                      <polyline
                        points={points}
                        fill="none"
                        stroke="var(--map-casing)"
                        strokeWidth={px(7.5)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <polyline
                        points={points}
                        fill="none"
                        stroke={line.color}
                        strokeWidth={px(5.5)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        // Lines without live data read as secondary without being
                        // hidden — they are still part of the network.
                        opacity={line.hasLiveArrivals ? 1 : 0.6}
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}

          {[...byCode.values()].map((s) => {
            const selected = s.code === selectedCode;
            const crowded = (crowding?.[s.code] ?? 0) > 0;
            const key = ALWAYS_LABELLED.has(s.code);
            const place = placements.get(s.code);
            const r = px(selected ? 6.5 : 4.2);
            const label = language === "th" ? s.nameTh : s.nameEn;

            return (
              <g key={s.code}>
                {crowded && (
                  <circle
                    cx={s.x}
                    cy={s.y}
                    r={px(10)}
                    fill={s.line.color}
                    opacity={0.22}
                    className="motion-safe:animate-pulse"
                  />
                )}
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`${s.nameEn} ${s.code}`}
                  aria-pressed={selected}
                  className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-[var(--focus)]"
                  onClick={() => {
                    // Suppress the click that ends a pan.
                    if (panned.current) return;
                    onSelect(s.code);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(s.code);
                    }
                  }}
                  onPointerEnter={() => onPrefetch?.(s.code)}
                >
                  {/* Invisible target: the dots are far smaller than a fingertip. */}
                  <circle cx={s.x} cy={s.y} r={px(14)} fill="transparent" />
                  <circle
                    cx={s.x}
                    cy={s.y}
                    r={r}
                    fill={selected ? s.line.color : "var(--map-station)"}
                    stroke={selected ? "var(--map-station)" : s.line.color}
                    strokeWidth={px(2)}
                  />
                </g>

                {(showLabels || key || selected) && place && (
                  <text
                    x={s.x + px(place.dx)}
                    y={s.y + px(place.dy)}
                    textAnchor={place.anchor}
                    transform={place.rotate ? `rotate(${place.rotate} ${s.x} ${s.y})` : undefined}
                    className="pointer-events-none fill-[var(--map-label)]"
                    style={{
                      fontSize: `${px(11.5)}px`,
                      fontWeight: selected || key ? 600 : 400,
                      // Halo in the map's own background so labels stay readable
                      // where they cross a line.
                      paintOrder: "stroke",
                      stroke: "var(--map-bg)",
                      strokeWidth: px(3),
                      strokeLinejoin: "round",
                    }}
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute bottom-4 right-4 flex flex-col gap-1.5">
        <MapButton label="Zoom in" onClick={() => zoomAt(1.4, { x: box.minX + box.width / 2, y: box.minY + box.height / 2 })}>
          +
        </MapButton>
        <MapButton label="Zoom out" onClick={() => zoomAt(1 / 1.4, { x: box.minX + box.width / 2, y: box.minY + box.height / 2 })}>
          −
        </MapButton>
        <MapButton label="Reset view" onClick={reset}>
          <span className="text-[11px] font-medium">Fit</span>
        </MapButton>
      </div>
    </div>
  );
}

function MapButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 bg-background/90 text-base font-medium shadow-sm backdrop-blur transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
    >
      {children}
    </button>
  );
}
