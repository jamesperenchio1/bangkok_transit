"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import {
  AlertTriangle, ArrowUpFromLine, Train, Ticket, Car, Coffee,
  Baby, BatteryCharging, ShoppingBag, CreditCard, Phone,
  Accessibility, Info, Bike, Bus, Ship, Waypoints,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/components/language-provider";
import type { TranslationKey } from "@/lib/i18n";
import type { Station, Line, Exit, Facility, Parking, Place, Alert, Timetable } from "@/data/schemas";

// Client-only: it reads localStorage synchronously on mount to paint
// last-known data instantly, which would mismatch the server-rendered HTML
// (always empty) if hydrated normally.
const StationArrivals = dynamic(
  () => import("@/components/station-arrivals").then((mod) => mod.StationArrivals),
  { ssr: false }
);

interface StationDetailClientProps {
  station: Station;
  lines: Line[];
  exits?: Exit;
  facility?: Facility;
  parking?: Parking;
  places: Place[];
  alerts: Alert[];
  timetables: Timetable[];
}

const facilityIcons: Record<string, React.ElementType> = {
  elevators:          ArrowUpFromLine,
  escalators:         ArrowUpFromLine,
  toilets:            Waypoints,
  disabledAccess:     Accessibility,
  babyChanging:       Baby,
  atms:               CreditCard,
  convenienceStores:  ShoppingBag,
  food:               Coffee,
  chargingPoints:     BatteryCharging,
  bikeParking:        Bike,
  carParking:         Car,
  motorcycleParking:  Car,
  taxiStand:          Car,
  motorcycleTaxi:     Car,
  busStop:            Bus,
  boatPier:           Ship,
  lostAndFound:       Info,
  customerService:    Phone,
  evCharging:         BatteryCharging,
};

export function StationDetailClient({
  station,
  lines,
  exits,
  facility,
  parking,
  places,
  alerts,
  timetables,
}: StationDetailClientProps) {
  const { t, language } = useLanguage();

  const lineMap = new Map(lines.map((l) => [l.id, l]));
  const stationLines = station.lineIds.map((id) => lineMap.get(id)).filter(Boolean) as Line[];
  const stationTimetables = timetables.filter((tt) => station.lineIds.includes(tt.lineId));

  // Live arrivals only exist for BTS Skytrain — see AGENTS.md scope note.
  const isBts = station.lineIds.some((id) => id.startsWith("bts-"));
  const btsCode = isBts ? station.codes[0] : undefined;

  return (
    <div className="container max-w-3xl px-4 py-6 space-y-6">
      <section className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {stationLines.map((line) => (
            <Badge
              key={line.id}
              style={{ backgroundColor: line.color, color: line.textColor }}
            >
              {line.shortName}
            </Badge>
          ))}
          {station.isInterchange && (
            <Badge variant="outline">Interchange</Badge>
          )}
        </div>
        <h1 className="text-3xl font-bold">
          {language === "th" ? station.nameTh : station.nameEn}
        </h1>
        {station.codes.length > 0 && (
          <p className="text-muted-foreground text-lg">{station.codes.join(", ")}</p>
        )}
      </section>

      {alerts.length > 0 && (
        <Card className="border-l-4 border-l-yellow-500">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              {t("serviceAlerts")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {alerts.map((alert) => (
              <div key={alert.id} className="text-sm">
                <div className="font-medium">
                  {language === "th" ? alert.titleTh : alert.titleEn}
                </div>
                <div className="text-muted-foreground">
                  {language === "th" ? alert.descriptionTh : alert.descriptionEn}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {btsCode && <StationArrivals stationCode={btsCode} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href={`/route?from=${encodeURIComponent(station.nameEn)}`}>
          <Card className="hover:bg-accent transition-colors h-full">
            <CardContent className="p-4 flex items-center gap-3">
              <Train className="h-5 w-5 text-primary" />
              <div>
                <div className="font-medium">{t("planRoute")} from here</div>
                <div className="text-xs text-muted-foreground">Find best route</div>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href={`/route?to=${encodeURIComponent(station.nameEn)}`}>
          <Card className="hover:bg-accent transition-colors h-full">
            <CardContent className="p-4 flex items-center gap-3">
              <Train className="h-5 w-5 text-primary" />
              <div>
                <div className="font-medium">{t("planRoute")} to here</div>
                <div className="text-xs text-muted-foreground">Find best route</div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {stationTimetables.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Train className="h-4 w-4" />
              {t("firstTrain")} / {t("lastTrain")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {stationTimetables.map((tt) => {
              const line = lineMap.get(tt.lineId);
              const first = tt.firstTrain.find((ft) => ft.stationId === station.id);
              const last  = tt.lastTrain.find((lt) => lt.stationId === station.id);
              return (
                <div key={tt.lineId} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {line && (
                      <Badge style={{ backgroundColor: line.color, color: line.textColor }}>
                        {line.shortName}
                      </Badge>
                    )}
                    <span className="text-muted-foreground">{tt.direction}</span>
                  </div>
                  <div className="font-mono">
                    {first?.time ?? "--:--"} — {last?.time ?? "--:--"}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {facility && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("facilities")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Object.entries(facility).map(([key, value]) => {
                if (key === "stationId" || value === false || value === 0) return null;
                const Icon = facilityIcons[key] || Info;
                return (
                  <div key={key} className="flex items-center gap-2 text-sm">
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span>
                      {t(key as TranslationKey)}
                      {typeof value === "number" ? `: ${value}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {exits && exits.exits.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("exit")} Guide</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {exits.exits.map((exit) => (
              <div key={exit.number} className="border-b last:border-0 pb-3 last:pb-0">
                <div className="font-medium">Exit {exit.number}</div>
                <div className="text-sm text-muted-foreground">
                  {(language === "th" ? exit.landmarksTh : exit.landmarksEn)?.join(" · ") || "—"}
                </div>
                {exit.busRoutes && exit.busRoutes.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Bus: {exit.busRoutes.join(", ")}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {parking && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Car className="h-4 w-4" />
              {t("parking")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Available</span>
              <span>{parking.available ? "Yes" : "No"}</span>
            </div>
            {parking.capacity && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Capacity</span>
                <span>{parking.capacity}</span>
              </div>
            )}
            {parking.costPerDay && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Daily cost</span>
                <span>{parking.costPerDay} THB</span>
              </div>
            )}
            {parking.openingHours && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Hours</span>
                <span>{parking.openingHours}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {places.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("nearbyPlaces")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {places.slice(0, 8).map((place) => (
              <Link
                key={place.id}
                href={`/route?to=${encodeURIComponent(place.nameEn)}`}
                className="flex items-center justify-between text-sm hover:bg-accent p-2 rounded-md transition-colors"
              >
                <div>
                  <div className="font-medium">
                    {language === "th" ? place.nameTh : place.nameEn}
                  </div>
                  <div className="text-xs text-muted-foreground capitalize">{place.category}</div>
                </div>
                {place.walkingMinutes && (
                  <div className="text-xs text-muted-foreground">{place.walkingMinutes} min {t("walking")}</div>
                )}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
