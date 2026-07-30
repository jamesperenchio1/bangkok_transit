"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  MapPin,
  Navigation,
  AlertTriangle,
  Clock,
  Ticket,
  Palmtree,
  Car,
  ArrowRight,
  CloudRain,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/components/language-provider";
import type { Station, Line, Alert, Place } from "@/data/schemas";
import Fuse from "fuse.js";
import { haversine } from "@/lib/geo";

interface DashboardClientProps {
  initialData: {
    stations: Station[];
    lines: Line[];
    alerts: Alert[];
    places: Place[];
  };
}

const touristDestinations = [
  { id: "grand-palace", nameEn: "Grand Palace", nameTh: "พระบรมมหาราชวัง", icon: "🏛️" },
  { id: "wat-arun", nameEn: "Wat Arun", nameTh: "วัดอรุณ", icon: "🛕" },
  { id: "iconsiam", nameEn: "ICONSIAM", nameTh: "ไอคอนสยาม", icon: "🛍️" },
  { id: "chatuchak-market", nameEn: "Chatuchak Market", nameTh: "ตลาดจตุจักร", icon: "🛒" },
  { id: "siam-paragon", nameEn: "Siam Paragon", nameTh: "สยามพารากอน", icon: "🏬" },
  { id: "terminal-21-asok", nameEn: "Terminal 21", nameTh: "เทอร์มินอล 21", icon: "🛍️" },
];

export function DashboardClient({ initialData }: DashboardClientProps) {
  const { stations, lines, alerts, places } = initialData;
  const { t, language } = useLanguage();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [location, setLocation] = useState<GeolocationPosition | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation(pos),
        () => setLocationError(t("locationError"))
      );
    }
  }, [t]);

  const fuse = useMemo(
    () =>
      new Fuse(stations, {
        keys: ["nameEn", "nameTh", "codes"],
        threshold: 0.35,
      }),
    [stations]
  );

  const placeFuse = useMemo(
    () =>
      new Fuse(places, {
        keys: ["nameEn", "nameTh", "category"],
        threshold: 0.35,
      }),
    [places]
  );

  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    const stationResults = fuse.search(query).slice(0, 4).map((r) => ({ type: "station" as const, item: r.item }));
    const placeResults = placeFuse.search(query).slice(0, 3).map((r) => ({ type: "place" as const, item: r.item }));
    return [...stationResults, ...placeResults];
  }, [query, fuse, placeFuse]);

  const nearestStation = useMemo(() => {
    if (!location) return null;
    const { latitude, longitude } = location.coords;
    let nearest: Station | null = null;
    let minDist = Infinity;
    for (const station of stations) {
      const dist = haversine(latitude, longitude, station.lat, station.lng);
      if (dist < minDist) {
        minDist = dist;
        nearest = station;
      }
    }
    return nearest ? { station: nearest, distance: minDist } : null;
  }, [location, stations]);

  const handlePlanRoute = () => {
    if (from && to) {
      router.push(`/route?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    }
  };

  const getLine = (lineId: string) => lines.find((l) => l.id === lineId);

  return (
    <div className="container max-w-5xl px-4 py-6 space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">{t("knowBeforeYouGo")}</h1>
        <p className="text-muted-foreground">{t("tagline")}</p>
      </section>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="pl-10 h-12"
        />
        {searchResults.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-lg">
            {searchResults.map((result, idx) => (
              <Link
                key={`${result.type}-${idx}`}
                href={
                  result.type === "station"
                    ? `/station/${result.item.id}`
                    : `/route?to=${encodeURIComponent(result.item.nameEn)}`
                }
                className="flex items-center justify-between px-4 py-3 hover:bg-accent border-b last:border-0"
              >
                <div>
                  <div className="font-medium">
                    {language === "th" && "nameTh" in result.item && result.item.nameTh
                      ? result.item.nameTh
                      : result.item.nameEn}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {result.type === "station"
                      ? result.item.codes.join(", ")
                      : result.item.category}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Quick route planner */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Navigation className="h-4 w-4" />
            {t("planRoute")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto]">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{t("from")}</label>
              <Input
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder={t("search")}
                list="station-from"
              />
            </div>
            <div className="hidden sm:flex items-end justify-center">
              <ArrowRight className="h-5 w-5 text-muted-foreground mb-2" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{t("to")}</label>
              <Input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder={t("search")}
                list="station-to"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handlePlanRoute} className="w-full sm:w-auto">
                {t("planRoute")}
              </Button>
            </div>
          </div>
          <datalist id="station-from">
            {stations.map((s) => (
              <option key={s.id} value={s.nameEn} />
            ))}
          </datalist>
          <datalist id="station-to">
            {stations.map((s) => (
              <option key={s.id} value={s.nameEn} />
            ))}
          </datalist>
        </CardContent>
      </Card>

      {/* Nearest station */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            {t("currentLocation")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {nearestStation ? (
            <Link
              href={`/station/${nearestStation.station.id}`}
              className="flex items-center justify-between group"
            >
              <div>
                <div className="font-semibold text-lg">
                  {language === "th" ? nearestStation.station.nameTh : nearestStation.station.nameEn}
                </div>
                <div className="text-sm text-muted-foreground">
                  {nearestStation.station.codes.join(", ")} · {Math.round(nearestStation.distance)} m
                </div>
                <div className="flex gap-1 mt-2">
                  {nearestStation.station.lineIds.map((lineId) => {
                    const line = getLine(lineId);
                    return line ? (
                      <Badge
                        key={lineId}
                        style={{ backgroundColor: line.color, color: line.textColor }}
                        className="text-xs"
                      >
                        {line.shortName}
                      </Badge>
                    ) : null;
                  })}
                </div>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            </Link>
          ) : (
            <div className="text-muted-foreground">
              {locationError || t("gettingLocation")}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Service alerts */}
      {alerts.length > 0 && (
        <Card className="border-l-4 border-l-yellow-500">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              {t("serviceAlerts")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {alerts.slice(0, 2).map((alert) => (
              <div key={alert.id} className="text-sm">
                <div className="font-medium">
                  {language === "th" ? alert.titleTh : alert.titleEn}
                </div>
                <div className="text-muted-foreground line-clamp-2">
                  {language === "th" ? alert.descriptionTh : alert.descriptionEn}
                </div>
              </div>
            ))}
            <Link href="/alerts" className="text-sm font-medium text-primary hover:underline">
              {t("serviceAlerts")} →
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Tourist shortcuts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Palmtree className="h-4 w-4" />
            {t("touristMode")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {touristDestinations.map((dest) => (
              <Link
                key={dest.id}
                href={`/route?to=${encodeURIComponent(dest.nameEn)}`}
                className="flex flex-col items-center justify-center rounded-lg border p-3 hover:bg-accent transition-colors text-center"
              >
                <span className="text-2xl mb-1">{dest.icon}</span>
                <span className="text-sm font-medium line-clamp-1">
                  {language === "th" ? dest.nameTh : dest.nameEn}
                </span>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
