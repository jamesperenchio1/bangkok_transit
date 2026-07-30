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
  info: { icon: Info, color: "bg-blue-500", label: "Info" },
  warning: { icon: AlertTriangle, color: "bg-yellow-500", label: "Warning" },
  critical: { icon: AlertTriangle, color: "bg-red-500", label: "Critical" },
};

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
          const config = severityConfig[alert.severity];
          const Icon = config.icon;
          return (
            <Card key={alert.id} className="border-l-4" style={{ borderLeftColor: config.color.replace("bg-", "") }}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-5 w-5 text-white rounded-full p-0.5 ${config.color}`} />
                    <CardTitle className="text-base">
                      {language === "th" ? alert.titleTh : alert.titleEn}
                    </CardTitle>
                  </div>
                  <Badge variant={alert.severity === "critical" ? "destructive" : "secondary"}>
                    {config.label}
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
