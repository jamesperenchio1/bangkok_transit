"use client";

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

  return (
    <div className="flex flex-col gap-1.5">
      <StationEta station={station} />
      <div className="flex gap-2">
        <button
          onClick={() => onSetStart(station)}
          aria-label={t.startStationLabel(stationName(station, lang))}
          className="min-h-11 flex-1 rounded-full bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-800"
        >
          {isStart ? `${t.start} ✓` : t.start}
        </button>
        <button
          onClick={() => onSetDestination(station)}
          aria-label={t.destinationStationLabel(stationName(station, lang))}
          className="min-h-11 flex-1 rounded-full border border-green-700 bg-white px-3 py-1.5 text-xs font-semibold text-green-800 hover:bg-green-50 dark:bg-neutral-900 dark:text-green-400 dark:hover:bg-neutral-800"
        >
          {isDestination ? `${t.destination} ✓` : t.destination}
        </button>
      </div>
    </div>
  );
}
