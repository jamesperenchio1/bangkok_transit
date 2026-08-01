"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/components/language-provider";
import type { Alert, Line } from "@/data/schemas";
import { AlertTriangle, Bell, Info } from "lucide-react";

interface AlertsClientProps {
  alertsWithLines: { alert: Alert; lines: Line[] }[];
}

const severityConfig = {
  info:     { icon: Info,          borderColor: "#3b82f6", badgeLabel: "Info" },
  warning:  { icon: AlertTriangle, borderColor: "#eab308", badgeLabel: "Warning" },
  critical: { icon: AlertTriangle, borderColor: "#ef4444", badgeLabel: "Critical" },
} as const;

export function AlertsClient({ alertsWithLines }: AlertsClientProps) {
  const { t, language } = useLanguage();

  return (
    <div className="container max-w-3xl px-4 py-6 space-y-6">
      <section>
        <h1 className="text-2xl font-bold tracking-tight">{t("serviceAlerts")}</h1>
        <p className="text-muted-foreground">Live service updates and disruptions.</p>
      </section>

      {alertsWithLines.length === 0 && (
        <Card>
          <CardContent className="p-6 flex items-center gap-3">
            <Bell className="h-5 w-5 text-muted-foreground" />
            <div className="text-muted-foreground">{t("noAlerts")}</div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {alertsWithLines.map(({ alert, lines }) => {
          const { icon: Icon, borderColor, badgeLabel } = severityConfig[alert.severity];
          return (
            <Card
              key={alert.id}
              className="border-l-4"
              style={{ borderLeftColor: borderColor }}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5" style={{ color: borderColor }} />
                    <CardTitle className="text-base">
                      {language === "th" ? alert.titleTh : alert.titleEn}
                    </CardTitle>
                  </div>
                  <Badge variant={alert.severity === "critical" ? "destructive" : "secondary"}>
                    {badgeLabel}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {lines.map((line) => (
                    <Badge
                      key={line.id}
                      style={{ backgroundColor: line.color, color: line.textColor }}
                      className="text-[10px]"
                    >
                      {line.shortName}
                    </Badge>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {language === "th" ? alert.descriptionTh : alert.descriptionEn}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Updated: {new Date(alert.updatedAt).toLocaleString()}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
