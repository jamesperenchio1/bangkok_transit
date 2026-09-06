"use client";

import type { Station } from "@/data/stations";

export interface StationActionsProps {
  station: Station;
  startCode: string | null;
  onSetStart: (station: Station) => void;
  onSetDestination: (station: Station) => void;
}

export function StationActions({ station, startCode, onSetStart, onSetDestination }: StationActionsProps) {
  const isStart = station.code === startCode;

  return (
    <div className="flex gap-2">
      <button
        onClick={() => onSetStart(station)}
        className="flex-1 rounded-full bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
      >
        {isStart ? "Start ✓" : "Set as start"}
      </button>
      <button
        onClick={() => onSetDestination(station)}
        disabled={startCode === null || isStart}
        title={startCode === null ? "Set a start station first" : undefined}
        className="flex-1 rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 enabled:hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:enabled:hover:bg-neutral-800"
      >
        Set as destination
      </button>
    </div>
  );
}
