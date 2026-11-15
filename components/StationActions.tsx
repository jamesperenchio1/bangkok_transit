"use client";

import { useState } from "react";
import type { Station } from "@/data/stations";
import { StationEta } from "@/components/StationEta";
import { stationName, useT } from "@/lib/i18n";

export interface StationActionsProps {
  station: Station;
  startCode: string | null;
  destinationCode: string | null;
  onSetStart: (station: Station) => void;
  onSetDestination: (station: Station) => void;
}

export function StationActions({
  station,
  startCode,
  destinationCode,
  onSetStart,
  onSetDestination,
}: StationActionsProps) {
  const isStart = station.code === startCode;
  const isDestination = station.code === destinationCode;
  const { lang, t } = useT();
  // The card lingers a beat after a choice (the map closes it) so the tap is
  // acknowledged on the button itself rather than the card just vanishing.
  const [picked, setPicked] = useState<"start" | "destination" | null>(null);

  return (
    <div className="flex flex-col gap-1.5">
      <StationEta station={station} />
      <div className="flex gap-2.5 pt-0.5">
        <button
          onClick={() => {
            setPicked("start");
            onSetStart(station);
          }}
          aria-label={t.startStationLabel(stationName(station, lang))}
          className="min-h-12 flex-1 rounded-full bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800"
        >
          {isStart || picked === "start" ? `${t.start} ✓` : t.start}
        </button>
        <button
          onClick={() => {
            setPicked("destination");
            onSetDestination(station);
          }}
          aria-label={t.destinationStationLabel(stationName(station, lang))}
          className="min-h-12 flex-1 rounded-full border-2 border-green-700 bg-white px-4 py-2 text-sm font-semibold text-green-800 hover:bg-green-50 dark:bg-neutral-900 dark:text-green-400 dark:hover:bg-neutral-800"
        >
          {isDestination || picked === "destination" ? `${t.destination} ✓` : t.destination}
        </button>
      </div>
    </div>
  );
}
