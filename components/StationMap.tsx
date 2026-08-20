"use client";

import { useEffect, useRef, useState } from "react";
import type { Station } from "@/data/stations";

/**
 * Renders the network map image with an SVG overlay sharing its native
 * pixel dimensions as the viewBox. Because the image and SVG scale together
 * in one container, the tap-detection math stays pixel-perfect aligned to
 * the artwork at any screen size or zoom level - no separate positioning
 * math per breakpoint.
 *
 * Tapping doesn't hit-test individual per-station circles (some stations,
 * like the CEN/S1/N1/N2 interchange cluster, sit as close as ~16px apart
 * in map space - circles sized for a comfortable fat-finger tap would
 * overlap there). Instead every tap finds the *nearest* station within
 * MAX_TAP_DISTANCE, which is both more forgiving and has no overlap
 * ambiguity: every point on the map unambiguously belongs to whichever
 * station is closest to it.
 */

const MAX_TAP_DISTANCE = 34;

export interface StationMapProps {
  src: string;
  stations: Station[];
  onSelectBts: (station: Station) => void;
  onSelectOther: (station: Station, point: { x: number; y: number }) => void;
}

export function StationMap({ src, stations, onSelectBts, onSelectOther }: StationMapProps) {
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [imageMissing, setImageMissing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // The 404 for a missing map image can resolve before React attaches the
  // onError listener (a hydration race), so also check `complete` on mount.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) {
      setImageMissing(true);
    } else if (img && img.complete && img.naturalWidth > 0) {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    }
  }, []);

  const placeable = stations.filter(
    (s): s is Station & { x: number; y: number } => s.x !== null && s.y !== null,
  );

  if (imageMissing) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8 text-center text-sm text-neutral-500">
        Map image not found at <code className="mx-1">public{src}</code>.
      </div>
    );
  }

  const handleTap = (e: React.MouseEvent) => {
    if (!naturalSize) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mapX = ((e.clientX - rect.left) / rect.width) * naturalSize.w;
    const mapY = ((e.clientY - rect.top) / rect.height) * naturalSize.h;

    let nearest: (Station & { x: number; y: number }) | null = null;
    let nearestDist = Infinity;
    for (const s of placeable) {
      const d = Math.hypot(s.x - mapX, s.y - mapY);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = s;
      }
    }
    if (!nearest || nearestDist > MAX_TAP_DISTANCE) return;

    if (nearest.hasLiveArrivals) {
      onSelectBts(nearest);
    } else {
      onSelectOther(nearest, { x: e.clientX, y: e.clientY });
    }
  };

  return (
    <div ref={containerRef} className="relative w-full" onClick={handleTap}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt="Bangkok BTS/MRT network map"
        className="block w-full select-none"
        draggable={false}
        onLoad={(e) => {
          const img = e.currentTarget;
          setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        }}
        onError={() => setImageMissing(true)}
      />
      {naturalSize && (
        <svg
          viewBox={`0 0 ${naturalSize.w} ${naturalSize.h}`}
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {placeable.map((s) => (
            <circle
              key={s.code}
              cx={s.x}
              cy={s.y}
              r={s.radius ?? 14}
              fill="transparent"
              stroke="transparent"
            />
          ))}
        </svg>
      )}
    </div>
  );
}
