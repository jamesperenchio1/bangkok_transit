"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { X, Check, AlertTriangle } from "lucide-react";
import type { Station } from "@/data/stations";
import { RoutePanel, type RoutePanelState } from "@/components/RoutePanel";
import { findPath, type PathResult } from "@/lib/transit-graph";
import { useGeolocation } from "@/lib/use-geolocation";

const TransitMap = dynamic(
  () => import("@/components/TransitMap").then((m) => m.TransitMap),
  { ssr: false },
);

type RouteState =
  | { mode: "idle" }
  | { mode: "start-selected"; start: Station }
  | { mode: "confirm-pending"; start: Station; destination: Station }
  | { mode: "confirmed"; start: Station; destination: Station; path: PathResult | null };

export default function Home() {
  const [route, setRoute] = useState<RouteState>({ mode: "idle" });
  const { position, error: geoError } = useGeolocation();

  const handleSelectStation = (station: Station) => {
    if (route.mode === "idle") {
      setRoute({ mode: "start-selected", start: station });
    } else if (route.mode === "start-selected") {
      if (station.code === route.start.code) {
        setRoute({ mode: "idle" });
      } else {
        setRoute({ mode: "confirm-pending", start: route.start, destination: station });
      }
    } else {
      // Already confirmed or mid-confirmation - tapping anywhere new starts over.
      setRoute({ mode: "start-selected", start: station });
    }
  };

  const confirmRoute = () => {
    if (route.mode !== "confirm-pending") return;
    const path = findPath(route.start.code, route.destination.code);
    setRoute({ mode: "confirmed", start: route.start, destination: route.destination, path });
  };

  const reset = () => setRoute({ mode: "idle" });

  const panelState: RoutePanelState | null = useMemo(() => {
    if (route.mode === "start-selected") return { mode: "station", station: route.start };
    if (route.mode === "confirmed")
      return { mode: "route", start: route.start, destination: route.destination, path: route.path };
    return null;
  }, [route]);

  const startCode = route.mode !== "idle" ? route.start.code : null;
  const destinationCode =
    route.mode === "confirm-pending" || route.mode === "confirmed" ? route.destination.code : null;
  const path = route.mode === "confirmed" ? route.path : null;

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div>
          <h1 className="text-base font-semibold">Bangkok Transit</h1>
          <p className="text-xs text-neutral-500">
            {route.mode === "idle" && "Tap a station to start a route"}
            {route.mode === "start-selected" && `From ${route.start.nameEn} — tap your destination`}
            {route.mode === "confirm-pending" && "Confirm your route below"}
            {route.mode === "confirmed" && "Route highlighted — tap any station to start over"}
          </p>
        </div>
        {route.mode !== "idle" && (
          <button
            onClick={reset}
            className="shrink-0 rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            New route
          </button>
        )}
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
          startCode={startCode}
          destinationCode={destinationCode}
          path={path}
          userPosition={position}
        />
      </div>

      {route.mode === "confirm-pending" && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-neutral-200 bg-white px-4 py-3 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-sm">
            <span className="font-medium">{route.start.nameEn}</span>
            {" → "}
            <span className="font-medium">{route.destination.nameEn}</span>
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={reset}
              className="rounded-full p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              aria-label="Cancel"
            >
              <X size={18} />
            </button>
            <button
              onClick={confirmRoute}
              className="flex items-center gap-1.5 rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
            >
              <Check size={16} />
              Confirm
            </button>
          </div>
        </div>
      )}

      <RoutePanel state={panelState} userPosition={position} onClose={reset} />
    </main>
  );
}
