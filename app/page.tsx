"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, ArrowRight, ArrowUpDown, Navigation, RotateCcw, X } from "lucide-react";
import { stations, stationsByCode, type Station } from "@/data/stations";
import { RoutePanel, type RoutePanelState } from "@/components/RoutePanel";
import { StationSearch } from "@/components/StationSearch";
import { StationDetail } from "@/components/StationDetail";
import { findPath } from "@/lib/transit-graph";
import { useGeolocation } from "@/lib/use-geolocation";
import { startArrivalsPolling } from "@/lib/arrivals-store";
import { haversineMeters } from "@/lib/line-geometry";
import { restoreLang, stationName, useLangStore, useT } from "@/lib/i18n";
import { distanceLabel } from "@/lib/format-distance";

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

/** Small EN/TH segmented switch for the header. */
function LangToggle() {
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  return (
    <div
      role="group"
      aria-label="Language / ภาษา"
      className="flex rounded-full border border-neutral-300 p-0.5 text-[11px] font-semibold dark:border-neutral-700"
    >
      {(["en", "th"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={`rounded-full px-2 py-1 ${
            lang === l
              ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
              : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/**
 * One end of the route in the header. Its marker matches the map's (solid
 * green = start, dashed green ring = destination); the full name wraps
 * rather than truncating, and an empty row says what to do next instead of
 * a separate hint line.
 */
function EndpointRow({
  kind,
  station,
  placeholder,
  prompt,
  onOpen,
  onClear,
}: {
  kind: "start" | "destination";
  station: Station | null;
  placeholder: string;
  /** The empty row is the next thing to fill in - say so more loudly. */
  prompt: boolean;
  onOpen: (station: Station) => void;
  onClear: () => void;
}) {
  const { lang, t } = useT();
  return (
    <div className="flex min-h-12 items-center gap-2.5 pl-3">
      {kind === "start" ? (
        <span className="h-3.5 w-3.5 shrink-0 rounded-full border-[3px] border-green-600 bg-green-600 ring-2 ring-green-600/25" aria-hidden />
      ) : (
        <span className="h-3.5 w-3.5 shrink-0 rounded-full border-[3px] border-dashed border-green-600 bg-white dark:bg-neutral-900" aria-hidden />
      )}
      <div className="min-w-0 flex-1 py-1">
        <p className="text-[11px] leading-tight text-neutral-500">{kind === "start" ? t.start : t.destination}</p>
        {station ? (
          <button
            onClick={() => onOpen(station)}
            className="text-left text-sm leading-snug font-semibold break-words hover:underline"
          >
            {stationName(station, lang)}
          </button>
        ) : (
          <p
            className={`text-sm leading-snug ${
              prompt ? "font-semibold text-green-700 dark:text-green-400" : "text-neutral-400"
            }`}
          >
            {placeholder}
          </p>
        )}
      </div>
      {station && (
        <button
          onClick={onClear}
          aria-label={kind === "start" ? t.clearStart : t.clearDestination}
          title={kind === "start" ? t.clearStart : t.clearDestination}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <X size={20} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

export default function Home() {
  const [start, setStart] = useState<Station | null>(null);
  const [destination, setDestination] = useState<Station | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focusStation, setFocusStation] = useState<Station | null>(null);
  // The station page, open over the map (which stays mounted underneath).
  // Mirrored as ?station=CODE so it can be shared, and pushed as a history
  // entry so the phone's Back button closes it.
  const [detailStation, setDetailStation] = useState<Station | null>(null);
  const { position, error: geoError } = useGeolocation();
  const { lang, t } = useT();

  useEffect(() => {
    startArrivalsPolling();
    restoreLang();
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
    setDetailStation(stationsByCode.get(params.get("station") ?? "") ?? null);
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
    window.history.replaceState(window.history.state, "", query ? `?${query}` : window.location.pathname);
    // detailStation too: picking Start/Destination on the station page also
    // closes it (history.back()), landing on an older entry that predates
    // the change - re-mirror the route onto it.
  }, [urlRead, start, destination, detailStation]);

  // Back/forward moves in and out of the station page.
  useEffect(() => {
    const onPopState = () => {
      const code = new URLSearchParams(window.location.search).get("station");
      setDetailStation(stationsByCode.get(code ?? "") ?? null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const openStation = useCallback((station: Station) => {
    const params = new URLSearchParams(window.location.search);
    params.set("station", station.code);
    // Station-to-station hops (a connection link) replace rather than stack,
    // so one Back always returns to the map.
    const replace = window.history.state?.stationPage === true;
    window.history[replace ? "replaceState" : "pushState"]({ stationPage: true }, "", `?${params}`);
    setDetailStation(station);
    setSheetOpen(false);
  }, []);

  const closeStation = useCallback(() => {
    if (window.history.state?.stationPage) {
      // Opened in this visit: pop our own entry (popstate clears the state).
      window.history.back();
    } else {
      // Landed straight on a ?station= link - there's nothing to go back to.
      const params = new URLSearchParams(window.location.search);
      params.delete("station");
      const query = params.toString();
      window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
      setDetailStation(null);
    }
  }, []);

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


  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-neutral-200 px-3 pt-2 pb-3 dark:border-neutral-800">
        <div className="flex items-center justify-between gap-2">
          <h1 className="truncate pl-1 text-base font-semibold">{t.appTitle}</h1>
          <div className="flex shrink-0 items-center gap-2">
            {(start || destination) && (
              <button
                onClick={clearRoute}
                aria-label={t.resetRoute}
                className="flex items-center gap-1 rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <RotateCcw size={14} />
                {t.reset}
              </button>
            )}
            <LangToggle />
            <StationSearch onSelectStation={handleSearchSelect} />
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <div className="min-w-0 flex-1 divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            <EndpointRow
              kind="start"
              station={start}
              placeholder={destination ? t.nowPickStart : t.pickStart}
              prompt={!start && destination !== null}
              onOpen={openStation}
              onClear={() => setStart(null)}
            />
            <EndpointRow
              kind="destination"
              station={destination}
              placeholder={start ? t.nowPickDestination : t.pickDestination}
              prompt={start !== null && !destination}
              onOpen={openStation}
              onClear={() => {
                setDestination(null);
                setSheetOpen(false);
              }}
            />
          </div>
          <button
            onClick={swapRoute}
            disabled={!start && !destination}
            aria-label={t.swap}
            title={t.swap}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <ArrowUpDown size={20} />
          </button>
        </div>
      </header>

      {geoError === "denied" && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <AlertTriangle size={14} className="shrink-0" />
          {t.locationDenied}
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
          onOpenStation={openStation}
        />

        {nearest && !hasRoute && (
          <button
            onClick={() => handleSearchSelect(nearest.station)}
            className="absolute inset-x-0 bottom-10 z-[1000] mx-auto flex w-fit max-w-[90%] items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-lg hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            <Navigation size={14} className="shrink-0 text-blue-600" />
            <span className="truncate">
              {t.nearest}: {stationName(nearest.station, lang)}
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
            {t.viewRoute} <ArrowRight size={15} />
          </button>
        )}
      </div>

      <RoutePanel
        state={sheetOpen ? panelState : null}
        userPosition={position}
        onClose={() => setSheetOpen(false)}
        onOpenStation={openStation}
      />

      {detailStation && (
        <StationDetail
          station={detailStation}
          startCode={startCode}
          destinationCode={destinationCode}
          onSetStart={(s) => {
            handleSetStart(s);
            closeStation();
          }}
          onSetDestination={(s) => {
            handleSetDestination(s);
            closeStation();
          }}
          onOpenStation={openStation}
          onClose={closeStation}
        />
      )}
    </main>
  );
}
