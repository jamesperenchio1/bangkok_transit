"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, Polyline, useMap } from "react-leaflet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/components/language-provider";
import type { Station, Line, BoatRoute, BusRoute } from "@/data/schemas";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface TransitMapClientProps {
  initialData: {
    stations: Station[];
    lines: Line[];
    boatRoutes: BoatRoute[];
    busRoutes: BusRoute[];
  };
}

function MapBounds({ stations }: { stations: Station[] }) {
  const map = useMap();
  useEffect(() => {
    if (stations.length === 0) return;
    const lats = stations.map((s) => s.lat);
    const lngs = stations.map((s) => s.lng);
    const bounds = L.latLngBounds(
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)]
    );
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, stations]);
  return null;
}

export function TransitMapClient({ initialData }: TransitMapClientProps) {
  const { stations, lines, boatRoutes, busRoutes } = initialData;
  const { language } = useLanguage();
  const [userPos, setUserPos] = useState<[number, number] | null>(null);

  // Per-line toggle — each line has its own on/off state
  const [activeLines, setActiveLines] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      lines
        .filter((l) => l.mode !== "boat" && l.mode !== "bus")
        .map((l) => [l.id, true])
    )
  );
  const [showBoat, setShowBoat] = useState(false);
  const [showBus, setShowBus] = useState(false);

  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) =>
        setUserPos([pos.coords.latitude, pos.coords.longitude])
      );
    }
  }, []);

  const lineById = useMemo(
    () => new Map(lines.map((l) => [l.id, l])),
    [lines]
  );

  const stationById = useMemo(
    () => new Map(stations.map((s) => [s.id, s])),
    [stations]
  );

  const visibleStations = useMemo(
    () =>
      stations.filter((s) =>
        s.lineIds.some((lid) => activeLines[lid])
      ),
    [stations, activeLines]
  );

  // Build ordered polyline coordinates per active line
  const linePolylines = useMemo(() => {
    const result: { line: Line; coords: [number, number][] }[] = [];
    for (const line of lines) {
      if (!activeLines[line.id]) continue;
      if (line.stationIds.length < 2) continue;
      const coords: [number, number][] = [];
      for (const sid of line.stationIds) {
        const s = stationById.get(sid);
        if (s) coords.push([s.lat, s.lng]);
      }
      if (coords.length >= 2) result.push({ line, coords });
    }
    return result;
  }, [lines, activeLines, stationById]);

  const toggleLine = (lineId: string) =>
    setActiveLines((prev) => ({ ...prev, [lineId]: !prev[lineId] }));

  const center: [number, number] = [13.7563, 100.5018];

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Line toggle toolbar */}
      <div className="flex items-center gap-2 overflow-x-auto p-2 border-b bg-background/95 shrink-0">
        {lines
          .filter((l) => l.mode !== "boat" && l.mode !== "bus")
          .map((line) => (
            <Button
              key={line.id}
              variant={activeLines[line.id] ? "default" : "outline"}
              size="sm"
              onClick={() => toggleLine(line.id)}
              className="whitespace-nowrap text-xs shrink-0"
              style={
                activeLines[line.id]
                  ? { backgroundColor: line.color, color: line.textColor, borderColor: line.color }
                  : { borderColor: line.color, color: line.color }
              }
            >
              {line.shortName}
            </Button>
          ))}
        <Button
          variant={showBoat ? "default" : "outline"}
          size="sm"
          onClick={() => setShowBoat((v) => !v)}
          className="whitespace-nowrap text-xs shrink-0"
        >
          🚤 Boat
        </Button>
        <Button
          variant={showBus ? "default" : "outline"}
          size="sm"
          onClick={() => setShowBus((v) => !v)}
          className="whitespace-nowrap text-xs shrink-0"
        >
          🚌 Bus
        </Button>
      </div>

      <div className="flex-1 relative">
        <MapContainer center={center} zoom={12} className="h-full w-full" scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          <MapBounds stations={stations} />

          {/* Draw line routes as polylines */}
          {linePolylines.map(({ line, coords }) => (
            <Polyline
              key={`line-${line.id}`}
              positions={coords}
              color={line.color}
              weight={4}
              opacity={0.85}
            />
          ))}

          {/* Station markers */}
          {visibleStations.map((station) => {
            const primaryLine = lineById.get(station.lineIds[0]);
            const color = primaryLine?.color || "#666";
            return (
              <CircleMarker
                key={station.id}
                center={[station.lat, station.lng]}
                radius={station.isInterchange ? 8 : 5}
                fillColor={color}
                color="#fff"
                weight={2}
                fillOpacity={1}
              >
                <Popup>
                  <div className="space-y-1 min-w-[160px]">
                    <div className="font-semibold">
                      {language === "th" ? station.nameTh : station.nameEn}
                    </div>
                    {station.codes.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {station.codes.join(", ")}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1 pt-1">
                      {station.lineIds.map((lid) => {
                        const line = lineById.get(lid);
                        return line ? (
                          <Badge
                            key={lid}
                            style={{ backgroundColor: line.color, color: line.textColor }}
                            className="text-[10px]"
                          >
                            {line.shortName}
                          </Badge>
                        ) : null;
                      })}
                    </div>
                    <Link
                      href={`/station/${station.id}`}
                      className="text-xs font-medium text-primary hover:underline block pt-1"
                    >
                      View station →
                    </Link>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}

          {/* Boat piers */}
          {showBoat &&
            boatRoutes.map((route) =>
              route.piers.map((pier, idx) => (
                <CircleMarker
                  key={`boat-${route.id}-${idx}`}
                  center={[pier.lat, pier.lng]}
                  radius={5}
                  fillColor={route.color}
                  color="#fff"
                  weight={2}
                  fillOpacity={0.9}
                >
                  <Popup>
                    <div className="font-medium">
                      {language === "th" ? pier.nameTh : pier.nameEn}
                    </div>
                    <div className="text-xs text-muted-foreground">{route.nameEn}</div>
                  </Popup>
                </CircleMarker>
              ))
            )}

          {/* User location */}
          {userPos && (
            <Marker
              position={userPos}
              icon={L.divIcon({
                className: "bg-transparent",
                html: `<div style="width:16px;height:16px;border-radius:50%;background:#2563eb;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
              })}
            >
              <Popup>You are here</Popup>
            </Marker>
          )}
        </MapContainer>
      </div>
    </div>
  );
}
