"use client";

import Link from "next/link";
import { MapPin, ArrowRight, Palmtree, ShoppingBag, TreePine, Camera } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/components/language-provider";
import type { Place, Station, Line } from "@/data/schemas";

interface TouristClientProps {
  places: { place: Place; station?: Station }[];
  lines: Line[];
}

const categoryIcons: Record<string, React.ElementType> = {
  tourist_attraction: Camera,
  shopping: ShoppingBag,
  park: TreePine,
};

export function TouristClient({ places, lines }: TouristClientProps) {
  const { t, language } = useLanguage();
  const lineMap = new Map(lines.map((l) => [l.id, l]));

  return (
    <div className="container max-w-3xl px-4 py-6 space-y-6">
      <section>
        <h1 className="text-2xl font-bold tracking-tight">{t("touristMode")}</h1>
        <p className="text-muted-foreground">One-tap navigation to Bangkok’s top spots.</p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        {places.map(({ place, station }) => {
          const Icon = categoryIcons[place.category] || Palmtree;
          return (
            <Link
              key={place.id}
              href={station ? `/route?to=${encodeURIComponent(place.nameEn)}` : "#"}
              className={station ? "" : "pointer-events-none opacity-60"}
            >
              <Card className="hover:bg-accent transition-colors h-full">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{language === "th" ? place.nameTh : place.nameEn}</CardTitle>
                    <Icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {station && (
                    <>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4" />
                        {language === "th" ? station.nameTh : station.nameEn}
                        {place.walkingMinutes && <span>· {place.walkingMinutes} min walk</span>}
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
                      <div className="text-xs text-primary font-medium flex items-center gap-1 pt-1">
                        Plan route <ArrowRight className="h-3 w-3" />
                      </div>
                    </>
                  )}
                  {!station && (
                    <div className="text-sm text-muted-foreground">No nearby station data</div>
                  )}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
