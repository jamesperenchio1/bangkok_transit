"use client";

import { useState } from "react";
import { stations, type Station } from "@/data/stations";
import { StationMap } from "@/components/StationMap";
import { ArrivalsSheet } from "@/components/ArrivalsSheet";
import { UnavailableTooltip } from "@/components/UnavailableTooltip";

export default function Home() {
  const [selected, setSelected] = useState<Station | null>(null);
  const [tooltip, setTooltip] = useState<{ station: Station; point: { x: number; y: number } } | null>(
    null,
  );
  const [showReference, setShowReference] = useState(false);

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div>
          <h1 className="text-base font-semibold">Bangkok Transit</h1>
          <p className="text-xs text-neutral-500">
            {showReference ? "Full network reference (view only)" : "Tap a station for live arrivals"}
          </p>
        </div>
        <button
          onClick={() => setShowReference((v) => !v)}
          className="shrink-0 rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {showReference ? "Back to map" : "Full network"}
        </button>
      </header>

      <div className="flex-1 overflow-auto overscroll-contain">
        {showReference ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/bts-map-network.jpg"
            alt="Full Bangkok transit network map (BTS, MRT, Gold, Yellow, Pink lines) - reference only"
            className="block w-full select-none"
            draggable={false}
          />
        ) : (
          <StationMap
            src="/bts-map.jpg"
            stations={stations}
            onSelectBts={(s) => {
              setTooltip(null);
              setSelected(s);
            }}
            onSelectOther={(s, point) => {
              setSelected(null);
              setTooltip({ station: s, point });
            }}
          />
        )}
      </div>

      <ArrivalsSheet station={selected} onClose={() => setSelected(null)} />

      {tooltip && (
        <UnavailableTooltip
          stationName={tooltip.station.nameEn}
          point={tooltip.point}
          onDismiss={() => setTooltip(null)}
        />
      )}
    </main>
  );
}
