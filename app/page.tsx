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

  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <h1 className="text-base font-semibold">Bangkok Transit</h1>
        <p className="text-xs text-neutral-500">Tap a station for live arrivals</p>
      </header>

      <div className="flex-1 overflow-auto">
        <StationMap
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
