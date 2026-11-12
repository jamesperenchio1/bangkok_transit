"use client";

import { useEffect, useRef } from "react";
import { stations as allStations, stationsByCode, type Station } from "@/data/stations";
import { LINE_COLORS } from "@/lib/line-colors";
import {
  fetchLineGeometry,
  trackBetween,
  type LineSegments,
} from "@/lib/line-geometry";
import { googleMapsMapId, loadGoogleMaps } from "@/lib/google-maps";
import type { Place } from "@/lib/google-places";
import { stationName } from "@/lib/i18n";
import { nearestStation } from "@/lib/nearest-station";
import { useSettingsStore } from "@/lib/settings-store";
import type { PathResult } from "@/lib/transit-graph";
import type { GeoPosition } from "@/lib/use-geolocation";

export interface GoogleTransitMapProps {
  onSelectStation: (station: Station) => void;
  onSetStart: (station: Station) => void;
  onSetDestination: (station: Station) => void;
  startCode: string | null;
  destinationCode: string | null;
  path: PathResult | null;
  userPosition: GeoPosition | null;
  focusStation: Station | null;
  focusPlace: Place | null;
  sheetOpen: boolean;
  onLoad?: () => void;
}

const CENTER = { lat: 13.7563, lng: 100.5018 };
const WALK_COLOR = "#6b7280";

type Overlay = {
  setMap?: (map: google.maps.Map | null) => void;
  map?: google.maps.Map | null;
};
type Anchor = google.maps.MVCObject | google.maps.marker.AdvancedMarkerElement;

/**
 * The opt-in Google basemap. It mirrors the MapLibre view (curved lines,
 * station dots, route, GPS) but is only mounted when Settings says Google,
 * so the default visit never downloads the Maps JavaScript API.
 */
export function GoogleTransitMap({
  onSelectStation,
  onSetStart,
  onSetDestination,
  startCode,
  destinationCode,
  path,
  userPosition,
  focusStation,
  focusPlace,
  sheetOpen,
  onLoad,
}: GoogleTransitMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const geometryRef = useRef<LineSegments>({});
  const baseOverlays = useRef<Overlay[]>([]);
  const routeOverlays = useRef<Overlay[]>([]);
  const startOverlay = useRef<Overlay | null>(null);
  const destinationOverlay = useRef<Overlay | null>(null);
  const gpsOverlay = useRef<Overlay | null>(null);
  const placeOverlay = useRef<Overlay | null>(null);
  const readyRef = useRef(false);

  const { lineWidth, zoomButtons, googleMapType, theme, showLabels } =
    useSettingsStore((s) => s.settings);

  const latest = useRef({
    onSelectStation,
    onSetStart,
    onSetDestination,
    path,
    startCode,
    destinationCode,
    userPosition,
    focusStation,
    focusPlace,
    lineWidth,
    showLabels,
    onLoad,
  });
  latest.current = {
    onSelectStation,
    onSetStart,
    onSetDestination,
    path,
    startCode,
    destinationCode,
    userPosition,
    focusStation,
    focusPlace,
    lineWidth,
    showLabels,
    onLoad,
  };

  useEffect(() => {
    let cancelled = false;
    const listeners: google.maps.MapsEventListener[] = [];

    async function boot() {
      const g = await loadGoogleMaps();
      if (cancelled || !containerRef.current) return;

      const mapId = googleMapsMapId();
      const options: google.maps.MapOptions = {
        center: CENTER,
        zoom: 11,
        disableDefaultUI: true,
        zoomControl: zoomButtons,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        gestureHandling: "greedy",
        backgroundColor: "#f2efe9",
      };
      if (mapId) {
        // A Map ID enables vector maps and the light/dark `colorScheme`.
        options.mapId = mapId;
        options.colorScheme = theme === "dark" ? "DARK" : "LIGHT";
      } else {
        // Without a Map ID the JS API uses raster tiles, where `colorScheme`
        // is invalid; the map type (roadmap/hybrid/satellite) applies instead.
        options.mapTypeId = googleMapType as google.maps.MapTypeId;
      }
      const map = new g.maps.Map(containerRef.current, options);
      mapRef.current = map;
      infoRef.current = new g.maps.InfoWindow();

      geometryRef.current = await fetchLineGeometry();
      if (cancelled) return;

      drawBase();
      drawRoute(latest.current.path);
      drawEndpoints(latest.current.startCode, latest.current.destinationCode);
      drawGps(latest.current.userPosition);
      if (latest.current.focusStation) focusOnStation(latest.current.focusStation);
      if (latest.current.focusPlace) focusOnPlace(latest.current.focusPlace);

      const bounds = new g.maps.LatLngBounds();
      for (const station of allStations) {
        bounds.extend({ lat: station.lat, lng: station.lon });
      }
      map.fitBounds(bounds, 48);

      listeners.push(
        map.addListener("idle", () => {
          if (readyRef.current) return;
          readyRef.current = true;
          latest.current.onLoad?.();
        }),
      );
    }

    void boot().catch((error: unknown) => {
      // No key, offline, or a blocked script: HomeClient keeps the SVG
      // network on screen instead of showing a broken map.
      const message = error instanceof Error ? error.message : String(error);
      containerRef.current?.setAttribute("data-google-error", message);
    });

    return () => {
      cancelled = true;
      for (const listener of listeners) listener.remove();
      baseOverlays.current = [];
      routeOverlays.current = [];
      infoRef.current?.close();
      mapRef.current = null;
    };
    // The map is created once; settings and props are applied by the effects
    // below so changing a route never rebuilds the basemap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function detach(overlay: Overlay | null) {
    if (!overlay) return;
    if (overlay.setMap) overlay.setMap(null);
    else overlay.map = null;
  }

  function clear(list: React.RefObject<Overlay[]>) {
    for (const overlay of list.current) detach(overlay);
    list.current = [];
  }

  function addStationMarker(map: google.maps.Map, station: Station): Overlay {
    const g = window.google;
    const color = LINE_COLORS[station.lines[0]?.line ?? "sukhumvit"];
    const big = station.lines.length > 1;
    const size = big ? 14 : 10;

    if (googleMapsMapId()) {
      const wrap = document.createElement("button");
      wrap.type = "button";
      wrap.className = "flex items-center gap-1 border-0 bg-transparent p-0";
      wrap.setAttribute("aria-label", stationName(station, "en"));

      const dot = document.createElement("span");
      dot.className = "block rounded-full border-2 border-white shadow";
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      dot.style.background = color;

      const label = document.createElement("span");
      label.textContent = station.nameEn;
      label.dataset.stationLabel = "1";
      label.className =
        "whitespace-nowrap rounded bg-white/85 px-1 text-[10px] font-medium text-neutral-800 shadow-sm dark:bg-neutral-900/85 dark:text-neutral-100";
      label.style.display = latest.current.showLabels ? "" : "none";

      wrap.append(dot, label);
      const marker = new g.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: station.lat, lng: station.lon },
        content: wrap,
        title: stationName(station, "en"),
        zIndex: big ? 12 : 10,
      });
      marker.addListener("click", () => openStation(station, marker));
      return marker;
    }

    const marker = new g.maps.Marker({
      map,
      position: { lat: station.lat, lng: station.lon },
      title: stationName(station, "en"),
      icon: {
        path: g.maps.SymbolPath.CIRCLE,
        scale: big ? 7 : 5,
        fillColor: color,
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      },
      zIndex: big ? 12 : 10,
    });
    marker.addListener("click", () => openStation(station, marker));
    return marker;
  }

  function drawBase() {
    const g = window.google;
    const map = mapRef.current;
    if (!g || !map) return;
    clear(baseOverlays);

    for (const [line, segments] of Object.entries(geometryRef.current)) {
      const color = LINE_COLORS[line as keyof typeof LINE_COLORS] ?? "#64748b";
      for (const segment of segments) {
        baseOverlays.current.push(
          new g.maps.Polyline({
            map,
            path: segment.map(([lat, lon]) => ({ lat, lng: lon })),
            strokeColor: color,
            strokeOpacity: 0.9,
            strokeWeight: latest.current.lineWidth,
            clickable: false,
            zIndex: 2,
          }),
        );
      }
    }

    for (const station of allStations) {
      baseOverlays.current.push(addStationMarker(map, station));
    }
  }

  function drawRoute(nextPath: PathResult | null) {
    const g = window.google;
    const map = mapRef.current;
    if (!g || !map) return;
    clear(routeOverlays);
    if (!nextPath) return;

    for (let i = 1; i < nextPath.legs.length; i += 1) {
      const leg = nextPath.legs[i];
      const previous = nextPath.legs[i - 1].station;
      const walk = leg.mode === "walk";
      const points =
        leg.mode === "ride" && leg.line
          ? trackBetween(geometryRef.current, leg.line, previous, leg.station)
          : [
              [previous.lat, previous.lon] as [number, number],
              [leg.station.lat, leg.station.lon] as [number, number],
            ];

      routeOverlays.current.push(
        new g.maps.Polyline({
          map,
          path: points.map(([lat, lon]) => ({ lat, lng: lon })),
          strokeColor: walk
            ? WALK_COLOR
            : leg.line
              ? LINE_COLORS[leg.line]
              : "#111827",
          strokeOpacity: walk ? 0 : 1,
          strokeWeight: walk ? 4 : 7,
          zIndex: 20,
          icons: walk
            ? [
                {
                  icon: {
                    path: "M 0,-1 0,1",
                    strokeOpacity: 1,
                    scale: 3,
                  },
                  offset: "0",
                  repeat: "14px",
                },
              ]
            : undefined,
        }),
      );
    }
  }

  function drawEndpoints(nextStart: string | null, nextDestination: string | null) {
    const g = window.google;
    const map = mapRef.current;
    if (!g || !map) return;
    detach(startOverlay.current);
    detach(destinationOverlay.current);

    for (const [code, label, color] of [
      [nextStart, "A", "#16a34a"],
      [nextDestination, "B", "#dc2626"],
    ] as const) {
      const station = code ? stationsByCode.get(code) : null;
      if (!station) continue;
      const marker = new g.maps.Marker({
        map,
        position: { lat: station.lat, lng: station.lon },
        label: {
          text: label,
          color: "#ffffff",
          fontSize: "11px",
          fontWeight: "700",
        },
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
        zIndex: 30,
      });
      if (label === "A") startOverlay.current = marker;
      else destinationOverlay.current = marker;
    }
  }

  function drawGps(position: GeoPosition | null) {
    const g = window.google;
    const map = mapRef.current;
    if (!g || !map) return;
    detach(gpsOverlay.current);
    if (!position) return;
    gpsOverlay.current = new g.maps.Marker({
      map,
      position: { lat: position.lat, lng: position.lon },
      icon: {
        path: g.maps.SymbolPath.CIRCLE,
        scale: 7,
        fillColor: "#2563eb",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 3,
      },
      title: "You",
      zIndex: 40,
    });
  }

  function openStation(station: Station, anchor: Anchor) {
    const map = mapRef.current;
    const info = infoRef.current;
    if (!map || !info) return;

    const el = document.createElement("div");
    el.className = "min-w-[170px] p-1 text-neutral-900";

    const title = document.createElement("div");
    title.className = "text-sm font-semibold";
    title.textContent = stationName(station, "en");

    const lines = document.createElement("div");
    lines.className = "mt-0.5 text-xs text-neutral-500";
    lines.textContent = station.lines.map((line) => line.name).join(" · ");

    const actions = document.createElement("div");
    actions.className = "mt-2 flex gap-2";

    const makeButton = (text: string, onClick: () => void, filled = true) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.className = filled
        ? "rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white"
        : "rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-800";
      button.onclick = () => {
        onClick();
        info.close();
      };
      return button;
    };

    actions.append(
      makeButton("Start", () => latest.current.onSetStart(station)),
      makeButton("Destination", () => latest.current.onSetDestination(station)),
      makeButton("Details", () => latest.current.onSelectStation(station), false),
    );
    el.append(title, lines, actions);

    info.setContent(el);
    info.open({ map, anchor });
  }

  function focusOnStation(station: Station) {
    const map = mapRef.current;
    if (!map) return;
    map.panTo({ lat: station.lat, lng: station.lon });
    map.setZoom(16);
  }

  function focusOnPlace(place: Place) {
    const g = window.google;
    const map = mapRef.current;
    if (!g || !map) return;

    detach(placeOverlay.current);
    const marker = new g.maps.Marker({
      map,
      position: { lat: place.lat, lng: place.lon },
      title: place.name,
      icon: {
        path: g.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#16a34a",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      },
      zIndex: 35,
    });
    placeOverlay.current = marker;

    const near = nearestStation(place.lat, place.lon);
    const info = infoRef.current;
    if (info) {
      const el = document.createElement("div");
      el.className = "min-w-[180px] p-1 text-neutral-900";
      const title = document.createElement("div");
      title.className = "text-sm font-semibold";
      title.textContent = place.name;
      const detail = document.createElement("div");
      detail.className = "mt-0.5 text-xs text-neutral-500";
      detail.textContent = place.detail;
      const nearest = document.createElement("div");
      nearest.className = "mt-1 text-xs text-neutral-600";
      nearest.textContent = `Near ${near.station.nameEn} · ${near.meters} m`;
      const actions = document.createElement("div");
      actions.className = "mt-2 flex gap-2";
      const start = document.createElement("button");
      start.type = "button";
      start.textContent = "Start";
      start.className =
        "rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white";
      start.onclick = () => {
        latest.current.onSetStart(near.station);
        info.close();
      };
      const destination = document.createElement("button");
      destination.type = "button";
      destination.textContent = "Destination";
      destination.className =
        "rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white";
      destination.onclick = () => {
        latest.current.onSetDestination(near.station);
        info.close();
      };
      actions.append(start, destination);
      el.append(title, detail, nearest, actions);
      info.setContent(el);
      info.open({ map, anchor: marker });
    }

    map.panTo({ lat: place.lat, lng: place.lon });
    map.setZoom(16);
  }

  useEffect(() => {
    if (mapRef.current) drawRoute(path);
    // Map helpers close over refs; the path is the only changing input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    if (mapRef.current) drawEndpoints(startCode, destinationCode);
    // Endpoints are redrawn only when either code changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startCode, destinationCode]);

  useEffect(() => {
    if (mapRef.current) drawGps(userPosition);
    // The GPS dot is redrawn only when the position changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPosition]);

  useEffect(() => {
    if (focusStation) focusOnStation(focusStation);
  }, [focusStation]);

  useEffect(() => {
    if (focusPlace) focusOnPlace(focusPlace);
    // focusOnPlace closes over the map; the place is the only input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPlace]);

  useEffect(() => {
    mapRef.current?.setMapTypeId(googleMapType);
  }, [googleMapType]);

  useEffect(() => {
    mapRef.current?.setOptions({
      colorScheme: theme === "dark" ? "DARK" : "LIGHT",
    } as google.maps.MapOptions);
  }, [theme]);

  useEffect(() => {
    mapRef.current?.setOptions({ zoomControl: zoomButtons });
  }, [zoomButtons]);

  useEffect(() => {
    containerRef.current?.setAttribute("data-sheet-open", sheetOpen ? "true" : "false");
  }, [sheetOpen]);

  useEffect(() => {
    if (mapRef.current) drawBase();
    // drawBase closes over the map and its refs; lineWidth is its only input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineWidth]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const label of containerRef.current?.querySelectorAll<HTMLElement>(
      "[data-station-label]",
    ) ?? []) {
      label.style.display = showLabels ? "" : "none";
    }
  }, [showLabels]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      aria-label="Transit map"
      role="application"
    />
  );
}
