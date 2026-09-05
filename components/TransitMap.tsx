"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { stations, type Station } from "@/data/stations";
import lineSequences from "@/data/line-sequences.json";
import type { GeoPosition } from "@/lib/use-geolocation";
import type { PathResult } from "@/lib/transit-graph";

const STATION_BOUNDS: [[number, number], [number, number]] = [
  [Math.min(...stations.map((s) => s.lat)), Math.min(...stations.map((s) => s.lon))],
  [Math.max(...stations.map((s) => s.lat)), Math.max(...stations.map((s) => s.lon))],
];

export interface TransitMapProps {
  onSelectStation: (station: Station) => void;
  startCode: string | null;
  destinationCode: string | null;
  path: PathResult | null;
  userPosition: GeoPosition | null;
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

function lineCoords(codes: string[]): [number, number][] {
  return codes
    .map((code) => stations.find((s) => s.code === code))
    .filter((s): s is Station => Boolean(s))
    .map((s) => [s.lat, s.lon]);
}

export function TransitMap({
  onSelectStation,
  startCode,
  destinationCode,
  path,
  userPosition,
}: TransitMapProps) {
  const pathCodes = useMemo(
    () => new Set(path?.map((leg) => leg.station.code) ?? []),
    [path],
  );
  const isRouting = path !== null;

  const lines = useMemo(
    () =>
      Object.entries(lineSequences).map(([line, codes]) => ({
        line,
        color: stations.find((s) => s.lines.some((l) => l.line === line))?.lines.find(
          (l) => l.line === line,
        )?.color ?? "#999",
        coords: lineCoords(codes as string[]),
      })),
    [],
  );

  return (
    <MapContainer
      center={[13.75, 100.55]}
      zoom={11}
      className="h-full w-full"
      preferCanvas
    >
      <FitStationBounds />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {lines.map(({ line, color, coords }) => (
        <Polyline
          key={line}
          positions={coords}
          pathOptions={
            isRouting
              ? { color: "#ccc", weight: 3, opacity: 0.6 }
              : { color, weight: 4, opacity: 0.9 }
          }
        />
      ))}

      {/* Highlighted path segments drawn on top, in each leg's own line color. */}
      {isRouting &&
        path!.slice(1).map((leg, i) => {
          const prevStation = path![i].station;
          if (!leg.line) return null;
          return (
            <Polyline
              key={`path-${i}`}
              positions={[
                [prevStation.lat, prevStation.lon],
                [leg.station.lat, leg.station.lon],
              ]}
              pathOptions={{
                color: leg.station.lines.find((l) => l.line === leg.line)?.color ?? "#333",
                weight: 5,
                opacity: 1,
              }}
            />
          );
        })}

      {stations.map((s) => {
        const onPath = pathCodes.has(s.code);
        const isEndpoint = s.code === startCode || s.code === destinationCode;
        const dimmed = isRouting && !onPath;
        const color = s.lines[0]?.color ?? "#666";
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
            <Tooltip direction="top" offset={[0, -4]}>
              {s.nameEn} ({s.code})
            </Tooltip>
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
