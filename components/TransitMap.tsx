"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";
import type { Popup as LeafletPopup } from "leaflet";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { LocateFixed } from "lucide-react";
import { stations, type Station } from "@/data/stations";
import { fullLineSegments, trackBetween } from "@/lib/line-geometry";
import type { GeoPosition } from "@/lib/use-geolocation";
import type { PathResult } from "@/lib/transit-graph";
import { StationActions } from "@/components/StationActions";
import { LINE_COLORS } from "@/lib/line-colors";

const STATION_BOUNDS: [[number, number], [number, number]] = [
  [Math.min(...stations.map((s) => s.lat)), Math.min(...stations.map((s) => s.lon))],
  [Math.max(...stations.map((s) => s.lat)), Math.max(...stations.map((s) => s.lon))],
];

export interface TransitMapProps {
  onSelectStation: (station: Station) => void;
  onSetStart: (station: Station) => void;
  onSetDestination: (station: Station) => void;
  startCode: string | null;
  destinationCode: string | null;
  path: PathResult | null;
  userPosition: GeoPosition | null;
  /** Set (e.g. from a search result) to fly the map to a station on demand. */
  focusStation: Station | null;
}

// Flies the map to a station whenever `station` changes (e.g. a search
// result was picked) - a plain prop rather than local state, since the map
// itself has no other reason to know about search.
function FocusStation({ station }: { station: Station | null }) {
  const map = useMap();
  useEffect(() => {
    if (!station) return;
    map.flyTo([station.lat, station.lon], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [station, map]);
  return null;
}

// Recenters the map on the user's live GPS position. There was previously
// no way to get back to it after panning around - the blue dot rendered but
// nothing let you jump to it.
function LocateButton({ position }: { position: GeoPosition | null }) {
  const map = useMap();
  return (
    <button
      type="button"
      onClick={() => {
        if (position) map.flyTo([position.lat, position.lon], Math.max(map.getZoom(), 16), { duration: 0.6 });
      }}
      disabled={!position}
      aria-label="Center on my location"
      title={position ? "Center on my location" : "Waiting for your location…"}
      className="absolute top-3 right-3 z-[1000] rounded-full border border-neutral-300 bg-white p-2.5 text-neutral-700 shadow-md hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      <LocateFixed size={18} />
    </button>
  );
}

// Leaflet computes fitBounds() from the container's size at mount time. If
// the container hasn't finished its flex-layout pass yet (or the tab is
// backgrounded), that size can read as 0 and fitBounds picks a wildly wrong
// (usually max) zoom with no way to recover on its own. Re-asserting the fit
// after mount (and once more shortly after, catching a late layout pass)
// fixes it without needing the initial size to already be correct.
function FitStationBounds() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    let fitted = false;

    const tryFit = () => {
      map.invalidateSize();
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      map.fitBounds(STATION_BOUNDS, { padding: [24, 24] });
      fitted = true;
    };

    tryFit();
    if (fitted) return;

    // The container had zero size at mount (a flex-layout race, or the tab
    // being backgrounded) - keep watching until it actually has room, then
    // fit once and stop.
    const observer = new ResizeObserver(() => {
      if (!fitted) tryFit();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);
  return null;
}

export function TransitMap({
  onSelectStation,
  onSetStart,
  onSetDestination,
  startCode,
  destinationCode,
  path,
  userPosition,
  focusStation,
}: TransitMapProps) {
  const pathCodes = useMemo(
    () => new Set(path?.map((leg) => leg.station.code) ?? []),
    [path],
  );
  const isRouting = path !== null;

  // Closing a station's popup after an action lets the user immediately tap
  // another station to pick the other end of their route, rather than
  // having to dismiss the popup themselves first.
  const popupRefs = useRef(new Map<string, LeafletPopup>());
  const handleSetStart = (station: Station) => {
    onSetStart(station);
    popupRefs.current.get(station.code)?.close();
  };
  const handleSetDestination = (station: Station) => {
    onSetDestination(station);
    popupRefs.current.get(station.code)?.close();
  };

  const lineKeys = useMemo(
    () => [...new Set(stations.flatMap((s) => s.lines.map((l) => l.line)))],
    [],
  );

  const lines = useMemo(
    () =>
      lineKeys.map((line) => ({
        line,
        color: LINE_COLORS[line],
        segments: fullLineSegments(line),
      })),
    [lineKeys],
  );

  return (
    <MapContainer
      center={[13.75, 100.55]}
      zoom={11}
      className="h-full w-full"
      preferCanvas
    >
      <FitStationBounds />
      <FocusStation station={focusStation} />
      <LocateButton position={userPosition} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {lines.map(({ line, color, segments }) =>
        segments.map((positions, i) => (
          <Polyline
            key={`${line}-${i}`}
            positions={positions}
            pathOptions={
              isRouting
                ? { color: "#ccc", weight: 3, opacity: 0.6 }
                : { color, weight: 4, opacity: 0.9 }
            }
            smoothFactor={1.5}
          />
        )),
      )}

      {/* Highlighted path drawn on top, following the real track curve
          between each pair of adjacent stations rather than a straight
          chord between them. */}
      {isRouting &&
        path!.slice(1).map((leg, i) => {
          const prevStation = path![i].station;
          if (!leg.line) return null;
          return (
            <Polyline
              key={`path-${i}`}
              positions={trackBetween(leg.line, prevStation, leg.station)}
              pathOptions={{
                color: LINE_COLORS[leg.line],
                weight: 5,
                opacity: 1,
              }}
              smoothFactor={1.5}
            />
          );
        })}

      {stations.map((s) => {
        const onPath = pathCodes.has(s.code);
        const isEndpoint = s.code === startCode || s.code === destinationCode;
        const dimmed = isRouting && !onPath;
        const color = s.lines[0] ? LINE_COLORS[s.lines[0].line] : "#666";
        return (
          <CircleMarker
            key={s.code}
            center={[s.lat, s.lon]}
            radius={isEndpoint ? 8 : s.lines.length > 1 ? 6 : 4}
            pathOptions={{
              color: dimmed ? "#ccc" : "#fff",
              weight: isEndpoint ? 3 : 1.5,
              fillColor: dimmed ? "#ddd" : color,
              fillOpacity: dimmed ? 0.7 : 1,
            }}
            eventHandlers={{ click: () => onSelectStation(s) }}
          >
            <Popup
              ref={(el) => {
                if (el) popupRefs.current.set(s.code, el);
                else popupRefs.current.delete(s.code);
              }}
              offset={[0, -4]}
              minWidth={200}
              maxWidth={240}
              autoPanPadding={[24, 24]}
            >
              <div className="flex flex-col gap-2 py-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold text-white"
                    style={{ backgroundColor: color }}
                  >
                    {s.code}
                  </span>
                  <span className="truncate text-sm font-semibold text-neutral-900">{s.nameEn}</span>
                </div>
                <StationActions
                  station={s}
                  startCode={startCode}
                  onSetStart={handleSetStart}
                  onSetDestination={handleSetDestination}
                />
              </div>
            </Popup>
          </CircleMarker>
        );
      })}

      {userPosition && (
        <>
          <CircleMarker
            center={[userPosition.lat, userPosition.lon]}
            radius={Math.max(userPosition.accuracy / 4, 8)}
            pathOptions={{ color: "#2563eb", weight: 1, fillColor: "#2563eb", fillOpacity: 0.15 }}
          />
          <CircleMarker
            center={[userPosition.lat, userPosition.lon]}
            radius={7}
            pathOptions={{ color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 }}
          />
        </>
      )}
    </MapContainer>
  );
}
