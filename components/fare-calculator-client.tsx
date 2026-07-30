"use client";

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/components/language-provider";
import { findRoutes, resolveNameToStationId } from "@/lib/routing";
import type { Station, Line, BoatRoute, BusRoute, Place } from "@/data/schemas";
import { ArrowRight, Banknote, CreditCard, Smartphone, Ticket } from "lucide-react";

interface FareCalculatorClientProps {
  initialData: {
    stations: Station[];
    lines: Line[];
    boatRoutes: BoatRoute[];
    busRoutes: BusRoute[];
    places: Place[];
  };
}

export function FareCalculatorClient({ initialData }: FareCalculatorClientProps) {
  const { stations, lines, boatRoutes, busRoutes, places } = initialData;
  const { t, language } = useLanguage();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState<ReturnType<typeof findRoutes> | null>(null);

  const lineMap = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);

  const handleCalculate = () => {
    const fromId = resolveNameToStationId(from, stations, places);
    const toId = resolveNameToStationId(to, stations, places);
    if (!fromId || !toId) {
      setResult([]);
      return;
    }
    setResult(findRoutes(stations, lines, boatRoutes, busRoutes, fromId, toId));
  };

  const ticketTypes = [
    { key: "single", label: "Single ticket", icon: Ticket, supported: true },
    { key: "rabbit", label: "Rabbit Card", icon: CreditCard, supported: true },
    { key: "emv", label: "EMV / Contactless", icon: CreditCard, supported: false },
    { key: "mrt_card", label: "MRT Card", icon: CreditCard, supported: false },
    { key: "tourist_pass", label: "Tourist Pass", icon: Ticket, supported: true },
    { key: "day_pass", label: "Day Pass", icon: Ticket, supported: true },
  ];

  const bestRoute = result?.[0];

  return (
    <div className="container max-w-3xl px-4 py-6 space-y-6">
      <section>
        <h1 className="text-2xl font-bold tracking-tight">{t("fares")}</h1>
        <p className="text-muted-foreground">Calculate fare and compare ticket options.</p>
      </section>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto]">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{t("from")}</label>
              <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder={t("search")} list="fare-from" />
            </div>
            <div className="hidden sm:flex items-end justify-center">
              <ArrowRight className="h-5 w-5 text-muted-foreground mb-2" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{t("to")}</label>
              <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder={t("search")} list="fare-to" />
            </div>
            <div className="flex items-end">
              <Button onClick={handleCalculate} className="w-full sm:w-auto">
                {t("fare")}
              </Button>
            </div>
          </div>
          <datalist id="fare-from">
            {stations.map((s) => (
              <option key={s.id} value={s.nameEn} />
            ))}
          </datalist>
          <datalist id="fare-to">
            {stations.map((s) => (
              <option key={s.id} value={s.nameEn} />
            ))}
          </datalist>
        </CardContent>
      </Card>

      {bestRoute && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Banknote className="h-4 w-4" />
              Estimated fare
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-3xl font-bold">
              {bestRoute.totalFare} <span className="text-base font-normal text-muted-foreground">{t("baht")}</span>
            </div>
            <div className="text-sm text-muted-foreground">
              {Math.round(bestRoute.totalTimeSeconds / 60)} minutes ·{" "}
              {bestRoute.transfers === 0 ? "Direct" : `${bestRoute.transfers} transfers`}
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Ticket options</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ticketTypes.map((tt) => {
                  const Icon = tt.icon;
                  const price = tt.key === "single" ? bestRoute.totalFare : Math.round(bestRoute.totalFare * 0.95);
                  return (
                    <div
                      key={tt.key}
                      className={`flex items-center justify-between rounded-md border p-3 ${
                        tt.supported ? "" : "opacity-50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{tt.label}</span>
                      </div>
                      <span className="text-sm">{tt.supported ? `${price} THB` : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {result && result.length === 0 && (
        <div className="text-center text-muted-foreground py-8">No route found.</div>
      )}
    </div>
  );
}
