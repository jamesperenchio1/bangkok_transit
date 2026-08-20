"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Scopes pinch-zoom and panning to its children only. Page-wide native
 * pinch zoom is disabled (see the `viewport` export in app/layout.tsx) so
 * this is the only way to zoom in on a station - keeping the header and
 * the arrivals sheet at a fixed, readable size regardless of map zoom.
 *
 * The map image is taller than the viewport even at 1x, so single-finger
 * panning is always active (not just once zoomed in) - it doubles as the
 * way to scroll down the map, replacing native scroll entirely since the
 * content is transformed rather than laid out in normal flow.
 */

const MIN_SCALE = 1;
const MAX_SCALE = 4;

interface PointerState {
  x: number;
  y: number;
}

export function ZoomableMap({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, PointerState>());
  const gesture = useRef<{
    startDist: number;
    startScale: number;
    startTransform: { x: number; y: number };
  } | null>(null);
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const clampTransform = useCallback((scale: number, x: number, y: number) => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return { scale, x, y };
    const cRect = container.getBoundingClientRect();
    // offsetWidth/Height reflect pre-transform layout size, so this stays
    // correct whether the image is naturally taller than the viewport
    // (scale 1) or zoomed in (scale > 1).
    const scaledW = content.offsetWidth * scale;
    const scaledH = content.offsetHeight * scale;
    const maxX = Math.max(0, (scaledW - cRect.width) / 2);
    const maxY = Math.max(0, (scaledH - cRect.height) / 2);
    return {
      scale,
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      // pointer already released - safe to ignore, capture is best-effort
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      gesture.current = {
        startDist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        startScale: transform.scale,
        startTransform: { x: transform.x, y: transform.y },
      };
      panStart.current = null;
    } else if (pointers.current.size === 1) {
      panStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
    }
  }, [transform]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && gesture.current) {
      const [p1, p2] = [...pointers.current.values()];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const ratio = dist / gesture.current.startDist;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, gesture.current.startScale * ratio));
      setTransform(clampTransform(newScale, gesture.current.startTransform.x, gesture.current.startTransform.y));
    } else if (pointers.current.size === 1 && panStart.current) {
      const { x: sx, y: sy, tx, ty } = panStart.current;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      setTransform((t) => clampTransform(t.scale, tx + dx, ty + dy));
    }
  }, [clampTransform]);

  const endPointer = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    gesture.current = null;
    if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      panStart.current = { x: p.x, y: p.y, tx: transform.x, ty: transform.y };
    } else {
      panStart.current = null;
    }
  }, [transform]);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    setTransform((t) => {
      if (t.scale > 1) return clampTransform(1, 0, 0);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return clampTransform(2, 0, 0);
      const offsetX = rect.width / 2 - (e.clientX - rect.left);
      const offsetY = rect.height / 2 - (e.clientY - rect.top);
      return clampTransform(2, offsetX, offsetY);
    });
  }, [clampTransform]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onDoubleClick={onDoubleClick}
    >
      <div
        ref={contentRef}
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        }}
        className="w-full origin-center"
      >
        {children}
      </div>
    </div>
  );
}
