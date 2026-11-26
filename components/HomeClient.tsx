"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, ArrowLeftRight, ArrowRight, Navigation, WifiOff, X } from "lucide-react";
import { stationsByCode, type Station } from "@/data/stations";
import { fareText, RoutePanel, type RoutePanelState } from "@/components/RoutePanel";
import { StationSearch } from "@/components/StationSearch";
import { SettingsMenu } from "@/components/SettingsMenu";
import { InstallHint } from "@/components/InstallHint";
import { MapLegend } from "@/components/MapLegend";
import { ReportIssue } from "@/components/ReportIssue";
import { StopAlertBanner } from "@/components/StopAlertControl";
import { useStopAlert } from "@/lib/use-stop-alert";
import { findPath, linesInTheWay, walkEstimate } from "@/lib/transit-graph";
import { useGeolocation } from "@/lib/use-geolocation";
import { startArrivalsPolling, useArrivalsStore } from "@/lib/arrivals-store";
import { scheduleOfflineWarm } from "@/lib/offline-warm";
import { fetchLineGeometry, haversineMeters } from "@/lib/line-geometry";
import { whenMapPainted } from "@/lib/map-ready";
import { distanceLabel, nearestStation } from "@/lib/nearest-station";
import type { FinalWalk } from "@/lib/place-station";
import type { Place } from "@/lib/google-places";
import { computeFare } from "@/lib/fares";
import { useFares } from "@/lib/use-fares";
import { restoreLang, stationName, useLangStore, useT } from "@/lib/i18n";
import { restoreSettings, useSettingsStore } from "@/lib/settings-store";
import { googleMapsKey } from "@/lib/google-maps";
import { chooseMap } from "@/lib/map-provider";
import { firstRideLeg, tripTiming } from "@/lib/trip-time";
import { useArrivals } from "@/lib/use-arrivals";
import { tapFeedback } from "@/lib/haptics";

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

// Only /v2 renders it, so the classic page never downloads the sheet's code.
const StationSheet = dynamic(() => import("@/components/v2/StationSheet").then((m) => m.StationSheet), {
  ssr: false,
});

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
  variant = "classic",
}: {
  children?: React.ReactNode;
  /** Build-time SVG of the network, painted before the map's JS arrives. */
  networkSvg?: string;
  /**
   * "classic" is the shipped app (station cards on the map). "v2" is the
   * native-feeling preview: a station tap opens its own sheet instead of the
   * map card, and everything else is unchanged.
   */
  variant?: "classic" | "v2";
}) {
  const v2 = variant === "v2";
  const [start, setStart] = useState<Station | null>(null);
  const [destination, setDestination] = useState<Station | null>(null);
  const [recentTrips, setRecentTrips] = useState<{ from: string; to: string }[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  // /v2's station sheet, and the browser-back layer that closes it.
  const [stationSheet, setStationSheet] = useState<Station | null>(null);
  // Bumped to make the search palette close itself: it owns its open state.
  const [closeSearch, setCloseSearch] = useState(0);
  const [focusStation, setFocusStation] = useState<Station | null>(null);
  const [focusPlace, setFocusPlace] = useState<Place | null>(null);
  // The place a route ends (or starts) at. Kept beside the station so the last
  // walk can be shown and measured, and cleared when a plain station is picked.
  const [startPlace, setStartPlace] = useState<Place | null>(null);
  const [destinationPlace, setDestinationPlace] = useState<Place | null>(null);
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
  // PWA shortcut / shared link asked for "route from where I am"; resolved
  // once geolocation settles, never from a guessed position.
  const [nearRequested, setNearRequested] = useState(false);

  // /v2's station sheet pushes and releases its own back-layer entry (see
  // components/v2/StationSheet.tsx) - registering one here as well would make
  // a single back press walk two history entries.

  // Recent trips (localStorage)
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("bts:trips:v1") || "[]");
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      if (Array.isArray(raw)) setRecentTrips(raw.slice(0, 8));
    } catch {}
  }, []);
  useEffect(() => {
    if (!start || !destination) return;
    const entry = { from: start.code, to: destination.code };
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setRecentTrips((prev) => {
      const filtered = prev.filter((t) => !(t.from === entry.from && t.to === entry.to));
      const next = [entry, ...filtered].slice(0, 8);
      try { localStorage.setItem("bts:trips:v1", JSON.stringify(next)); } catch {}
      return next;
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [start?.code, destination?.code]);
  const { position, settled, error: geoError } = useGeolocation();
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
    const sharedLang = params.get("lang");
    if (sharedLang === "en" || sharedLang === "th") useLangStore.getState().setLang(sharedLang);
    if (from) setStart(from);
    if (to && to.code !== from?.code) {
      setDestination(to);
      // A shared link can end at a place, not a station: restore the last
      // walk too instead of silently dropping it and rerouting to the station.
      const name = params.get("toName");
      const latRaw = params.get("toLat");
      const lonRaw = params.get("toLon");
      const lat = latRaw === null ? NaN : Number(latRaw);
      const lon = lonRaw === null ? NaN : Number(lonRaw);
      if (name && Number.isFinite(lat) && Number.isFinite(lon)) {
        setDestinationPlace({ id: "shared", name, detail: "", kind: "place", lat, lon });
      }
    }
    if (params.get("near") === "1") setNearRequested(true);
    // Web Share Target: a maps link or coordinates shared into the installed
    // app becomes a route. The station is the nearest one to the pin; the pin
    // itself is kept as the destination place so the final walk is shown.
    if (!to) {
      const shared = `${params.get("title") ?? ""} ${params.get("text") ?? ""} ${params.get("url") ?? ""}`;
      const match =
        /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/.exec(shared) ??
        /[?&](?:q|query|destination|ll)=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/.exec(shared);
      if (match) {
        const lat = Number(match[1]);
        const lon = Number(match[2]);
        if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
          const near = nearestStation(lat, lon);
          setDestination(near.station);
          const name = (params.get("title") || params.get("text") || t.sharedPlace).trim().slice(0, 80);
          setDestinationPlace({ id: "shared", name, detail: "", kind: "place", lat, lon });
        }
      }
    }
    setUrlRead(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    // Mount-only: deep links are read once, before the URL mirror starts.
    // `t.sharedPlace` is only the fallback name; the language itself is set
    // from the same URL above, so re-running on a language switch is wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!urlRead) return;
    const params = new URLSearchParams(window.location.search);
    if (start) params.set("from", start.code);
    else params.delete("from");
    if (destination) params.set("to", destination.code);
    else params.delete("to");
    // `toName`/`toLat`/`toLon` belong to the current destination place; a
    // plain station selection must clear them or a reload would resurrect it.
    if (destinationPlace) {
      params.set("toName", destinationPlace.name);
      params.set("toLat", String(destinationPlace.lat));
      params.set("toLon", String(destinationPlace.lon));
    } else {
      params.delete("toName");
      params.delete("toLat");
      params.delete("toLon");
    }
    params.delete("near");
    const query = params.toString();
    // `history.state` carries the back-layer tags pushed by open sheets;
    // replaceState must keep them, or back would stop closing the top layer.
    window.history.replaceState(window.history.state, "", query ? `?${query}` : window.location.pathname);
  }, [urlRead, start, destination, destinationPlace]);

  // The dot follows every fix; anything that decides something for the rider
  // (nearest station, stop alerts) waits for `settled`, so a jittery fix can't
  // flip the destination station on the card.
  const nearest = useMemo(
    () => (settled ? nearestStation(settled.lat, settled.lon) : null),
    [settled],
  );

  // Resolve a "route from here" shortcut once, after the position is trusted.
  useEffect(() => {
    if (!nearRequested || !nearest) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setStart(nearest.station);
    setStartPlace(null);
    setNearRequested(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [nearRequested, nearest]);

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
  // When the destination was picked as a place, the trip ends with a walk from
  // the station chosen for it (lib/place-station.ts) to the place itself.
  const finalWalk = useMemo<FinalWalk | null>(() => {
    if (!destination || !destinationPlace) return null;
    const meters = haversineMeters(
      [destination.lat, destination.lon],
      [destinationPlace.lat, destinationPlace.lon],
    );
    return {
      from: { lat: destination.lat, lon: destination.lon },
      to: { lat: destinationPlace.lat, lon: destinationPlace.lon },
      meters,
      minutes: walkEstimate(meters, walkSpeed),
      name: destinationPlace.name,
    };
  }, [destination, destinationPlace, walkSpeed]);
  const firstWalk = useMemo<FinalWalk | null>(() => {
    if (!start || !position || startPlace) return null;
    const meters = haversineMeters([start.lat, start.lon], [position.lat, position.lon]);
    if (meters > 1500) return null;
    return {
      from: { lat: position.lat, lon: position.lon },
      to: { lat: start.lat, lon: start.lon },
      meters,
      minutes: walkEstimate(meters, walkSpeed),
      name: stationName(start, lang),
    };
  }, [start, position, startPlace, walkSpeed, lang]);
  // Door-to-door time now includes the wait for the first train (live when
  // BTS data is fresh, otherwise half the line's headway). Same helper as
  // the route sheet, so the header and the sheet cannot disagree.
  const firstLeg = path ? firstRideLeg(path) : null;
  const firstArrivals = useArrivals(firstLeg?.station.code ?? null);
  const timing = path ? tripTiming(path, firstArrivals.data, firstArrivals.now) : null;
  // Walk estimates are fractional; riders read whole minutes.
  const totalMinutes = Math.round((timing?.minutes ?? path?.minutes ?? 0) + (finalWalk?.minutes ?? 0) + (firstWalk?.minutes ?? 0));

  // No route, but only because of lines turned off for routes: say which.
  const blockedBy = useMemo(
    () => (start && destination && !path ? linesInTheWay(start.code, destination.code, routeOptions) : []),
    [start, destination, path, routeOptions],
  );
  const fares = useFares(path !== null && showFare);
  const fareLine = showFare ? fareText(t, computeFare(path, fares)) : "";

  const handleSetStart = (station: Station, place?: Place) => {
    tapFeedback();
    setStart(station);
    setStartPlace(place ?? null);
    if (destination?.code === station.code) {
      setDestination(null);
      setDestinationPlace(null);
    }
  };

  const handleSetDestination = (station: Station, place?: Place) => {
    if (start?.code === station.code) return;
    tapFeedback();
    setDestination(station);
    setDestinationPlace(place ?? null);
    setSheetOpen(true);
  };

  // Tapping a station only opens its info card (a MapLibre popup). It never
  // mutates route state - routes change through the card's buttons or the
  // header chips. Dismissing the sheet keeps the card visible.
  const handleSelectStation = () => {
    setSheetOpen(false);
  };

  // /v2: a station tap opens the native sheet instead of a map card, and takes
  // over the screen from the search palette (which owns its own open state).
  // The sheet stays open after Start/Destination is set, so the rider sees
  // their choice land on it. The route sheet is left alone on purpose: closing
  // it here would race its history entry against the sheet's new one, and the
  // station sheet is simply drawn above it.
  const handleStationOpen = (station: Station) => {
    setCloseSearch((n) => n + 1);
    setStationSheet(station);
  };

  const clearRoute = () => {
    setStart(null);
    setDestination(null);
    setStartPlace(null);
    setDestinationPlace(null);
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
    setStartPlace(destinationPlace);
    setDestinationPlace(startPlace);
  };

  const panelState: RoutePanelState | null = useMemo(() => {
    if (start && destination) return { mode: "route", start, destination, path, blockedBy, finalWalk, firstWalk };
    return null;
  }, [start, destination, path, blockedBy, finalWalk, firstWalk]);

  const startCode = start?.code ?? null;
  const destinationCode = destination?.code ?? null;
  const hasRoute = start !== null && destination !== null;
  const stopAlert = useStopAlert(path, settled);

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
              {path && <span> · {t.aboutMinutes(totalMinutes)}</span>}
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
          <ReportIssue
            trigger="header"
            context={{
              lang,
              mapProvider: loadedMap,
              startCode: start?.code ?? null,
              destinationCode: destination?.code ?? null,
              focusStationCode: focusStation?.code ?? null,
              routeMinutes: path ? totalMinutes : null,
              routeChanges: path?.changes ?? null,
            }}
          />
          <StationSearch
            onSelectStation={handleSearchSelect}
            onSelectPlace={handlePlaceSelect}
            closeSignal={closeSearch}
          />
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
      <InstallHint />
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
        {!hasRoute && recentTrips.length > 0 && (
          <div className="absolute inset-x-0 top-2 z-[999] flex gap-2 overflow-x-auto px-3">
            {recentTrips.map((tr) => {
              const fromS = stationsByCode.get(tr.from);
              const toS = stationsByCode.get(tr.to);
              if (!fromS || !toS) return null;
              return (
                <button
                  key={`${tr.from}-${tr.to}`}
                  onClick={() => { tapFeedback(); setStart(fromS); setDestination(toS); setSheetOpen(true); }}
                  className="shrink-0 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 shadow-sm hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                >
                  {stationName(fromS, lang)} → {stationName(toS, lang)}
                </button>
              );
            })}
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
            onStationOpen={v2 ? handleStationOpen : undefined}
            onSetStart={handleSetStart}
            onSetDestination={handleSetDestination}
            startCode={startCode}
            destinationCode={destinationCode}
            path={path}
            finalWalk={finalWalk}
            firstWalk={firstWalk}
            pathOptions={routeOptions}
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
            onStationOpen={v2 ? handleStationOpen : undefined}
            onSetStart={handleSetStart}
            onSetDestination={handleSetDestination}
            startCode={startCode}
            destinationCode={destinationCode}
            path={path}
            finalWalk={finalWalk}
            firstWalk={firstWalk}
            pathOptions={routeOptions}
            userPosition={position}
            focusStation={focusStation}
            focusPlace={focusPlace}
            sheetOpen={sheetOpen && hasRoute}
            onLoad={() => setLoadedMap("standard")}
          />
        )}

        {nearest && !hasRoute && (
          <button
            onClick={() => {
              tapFeedback();
              setStart(nearest.station);
              setStartPlace(null);
              // Open the station card too, so the rider can confirm the
              // platform and see the live trains before choosing a destination.
              setFocusStation({ ...nearest.station });
              // remember the walk from the rider to the station
              if (settled) {
                // stored via state below; we reuse userPosition via a temp? We'll compute in HomeClient as firstWalk
              }
            }}
            className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+2.5rem)] z-[1000] mx-auto flex min-h-11 w-fit max-w-[90%] items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-lg hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            <Navigation size={14} className="shrink-0 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            <span className="truncate">
              {t.nearest}: {stationName(nearest.station, lang)} — {t.startRoute}
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
        <MapLegend />
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
      {v2 && (
        <StationSheet
          station={stationSheet}
          onClose={() => setStationSheet(null)}
          startCode={startCode}
          destinationCode={destinationCode}
          onSetStart={handleSetStart}
          onSetDestination={handleSetDestination}
        />
      )}
      {children}
    </div>
  );
}
