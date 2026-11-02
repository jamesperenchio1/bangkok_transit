"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, ArrowLeftRight, ArrowRight, Navigation, WifiOff, X } from "lucide-react";
import { stations, stationsByCode, type Station } from "@/data/stations";
import { RoutePanel, type RoutePanelState } from "@/components/RoutePanel";
import { StationSearch } from "@/components/StationSearch";
import { StationList } from "@/components/StationList";
import { StopAlertBanner } from "@/components/StopAlertControl";
import { useStopAlert } from "@/lib/use-stop-alert";
import { findPath } from "@/lib/transit-graph";
import { useGeolocation } from "@/lib/use-geolocation";
import { startArrivalsPolling, useArrivalsStore } from "@/lib/arrivals-store";
import { scheduleOfflineWarm } from "@/lib/offline-warm";
import { fetchLineGeometry, haversineMeters } from "@/lib/line-geometry";
import { restoreLang, stationName, useLangStore, useT } from "@/lib/i18n";

// Kicked off as soon as this module evaluates (not when <TransitMap> first
// renders), so the MapLibre chunk - by far the largest download - and the
// line geometry both start in parallel with hydration instead of after it.
const transitMapModule = typeof window !== "undefined" ? import("@/components/TransitMap") : null;
if (typeof window !== "undefined") void fetchLineGeometry();

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
          style={{ minWidth: 44, minHeight: 44 }}
          className={`rounded-full px-2 py-1 ${
            lang === l
              ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
              : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/**
 * Shown only while the device has no connection. A polite live region, so a
 * screen reader announces the change once without interrupting. Everything
 * but live times works offline, which the message makes clear.
 */
function OfflineBanner() {
  const offline = useArrivalsStore((s) => s.offline);
  const { t } = useT();
  return (
    <div role="status" aria-live="polite">
      {offline && (
        <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-100 px-4 py-2 text-xs text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
          <WifiOff size={14} className="shrink-0" aria-hidden="true" />
          {t.offlineBadge}
        </div>
      )}
    </div>
  );
}

function distanceLabel(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

export default function Home() {
  const [start, setStart] = useState<Station | null>(null);
  const [destination, setDestination] = useState<Station | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focusStation, setFocusStation] = useState<Station | null>(null);
  // The map chunk is the biggest download; until it lands the header is the
  // only thing on screen, so a thin indeterminate bar explains the wait.
  const [mapReady, setMapReady] = useState(false);
  const { position, error: geoError } = useGeolocation();
  const { lang, t } = useT();

  useEffect(() => {
    startArrivalsPolling();
    restoreLang();
    scheduleOfflineWarm();
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Always resolve through a promise: on the server (and in tests) the module
    // is null, and setting state straight from the effect body would cascade a
    // render before hydration.
    void Promise.resolve(transitMapModule).then(() => {
      if (!cancelled) setMapReady(true);
    });
    return () => {
      cancelled = true;
    };
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
  const stopAlert = useStopAlert(path, position);

  const subtitle = !start && !destination
    ? t.hintIdle
    : start && !destination
      ? t.hintStartSet
      : !start && destination
        ? t.hintDestSet
        : t.hintRoute;

  return (
    <div className="flex flex-1 flex-col">
      <a
        href="#map"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[2000] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-neutral-900 focus:shadow-lg dark:focus:bg-neutral-900 dark:focus:text-white"
      >
        {t.skipToMap}
      </a>
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-neutral-200 px-2 dark:border-neutral-800">
        <div className="min-w-0 flex-1 px-1">
          <h1 className="truncate text-[15px] font-semibold leading-tight">{t.appTitle}</h1>
          {hasRoute && start && destination ? (
            <p className="truncate text-[11px] leading-tight text-neutral-600 dark:text-neutral-400">
              <span lang={lang} title={stationName(start, lang)}>{stationName(start, lang)}</span>
              <span aria-hidden="true"> → </span>
              <span lang={lang} title={stationName(destination, lang)}>{stationName(destination, lang)}</span>
              {path && <span> · {t.aboutMinutes(path.minutes)}</span>}
            </p>
          ) : start || destination ? (
            <p className="truncate text-[11px] leading-tight text-neutral-600 dark:text-neutral-400">
              {start && !destination ? (
                <>
                  <span className="font-medium text-neutral-800 dark:text-neutral-200">{t.start}:</span>{" "}
                  <span lang={lang}>{stationName(start, lang)}</span>
                  <span> · {t.hintStartSet}</span>
                </>
              ) : (
                <>
                  <span className="font-medium text-neutral-800 dark:text-neutral-200">{t.destination}:</span>{" "}
                  <span lang={lang}>{stationName(destination!, lang)}</span>
                  <span> · {t.hintDestSet}</span>
                </>
              )}
            </p>
          ) : (
            <p className="truncate text-[11px] leading-tight text-neutral-600 dark:text-neutral-400">{subtitle}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hasRoute && (
            <button
              onClick={swapRoute}
              aria-label={t.swap}
              title={t.swap}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <ArrowLeftRight size={16} aria-hidden="true" />
            </button>
          )}
          {hasRoute && (
            <button
              onClick={clearRoute}
              aria-label={t.clear}
              title={t.clear}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-neutral-600 hover:bg-red-50 hover:text-red-700 dark:text-neutral-400 dark:hover:bg-red-950 dark:hover:text-red-400"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
          <LangToggle />
          <StationList onSelectStation={handleSearchSelect} />
          <StationSearch onSelectStation={handleSearchSelect} />
        </div>
      </header>

      <OfflineBanner />
      <StopAlertBanner alert={stopAlert} />

      {geoError === "denied" && (
        <div role="status" className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
          {t.locationDenied}
        </div>
      )}

      <main id="map" tabIndex={-1} aria-label={t.mapRegion} className="relative isolate flex-1 overflow-hidden outline-none">
        {!mapReady && (
          <div
            role="progressbar"
            aria-label={t.loadingMap}
            className="pointer-events-none absolute inset-x-0 top-0 z-[1001] h-0.5 overflow-hidden bg-neutral-200 dark:bg-neutral-800"
          >
            <div className="h-full w-1/3 animate-[progress-slide_1.1s_ease-in-out_infinite] bg-green-700" />
          </div>
        )}
        <TransitMap
          onSelectStation={handleSelectStation}
          onSetStart={handleSetStart}
          onSetDestination={handleSetDestination}
          startCode={startCode}
          destinationCode={destinationCode}
          path={path}
          userPosition={position}
          focusStation={focusStation}
          sheetOpen={sheetOpen && hasRoute}
        />

        {nearest && !hasRoute && (
          <button
            onClick={() => handleSearchSelect(nearest.station)}
            className="absolute inset-x-0 bottom-10 z-[1000] mx-auto flex min-h-11 w-fit max-w-[90%] items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-lg hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            <Navigation size={14} className="shrink-0 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            <span className="truncate">
              {t.nearest}: {stationName(nearest.station, lang)}
            </span>
            <span className="shrink-0 text-xs text-neutral-600 dark:text-neutral-400">
              {distanceLabel(nearest.meters)}
            </span>
          </button>
        )}

        {hasRoute && !sheetOpen && (
          <button
            onClick={() => setSheetOpen(true)}
            className="absolute inset-x-0 bottom-10 z-[1000] mx-auto flex min-h-11 w-fit items-center gap-1.5 rounded-full bg-green-700 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-green-800"
          >
            {t.viewRoute} <ArrowRight size={15} aria-hidden="true" />
          </button>
        )}
      </main>

      <RoutePanel
        state={sheetOpen ? panelState : null}
        userPosition={position}
        stopAlert={stopAlert}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}
