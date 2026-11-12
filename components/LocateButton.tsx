"use client";

import { LocateFixed } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { GeoPosition } from "@/lib/use-geolocation";

/** The round "centre on me" button over the map's top-right corner; the same on both maps. */
export function LocateButton({
  position,
  onLocate,
}: {
  position: GeoPosition | null;
  onLocate: (position: GeoPosition) => void;
}) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={() => {
        if (position) onLocate(position);
      }}
      disabled={!position}
      aria-label={t.centerOnMe}
      title={position ? t.centerOnMe : t.waitingLocation}
      className="absolute top-3 right-3 z-[1000] flex h-11 w-11 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700 shadow-md hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      <LocateFixed size={18} />
    </button>
  );
}
