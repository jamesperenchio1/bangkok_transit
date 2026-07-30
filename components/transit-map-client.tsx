"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap, Polyline } from "react-leaflet";
import { MapPin, Layers } from "lucide-react";
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
  const [activeModes, setActiveModes] = useState<Record<string, boolean>>({
    bts: true,
    mrt: true,
    arl: true,
    srt: true,
    brt: true,
    boat: false,
    bus: false,
  });

  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        setUserPos([pos.coords.latitude, pos.coords.longitude]);
      });
    }
  }, []);

  const lineById = useMemo(() => {
    const map = new Map<string, Line>();
    lines.forEach((l) => map.set(l.id, l));
    return map;
  }, [lines]);

  const visibleStations = useMemo(() => {
    return stations.filter((s) => s.lineIds.some((lid) => activeModes[lineById.get(lid)?.mode || ""]));
  }, [stations, activeModes, lineById]);

  const toggleMode = (mode: string) => {
    setActiveModes((prev) => ({ ...prev, [mode]: !prev[mode] }));
  };

  const center: [number, number] = [13.7563, 100.5018];

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <div className="flex items-center gap-2 overflow-x-auto p-3 border-b bg-background/95">
        {lines.map((line) => (
          <Button
            key={line.id}
            variant={activeModes[line.mode] ? "default" : "outline"}
            size="sm"
            onClick={() => toggleMode(line.mode)}
            className="whitespace-nowrap text-xs"
            style={
              activeModes[line.mode]
                ? { backgroundColor: line.color, color: line.textColor }
                : {}
            }
          >
            {line.shortName}
          </Button>
        ))}
        <Button
          variant={activeModes.boat ? "default" : "outline"}
          size="sm"
          onClick={() => toggleMode("boat")}
          className="whitespace-nowrap text-xs"
        >
          Boat
        </Button>
        <Button
          variant={activeModes.bus ? "default" : "outline"}
          size="sm"
          onClick={() => toggleMode("bus")}
          className="whitespace-nowrap text-xs"
        >
          Bus
        </Button>
      </div>

      <div className="flex-1 relative">
        <MapContainer center={center} zoom={12} className="h-full w-full" scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          <MapBounds stations={stations} />

          {visibleStations.map((station) => {
            const primaryLine = lineById.get(station.lineIds[0]);
            const color = primaryLine?.color || "#666";
            return (
              <CircleMarker
                key={station.id}
                center={[station.lat, station.lng]}
                radius={station.isInterchange ? 8 : 6}
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
                    <div className="text-xs text-muted-foreground">{station.codes.join(", ")}</div>
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

          {activeModes.boat &&
            boatRoutes.map((route) =>
              route.piers.map((pier, idx) => (
                <CircleMarker
                  key={`boat-${route.id}-${idx}`}
                  center={[pier.lat, pier.lng]}
                  radius={5}
                  fillColor={route.color}
                  color="#fff"
                  weight={2}
                >
                  <Popup>
                    <div className="font-medium">{language === "th" ? pier.nameTh : pier.nameEn}</div>
                    <div className="text-xs text-muted-foreground">{route.nameEn}</div>
                  </Popup>
                </CircleMarker>
              ))
            )}

          {userPos && (
            <Marker
              position={userPos}
              icon={L.divIcon({
                className: "bg-transparent",
                html: `<div class="h-4 w-4 rounded-full bg-blue-500 border-2 border-white shadow-md"></div>`,
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
