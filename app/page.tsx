"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, ArrowRight, X } from "lucide-react";
import type { Station } from "@/data/stations";
import { RoutePanel, type RoutePanelState } from "@/components/RoutePanel";
import { StationSearch } from "@/components/StationSearch";
import { findPath } from "@/lib/transit-graph";
import { useGeolocation } from "@/lib/use-geolocation";
import { startArrivalsPolling } from "@/lib/arrivals-store";

const TransitMap = dynamic(
  () => import("@/components/TransitMap").then((m) => m.TransitMap),
  { ssr: false },
);

export default function Home() {
  const [start, setStart] = useState<Station | null>(null);
  const [destination, setDestination] = useState<Station | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focusStation, setFocusStation] = useState<Station | null>(null);
  const { position, error: geoError } = useGeolocation();

  useEffect(() => {
    startArrivalsPolling();
  }, []);

  // The route is derived, not staged: as soon as both ends exist the path is
  // highlighted. There is no separate confirm step to get stuck on.
  const path = useMemo(
    () => (start && destination ? findPath(start.code, destination.code) : null),
    [start, destination],
  );

  const handleSetStart = (station: Station) => {
    setStart(station);
    if (destination?.code === station.code) setDestination(null);
  };

  const handleSetDestination = (station: Station) => {
    if (start?.code === station.code) return;
    setDestination(station);
    setSheetOpen(true);
  };

  // Tapping a station only opens its info card (a MapLibre popup). It never
  // mutates route state - routes change through the card's buttons or the
  // header chips. Dismissing the sheet keeps the card visible.
  const handleSelectStation = () => {
    setSheetOpen(false);
  };

  const clearRoute = () => {
    setStart(null);
    setDestination(null);
    setSheetOpen(false);
  };

  const handleSearchSelect = (station: Station) => {
    setFocusStation(station);
    setSheetOpen(false);
  };

  const panelState: RoutePanelState | null = useMemo(() => {
    if (start && destination) return { mode: "route", start, destination, path };
    return null;
  }, [start, destination, path]);

  const startCode = start?.code ?? null;
  const destinationCode = destination?.code ?? null;
  const hasRoute = start !== null && destination !== null;

  const subtitle = !start && !destination
    ? "Tap a station, then choose Start or Destination"
    : start && !destination
      ? "Start set — now pick a destination"
      : !start && destination
        ? "Destination set — now pick a start"
        : "Route highlighted below";

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="min-w-0">
          <h1 className="text-base font-semibold">Bangkok Transit</h1>
          <p className="truncate text-xs text-neutral-500">{subtitle}</p>
          {(start || destination) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex max-w-[45vw] items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-medium text-white">
                <span className="shrink-0 opacity-80">Start:</span>
                <span className="truncate">{start ? start.nameEn : "—"}</span>
                {start && (
                  <button onClick={() => setStart(null)} aria-label="Clear start" className="shrink-0">
                    <X size={11} />
                  </button>
                )}
              </span>
              <span className="inline-flex max-w-[45vw] items-center gap-1 rounded-full border border-green-600 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:text-green-400">
                <span className="shrink-0 opacity-80">Destination:</span>
                <span className="truncate">{destination ? destination.nameEn : "—"}</span>
                {destination && (
                  <button
                    onClick={() => {
                      setDestination(null);
                      setSheetOpen(false);
                    }}
                    aria-label="Clear destination"
                    className="shrink-0"
                  >
                    <X size={11} />
                  </button>
                )}
              </span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(start || destination) && (
            <button
              onClick={clearRoute}
              className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Clear
            </button>
          )}
          <StationSearch onSelectStation={handleSearchSelect} />
        </div>
      </header>

      {geoError === "denied" && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <AlertTriangle size={14} className="shrink-0" />
          Location access denied — enable it in your browser settings to see your position on the map.
        </div>
      )}

      <div className="relative isolate flex-1 overflow-hidden">
        <TransitMap
          onSelectStation={handleSelectStation}
          onSetStart={handleSetStart}
          onSetDestination={handleSetDestination}
          startCode={startCode}
          destinationCode={destinationCode}
          path={path}
          userPosition={position}
          focusStation={focusStation}
        />

        {hasRoute && !sheetOpen && (
          <button
            onClick={() => setSheetOpen(true)}
            className="absolute bottom-4 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-green-700"
          >
            View route <ArrowRight size={15} />
          </button>
        )}
      </div>

      <RoutePanel
        state={sheetOpen ? panelState : null}
        userPosition={position}
        onClose={() => setSheetOpen(false)}
      />
    </main>
  );
}
