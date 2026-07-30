"use client";

import Link from "next/link";
import { MapPin, Car, Bike, Clock, DollarSign, Moon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/components/language-provider";
import type { Parking, Station, Line } from "@/data/schemas";

interface ParkingClientProps {
  parkingWithStations: { parking: Parking; station: Station }[];
  lines: Line[];
}

export function ParkingClient({ parkingWithStations, lines }: ParkingClientProps) {
  const { t, language } = useLanguage();
  const lineMap = new Map(lines.map((l) => [l.id, l]));

  return (
    <div className="container max-w-3xl px-4 py-6 space-y-6">
      <section>
        <h1 className="text-2xl font-bold tracking-tight">{t("parking")}</h1>
        <p className="text-muted-foreground">Park & Ride locations across the network.</p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        {parkingWithStations.map(({ parking, station }) => (
          <Link key={parking.stationId} href={`/station/${station.id}`}>
            <Card className="hover:bg-accent transition-colors h-full">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {language === "th" ? station.nameTh : station.nameEn}
                  </CardTitle>
                  <Car className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex flex-wrap gap-1">
                  {station.lineIds.map((lid) => {
                    const line = lineMap.get(lid);
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
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {parking.capacity && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    Capacity: {parking.capacity}
                  </div>
                )}
                {parking.costPerDay && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <DollarSign className="h-4 w-4" />
                    {parking.costPerDay} THB/day
                  </div>
                )}
                {parking.openingHours && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    {parking.openingHours}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  {parking.motorcycle && <Badge variant="outline">{t("motorcycleParking")}</Badge>}
                  {parking.bicycle && <Badge variant="outline">{t("bikeParking")}</Badge>}
                  {parking.overnightAllowed && (
                    <Badge variant="outline" className="flex items-center gap-1">
                      <Moon className="h-3 w-3" /> Overnight
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
