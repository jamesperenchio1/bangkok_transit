"use client";

import { useEffect, useRef, useState } from "react";
import type { Station } from "@/data/stations";

/**
 * Renders the network map image with an SVG overlay sharing its native
 * pixel dimensions as the viewBox. Because the image and SVG scale together
 * in one container, each station's hitbox stays pixel-perfect aligned to
 * the artwork at any screen size - no separate positioning math per
 * breakpoint.
 */

const MAP_SRC = "/bts-map.png";

export interface StationMapProps {
  stations: Station[];
  onSelectBts: (station: Station) => void;
  onSelectOther: (station: Station, point: { x: number; y: number }) => void;
}

export function StationMap({ stations, onSelectBts, onSelectOther }: StationMapProps) {
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
        Map image not found at <code className="mx-1">public/bts-map.png</code>.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={MAP_SRC}
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
          className="absolute inset-0 h-full w-full"
        >
          {placeable.map((s) => {
            const isBts = s.hasLiveArrivals;
            return (
              <circle
                key={s.code}
                cx={s.x}
                cy={s.y}
                r={s.radius ?? 14}
                fill="transparent"
                stroke="transparent"
                className="cursor-pointer"
                pointerEvents="all"
                onClick={(e) => {
                  if (isBts) {
                    onSelectBts(s);
                  } else {
                    const rect = containerRef.current?.getBoundingClientRect();
                    onSelectOther(s, {
                      x: e.clientX - (rect?.left ?? 0),
                      y: e.clientY - (rect?.top ?? 0),
                    });
                  }
                }}
              >
                <title>{s.nameEn}</title>
              </circle>
            );
          })}
        </svg>
      )}
    </div>
  );
}
