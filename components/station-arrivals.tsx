"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Train, WifiOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/components/language-provider";

interface Platform {
  platform: string;
  line_color: string;
  direction: string;
  trains: unknown[];
}

interface TopmileArrivals {
  platforms: Platform[];
  service_active: boolean;
  next_service: string;
}

interface CachedArrivals extends TopmileArrivals {
  fetchedAt: number;
}

interface StationArrivalsProps {
  stationCode: string;
}

// No backend, no server cost — the browser calls the (CORS-open) topmile API
// directly and caches the last-known result in localStorage. There are no
// expected concurrent users, so there's nothing to dedupe against and no
// point running anything server-side or on a schedule when nobody's looking.
const REFRESH_MS = 60_000;
const STORAGE_PREFIX = "bts-arrivals:";

function readCache(code: string): CachedArrivals | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + code);
    return raw ? (JSON.parse(raw) as CachedArrivals) : null;
  } catch {
    return null;
  }
}

function writeCache(code: string, data: CachedArrivals) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + code, JSON.stringify(data));
  } catch {
    // localStorage unavailable (private mode, quota) — not fatal, just skip persisting
  }
}

function timeAgo(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

export function StationArrivals({ stationCode }: StationArrivalsProps) {
  const { t } = useLanguage();
  // Seed from localStorage synchronously so the panel never shows a loading state.
  const [data, setData] = useState<CachedArrivals | null>(() => readCache(stationCode));
  const [offline, setOffline] = useState(false);
  const [, forceTick] = useState(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`https://bts-api.topmile.com/arrivals/${stationCode}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const payload = (await res.json()) as TopmileArrivals;
      if (!mounted.current) return;
      const cached: CachedArrivals = { ...payload, fetchedAt: Date.now() };
      setData(cached);
      setOffline(false);
      writeCache(stationCode, cached);
    } catch {
      if (!mounted.current) return;
      setOffline(true);
    }
  }, [stationCode]);

  useEffect(() => {
    mounted.current = true;
    // fetch-on-mount + poll is the intended behavior here (live data from an
    // external API), guarded by the `mounted` ref against setState after unmount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const interval = setInterval(refresh, REFRESH_MS);
    // Re-render every 10s just to keep the "updated Xs ago" label current.
    const tick = setInterval(() => forceTick((n) => n + 1), 10_000);
    return () => {
      mounted.current = false;
      clearInterval(interval);
      clearInterval(tick);
    };
  }, [refresh]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Train className="h-4 w-4" />
          {t("liveArrivals")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {offline && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <WifiOff className="h-3 w-3" />
            {t("showingLastKnown")}
          </div>
        )}

        {!data && !offline && (
          <div className="text-sm text-muted-foreground">{t("noTrainsScheduled")}</div>
        )}

        {data && (
          <>
            {!data.service_active && (
              <div className="text-sm text-muted-foreground">
                {t("noTrainsScheduled")} · {data.next_service}
              </div>
            )}
            {data.platforms.map((platform) => (
              <div
                key={platform.platform}
                className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: platform.line_color }}
                  />
                  <span className="text-muted-foreground">{platform.direction}</span>
                </div>
                <div className="font-mono text-xs">
                  {platform.trains.length > 0
                    ? `${platform.trains.length} incoming`
                    : "—"}
                </div>
              </div>
            ))}
            <div className="text-[11px] text-muted-foreground pt-1">
              {t("updatedAgo").replace("{time}", timeAgo(data.fetchedAt))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
