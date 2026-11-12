"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, ArrowLeftRight, ArrowRight, Navigation, WifiOff, X } from "lucide-react";
import { stationsByCode, type Station } from "@/data/stations";
import { fareText, RoutePanel, type RoutePanelState } from "@/components/RoutePanel";
import { StationSearch } from "@/components/StationSearch";
import { SettingsMenu } from "@/components/SettingsMenu";
import { StopAlertBanner } from "@/components/StopAlertControl";
import { useStopAlert } from "@/lib/use-stop-alert";
import { findPath, linesInTheWay } from "@/lib/transit-graph";
import { useGeolocation } from "@/lib/use-geolocation";
import { startArrivalsPolling, useArrivalsStore } from "@/lib/arrivals-store";
import { scheduleOfflineWarm } from "@/lib/offline-warm";
import { fetchLineGeometry } from "@/lib/line-geometry";
import { whenMapPainted } from "@/lib/map-ready";
import { distanceLabel, nearestStation } from "@/lib/nearest-station";
import type { Place } from "@/lib/google-places";
import { computeFare } from "@/lib/fares";
import { useFares } from "@/lib/use-fares";
import { restoreLang, stationName, useLangStore, useT } from "@/lib/i18n";
import { restoreSettings, useSettingsStore } from "@/lib/settings-store";
import { googleMapsKey } from "@/lib/google-maps";
import { chooseMap } from "@/lib/map-provider";

// Line geometry starts downloading with hydration. The map chunk itself is
// requested when its component first renders: MapLibre by default, Google
// only when the rider has chosen it, so a default visit never loads Google.
if (typeof window !== "undefined") void fetchLineGeometry();

const TransitMap = dynamic(() => import("@/components/TransitMap").then((m) => m.TransitMap), {
  ssr: false,
});

const GoogleTransitMap = dynamic(
  () => import("@/components/GoogleTransitMap").then((m) => m.GoogleTransitMap),
  { ssr: false },
);

/**
 * One button that shows the language you'd switch *to*. Two 44px segments
 * took a third of a phone's header width; this keeps the 44px target at a
 * quarter of that and leaves room for the hint line.
 */
function LangToggle() {
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  const next = lang === "en" ? "th" : "en";
  return (
    <button
      data-lang-toggle
      onClick={() => setLang(next)}
      aria-label={`Switch language / เปลี่ยนภาษา: ${next.toUpperCase()}`}
      className="inline-flex h-11 min-w-11 items-center justify-center rounded-full border border-neutral-300 px-2.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
    >
      <span aria-hidden="true">{next.toUpperCase()}</span>
    </button>
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

/**
 * `children` is the page's server-rendered, screen-reader-only SEO block
 * (`SeoContent`). It arrives as a prop rather than an import so that its data
 * (every line, every curated route, a pathfinding run per route pair) is built
 * once at build time and never ships in, or runs in, the browser bundle.
 */
export function HomeClient({
  children,
  networkSvg,
}: {
  children?: React.ReactNode;
  /** Build-time SVG of the network, painted before the map's JS arrives. */
  networkSvg?: string;
}) {
  const [start, setStart] = useState<Station | null>(null);
  const [destination, setDestination] = useState<Station | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focusStation, setFocusStation] = useState<Station | null>(null);
  const [focusPlace, setFocusPlace] = useState<Place | null>(null);
  // The map chunk and its first tiles are the slowest part of a cold load;
  // until the map reports first paint, the header and the build-time SVG
  // network carry the screen, with a thin indeterminate bar above them.
  // Which map has painted ("standard" / "google"), so a switch shows the
  // build-time network again until the new map reports first paint.
  const [loadedMap, setLoadedMap] = useState<"standard" | "google" | null>(null);
  // The map mounts once saved settings are in, so a rider who chose Google
  // never sees the default map mount and tear down first.
  const settingsReady = useSettingsStore((s) => s.restored);
  // Google needs the network and a working key. When it cannot load the page
  // falls back to the offline MapLibre map and says so, rather than leaving a
  // grey tile; the fallback holds for the rest of the visit.
  const [googleFailed, setGoogleFailed] = useState(false);
  const [startedOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const { position, error: geoError } = useGeolocation();
  const { lang, t } = useT();

  useEffect(() => {
    // Settings first: polling honours "pause live updates" and the offline
    // warm-up honours the data-saver choice. Both are cheap and local.
    restoreSettings();
    restoreLang();
    // The map comes first: the lines, the stations and the basemap get the
    // connection to themselves. Live times and the offline-map download start
    // once the first view is drawn (or after a short cap, so a hung basemap
    // host can't hold live times back for good).
    let cancelled = false;
    void whenMapPainted().then(() => {
      if (cancelled) return;
      startArrivalsPolling();
      scheduleOfflineWarm();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Theme, text size and motion apply to the whole page, so they live on
  // <html>. (app/layout.tsx sets theme and text size before first paint, so a
  // saved dark theme doesn't flash light.) Read from the store when the effect
  // runs - after restoreSettings() above, in the same commit - and re-applied
  // on every change, so the render-time defaults can never overwrite them.
  useEffect(() => {
    const apply = () => {
      const { textSize, theme, reduceMotion } = useSettingsStore.getState().settings;
      const root = document.documentElement;
      root.style.fontSize = textSize === 100 ? "" : `${textSize}%`;
      root.toggleAttribute("data-reduce-motion", reduceMotion);
      if (theme === "system") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", theme);
    };
    apply();
    return useSettingsStore.subscribe(apply);
  }, []);
  const { compactHeader, showFare, fewerChanges, avoidWalking, unusedLines, walkSpeed, changeMinutes, mapProvider } =
    useSettingsStore((s) => s.settings);
  const { provider: activeMap, fellBack } = chooseMap({
    chosen: mapProvider,
    hasGoogleKey: googleMapsKey() !== "",
    startedOffline,
    googleFailed,
  });
  const useGoogle = activeMap === "google";
  const mapLoaded = loadedMap === activeMap;

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
  const routeOptions = useMemo(
    () => ({ fewerChanges, avoidWalking, unusedLines, walkSpeed, changeMinutes }),
    [fewerChanges, avoidWalking, unusedLines, walkSpeed, changeMinutes],
  );
  const path = useMemo(
    () => (start && destination ? findPath(start.code, destination.code, routeOptions) : null),
    [start, destination, routeOptions],
  );
  // No route, but only because of lines turned off for routes: say which.
  const blockedBy = useMemo(
    () => (start && destination && !path ? linesInTheWay(start.code, destination.code, routeOptions) : []),
    [start, destination, path, routeOptions],
  );
  const fares = useFares(path !== null && showFare);
  const fareLine = showFare ? fareText(t, computeFare(path, fares)) : "";

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

  // A searched place (mall, hospital, address): the map shows it with its
  // nearest station, from where the rider can start or end a route.
  const handlePlaceSelect = (place: Place) => {
    setFocusPlace({ ...place });
    setSheetOpen(false);
  };

  const swapRoute = () => {
    setStart(destination);
    setDestination(start);
  };

  const panelState: RoutePanelState | null = useMemo(() => {
    if (start && destination) return { mode: "route", start, destination, path, blockedBy };
    return null;
  }, [start, destination, path, blockedBy]);

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
      <header className="flex min-h-14 shrink-0 items-center gap-1 border-b border-neutral-200 py-1 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-[max(0.25rem,env(safe-area-inset-top))] dark:border-neutral-800">
        <div className="min-w-0 flex-1 px-1">
          <h1 className="truncate text-[15px] font-semibold leading-tight">{t.appTitle}</h1>
          {hasRoute && start && destination ? (
            <p className="line-clamp-2 text-[11px] leading-tight text-neutral-600 dark:text-neutral-400">
              <span lang={lang} title={stationName(start, lang)}>{stationName(start, lang)}</span>
              <span aria-hidden="true"> → </span>
              <span lang={lang} title={stationName(destination, lang)}>{stationName(destination, lang)}</span>
              {path && <span> · {t.aboutMinutes(path.minutes)}</span>}
              {path && fareLine && <span data-testid="header-fare"> · {fareLine}</span>}
            </p>
          ) : start || destination ? (
            <p className="line-clamp-2 text-[11px] leading-tight text-neutral-600 dark:text-neutral-400">
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
            !compactHeader && (
              <p className="line-clamp-2 text-[11px] leading-tight text-neutral-600 dark:text-neutral-400">{subtitle}</p>
            )
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
          <StationSearch onSelectStation={handleSearchSelect} onSelectPlace={handlePlaceSelect} />
          <SettingsMenu />
        </div>
      </header>
      {/* Operator line colours as a hairline under the header: brand, not data. */}
      <div
        aria-hidden="true"
        className="h-[3px] shrink-0"
        style={{
          background:
            "linear-gradient(90deg,#76b729 0 16.6%,#00a651 0 33.3%,#1e4d9b 0 50%,#7b3f98 0 66.6%,#e0679a 0 83.3%,#c8102e 0)",
        }}
      />

      <OfflineBanner />
      <StopAlertBanner alert={stopAlert} />

      <main id="map" tabIndex={-1} aria-label={t.mapRegion} className="relative isolate flex-1 overflow-hidden overflow-clip outline-none">
        {!mapLoaded && (
          <div
            role="progressbar"
            aria-label={t.loadingMap}
            className="pointer-events-none absolute inset-x-0 top-0 z-[1001] h-0.5 overflow-hidden bg-neutral-200 dark:bg-neutral-800"
          >
            <div className="h-full w-1/3 animate-[progress-slide_1.1s_ease-in-out_infinite] bg-green-700" />
          </div>
        )}
        {/* Floats over the map instead of sitting above it: as a block in the
            flow it pushed the whole map down when the permission answer
            arrived (layout shift). left-14 clears the zoom buttons. */}
        {geoError === "denied" && (
          <div role="status" className="absolute left-14 right-2 top-2 z-[1002] flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 shadow-md dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
            {t.locationDenied}
          </div>
        )}
        {/* Painted from the build-time HTML, so the network is visible
            before any map JS runs. Removed once the map reports first paint. */}
        {networkSvg && !mapLoaded && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: networkSvg }}
          />
        )}
        {fellBack && (
          <div role="status" className="absolute left-14 right-2 top-14 z-[1002] flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 shadow-md dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
            {t.googleUnavailable}
          </div>
        )}
        {!settingsReady ? null : useGoogle ? (
          <GoogleTransitMap
            onSelectStation={handleSelectStation}
            onSetStart={handleSetStart}
            onSetDestination={handleSetDestination}
            startCode={startCode}
            destinationCode={destinationCode}
            path={path}
            userPosition={position}
            focusStation={focusStation}
            focusPlace={focusPlace}
            sheetOpen={sheetOpen && hasRoute}
            onLoad={() => setLoadedMap("google")}
            onError={() => setGoogleFailed(true)}
          />
        ) : (
          <TransitMap
            onSelectStation={handleSelectStation}
            onSetStart={handleSetStart}
            onSetDestination={handleSetDestination}
            startCode={startCode}
            destinationCode={destinationCode}
            path={path}
            userPosition={position}
            focusStation={focusStation}
            focusPlace={focusPlace}
            sheetOpen={sheetOpen && hasRoute}
            onLoad={() => setLoadedMap("standard")}
          />
        )}

        {nearest && !hasRoute && (
          <button
            onClick={() => handleSearchSelect(nearest.station)}
            className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+2.5rem)] z-[1000] mx-auto flex min-h-11 w-fit max-w-[90%] items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-lg hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
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
            className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+2.5rem)] z-[1000] mx-auto flex min-h-11 w-fit items-center gap-1.5 rounded-full bg-green-700 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-green-800"
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
        onUseLines={(lines) =>
          useSettingsStore.getState().update({ unusedLines: unusedLines.filter((l) => !lines.includes(l)) })
        }
      />
      {children}
    </div>
  );
}
