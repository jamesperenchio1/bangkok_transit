"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, ArrowLeftRight, ArrowRight, Navigation, X } from "lucide-react";
import { stations, stationsByCode, type Station } from "@/data/stations";
import { RoutePanel, type RoutePanelState } from "@/components/RoutePanel";
import { StationSearch } from "@/components/StationSearch";
import { findPath } from "@/lib/transit-graph";
import { useGeolocation } from "@/lib/use-geolocation";
import { startArrivalsPolling } from "@/lib/arrivals-store";
import { haversineMeters } from "@/lib/line-geometry";

// Kicked off as soon as this module evaluates (not when <TransitMap> first
// renders), so the MapLibre chunk - by far the largest download - starts in
// parallel with hydration instead of after it.
const transitMapModule = typeof window !== "undefined" ? import("@/components/TransitMap") : null;

const TransitMap = dynamic(
  () => (transitMapModule ?? import("@/components/TransitMap")).then((m) => m.TransitMap),
  { ssr: false },
);

function nearestStation(lat: number, lon: number): { station: Station; meters: number } {
  let best = stations[0];
  let bestMeters = Infinity;
  for (const s of stations) {
    const meters = haversineMeters([lat, lon], [s.lat, s.lon]);
    if (meters < bestMeters) {
      best = s;
      bestMeters = meters;
    }
  }
  return { station: best, meters: bestMeters };
}

function distanceLabel(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

export default function Home() {
  const [start, setStart] = useState<Station | null>(null);
  const [destination, setDestination] = useState<Station | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focusStation, setFocusStation] = useState<Station | null>(null);
  const { position, error: geoError } = useGeolocation();

  useEffect(() => {
    startArrivalsPolling();
  }, []);

  // The route lives in the URL (?from=N15&to=CEN) so a reload, a PWA
  // relaunch, or a shared link lands on the same route. Read once on mount;
  // after that the URL just mirrors state.
  const [urlRead, setUrlRead] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const from = stationsByCode.get(params.get("from") ?? "");
    const to = stationsByCode.get(params.get("to") ?? "");
    // One-time sync from the URL on mount. It can't be a lazy useState
    // initializer: the page is prerendered, where there's no URL to read,
    // and the header would then mismatch on hydration.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (from) setStart(from);
    if (to && to.code !== from?.code) setDestination(to);
    setUrlRead(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => {
    if (!urlRead) return;
    const params = new URLSearchParams(window.location.search);
    if (start) params.set("from", start.code);
    else params.delete("from");
    if (destination) params.set("to", destination.code);
    else params.delete("to");
    const query = params.toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }, [urlRead, start, destination]);

  const nearest = useMemo(
    () => (position ? nearestStation(position.lat, position.lon) : null),
    [position],
  );

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

  // A fresh object each time so picking the same station twice still
  // re-triggers the map's fly-to/open-card effect.
  const handleSearchSelect = (station: Station) => {
    setFocusStation({ ...station });
    setSheetOpen(false);
  };

  const swapRoute = () => {
    setStart(destination);
    setDestination(start);
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
              <span className="inline-flex max-w-[40vw] items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-medium text-white">
                <span className="shrink-0 opacity-80">Start:</span>
                <span className="truncate">{start ? start.nameEn : "—"}</span>
                {start && (
                  <button onClick={() => setStart(null)} aria-label="Clear start" className="shrink-0">
                    <X size={11} />
                  </button>
                )}
              </span>
              <button
                onClick={swapRoute}
                aria-label="Swap start and destination"
                title="Swap start and destination"
                className="rounded-full p-0.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <ArrowLeftRight size={13} />
              </button>
              <span className="inline-flex max-w-[40vw] items-center gap-1 rounded-full border border-green-600 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:text-green-400">
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

        {nearest && !hasRoute && (
          <button
            onClick={() => handleSearchSelect(nearest.station)}
            className="absolute inset-x-0 bottom-10 z-[1000] mx-auto flex w-fit max-w-[90%] items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-lg hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            <Navigation size={14} className="shrink-0 text-blue-600" />
            <span className="truncate">
              Nearest: {nearest.station.nameEn}
            </span>
            <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
              {distanceLabel(nearest.meters)}
            </span>
          </button>
        )}

        {hasRoute && !sheetOpen && (
          <button
            onClick={() => setSheetOpen(true)}
            className="absolute inset-x-0 bottom-10 z-[1000] mx-auto flex w-fit items-center gap-1.5 rounded-full bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-green-700"
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
