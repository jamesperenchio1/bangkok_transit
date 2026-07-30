"use client";

import { useState, useMemo, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useLanguage } from "@/components/language-provider";
import { findRoutes, resolveNameToStationId, type RouteOption, type RouteSegment } from "@/lib/routing";
import type { Station, Line, BoatRoute, BusRoute, Place } from "@/data/schemas";
import { Clock, Banknote, ArrowRight, Train, Footprints, Sailboat, Bus } from "lucide-react";

interface RoutePlannerClientProps {
  initialData: {
    stations: Station[];
    lines: Line[];
    boatRoutes: BoatRoute[];
    busRoutes: BusRoute[];
    places: Place[];
  };
  initialFrom: string;
  initialTo: string;
}

const segmentIcons: Record<string, React.ElementType> = {
  rail: Train,
  walk: Footprints,
  boat: Sailboat,
  bus: Bus,
};

export function RoutePlannerClient({
  initialData,
  initialFrom,
  initialTo,
}: RoutePlannerClientProps) {
  const { stations, lines, boatRoutes, busRoutes, places } = initialData;
  const { t, language } = useLanguage();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [routes, setRoutes] = useState<RouteOption[]>([]);

  useEffect(() => {
    if (initialFrom && initialTo) {
      handleSearch();
    }
  }, []);

  const lineMap = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);

  const handleSearch = () => {
    const fromId = resolveNameToStationId(from, stations, places);
    const toId = resolveNameToStationId(to, stations, places);
    if (!fromId || !toId) {
      setRoutes([]);
      return;
    }
    const found = findRoutes(stations, lines, boatRoutes, busRoutes, fromId, toId);
    setRoutes(found);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} ${t("minutes")}`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  };

  return (
    <div className="container max-w-3xl px-4 py-6 space-y-6">
      <section>
        <h1 className="text-2xl font-bold tracking-tight">{t("planRoute")}</h1>
      </section>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto]">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{t("from")}</label>
              <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder={t("search")} list="route-from" />
            </div>
            <div className="hidden sm:flex items-end justify-center">
              <ArrowRight className="h-5 w-5 text-muted-foreground mb-2" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{t("to")}</label>
              <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder={t("search")} list="route-to" />
            </div>
            <div className="flex items-end">
              <Button onClick={handleSearch} className="w-full sm:w-auto">
                {t("planRoute")}
              </Button>
            </div>
          </div>
          <datalist id="route-from">
            {stations.map((s) => (
              <option key={s.id} value={s.nameEn} />
            ))}
          </datalist>
          <datalist id="route-to">
            {stations.map((s) => (
              <option key={s.id} value={s.nameEn} />
            ))}
          </datalist>
        </CardContent>
      </Card>

      {routes.length > 0 && (
        <Tabs defaultValue={routes[0].type} className="w-full">
          <TabsList className="grid grid-cols-3">
            {routes.map((r) => (
              <TabsTrigger key={r.type} value={r.type}>
                {t(r.type)}
              </TabsTrigger>
            ))}
          </TabsList>
          {routes.map((route) => (
            <TabsContent key={route.type} value={route.type}>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      {formatTime(route.totalTimeSeconds)}
                    </CardTitle>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="flex items-center gap-1">
                        <Banknote className="h-4 w-4" />
                        {route.totalFare} {t("baht")}
                      </span>
                      <Badge variant="secondary">
                        {route.transfers === 0 ? t("noTransfers") : `${route.transfers} ${t("transfers")}`}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {route.segments.map((seg, idx) => (
                    <RouteSegmentView key={idx} segment={seg} lineMap={lineMap} />
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}

      {routes.length === 0 && from && to && (
        <div className="text-center text-muted-foreground py-8">
          No route found. Try different station names.
        </div>
      )}
    </div>
  );
}

function RouteSegmentView({
  segment,
  lineMap,
}: {
  segment: RouteSegment;
  lineMap: Map<string, Line>;
}) {
  const { language } = useLanguage();
  const Icon = segmentIcons[segment.mode] || Train;
  const line = segment.lineId ? lineMap.get(segment.lineId) : undefined;

  return (
    <div className="flex items-start gap-3">
      <div
        className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: line?.color || "#666" }}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between">
          <div className="font-medium">
            {language === "th" ? segment.fromNameTh : segment.fromNameEn}
            {" → "}
            {language === "th" ? segment.toNameTh : segment.toNameEn}
          </div>
          <div className="text-xs text-muted-foreground">
            {Math.round(segment.timeSeconds / 60)} min
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {line && (
            <Badge style={{ backgroundColor: line.color, color: line.textColor }}>
              {line.shortName}
            </Badge>
          )}
          {segment.mode === "boat" && <Badge>Boat</Badge>}
          {segment.mode === "bus" && <Badge>Bus {segment.routeId}</Badge>}
          {segment.mode === "walk" && <Badge variant="outline">Walk</Badge>}
          <span>{Math.round(segment.distance)} m</span>
        </div>
      </div>
    </div>
  );
}
