"use client";

import type { Station } from "@/data/stations";
import { StationEta } from "@/components/StationEta";

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

  return (
    <div className="flex flex-col gap-1.5">
      <StationEta station={station} />
      <div className="flex gap-2">
        <button
          onClick={() => onSetStart(station)}
          className="flex-1 rounded-full bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
        >
          {isStart ? "Start ✓" : "Start"}
        </button>
        <button
          onClick={() => onSetDestination(station)}
          className="flex-1 rounded-full border border-green-600 bg-white px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-50 dark:bg-neutral-900 dark:text-green-400 dark:hover:bg-neutral-800"
        >
          {isDestination ? "Destination ✓" : "Destination"}
        </button>
      </div>
    </div>
  );
}
