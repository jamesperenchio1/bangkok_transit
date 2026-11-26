"use client";

import { useEffect } from "react";
import type { Station } from "@/data/stations";
import { startArrivalsPolling } from "@/lib/arrivals-store";
import {
  arrivalClockTime,
  minutesLabel,
  trainEtaMinutes,
  upcomingTrains,
  updatedAgoLabel,
} from "@/lib/format-eta";
import { useT, type Lang } from "@/lib/i18n";
import { useSettingsStore } from "@/lib/settings-store";
import { useArrivals } from "@/lib/use-arrivals";

function directionLabel(direction: string, lang: Lang): string {
  // Upstream joins both languages: "เคหะฯ  | Kheha" - keep the half matching
  // the UI language, like the station card does.
  const parts = direction.split("|");
  if (parts.length < 2) return direction.trim();
  return (lang === "th" ? parts[0] : parts[parts.length - 1]).trim();
}

/**
 * Live BTS arrivals on a station page. There is no per-page fetch: the widget
 * starts the one shared poll (idempotent, the map does the same) and then
 * reads the CDN-cached arrivals document through the store, so a page view
 * never reaches bts-api.topmile.com. The page is static, so this is the only
 * part that hydrates; before the first reading it says it is checking.
 */
export function StationArrivals({ station }: { station: Station }) {
  // Effects do not run during static export, so the server HTML is just the
  // "checking" line; the first poll starts after hydration.
  useEffect(() => {
    startArrivalsPolling();
  }, []);

  const { data, live, settled, now, upstreamDown, offline } = useArrivals(
    station.hasLiveArrivals ? station.code : null,
  );
  const { t, lang } = useT();
  const { showLiveTimes, upcomingCount } = useSettingsStore((s) => s.settings);

  if (!station.hasLiveArrivals || !showLiveTimes) return null;

  if (!data) {
    return (
      <section>
        <h2 className="mt-8 text-xl font-semibold">{t.liveArrivals}</h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {!settled ? t.checkingTimes : offline ? t.offlineTimes : upstreamDown ? t.sourceDown : t.timesUnavailable}
        </p>
      </section>
    );
  }

  // Last-known data stays up, counted down, with its age in amber: hiding it
  // would leave the page claiming nothing is known when something is.
  const updated = (
    <p
      className={`mt-2 text-xs ${
        live ? "text-neutral-600 dark:text-neutral-400" : "text-amber-800 dark:text-amber-300"
      }`}
    >
      {t.updated(updatedAgoLabel(data.timestamp, now, t))}
      {live ? "" : ` · ${offline ? t.offlineShort : upstreamDown ? t.sourceDownShort : t.lastKnown}`}
    </p>
  );

  const heading = <h2 className="mt-8 text-xl font-semibold">{t.liveArrivals}</h2>;

  if (!data.service_active) {
    // Upstream's own string already starts with "~"; strip it before adding ours.
    const nextService = data.next_service?.replace(/^~\s*/, "") ?? "?";
    return (
      <section>
        {heading}
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{t.notRunning(nextService)}</p>
        {updated}
      </section>
    );
  }

  const platforms = (data.platforms ?? [])
    .map((platform) => ({
      platform,
      trains: upcomingTrains(platform.trains, data.timestamp, now).slice(0, upcomingCount),
    }))
    .filter(({ trains }) => trains.length > 0);

  return (
    <section>
      {heading}
      {platforms.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {live ? t.noArrivals : t.waitingTimes}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {platforms.map(({ platform, trains }) => (
            <li key={platform.platform}>
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: platform.line_color }}
                />
                <span lang={lang}>→ {directionLabel(platform.direction, lang)}</span>
              </p>
              {platform.carried_from ? (
                <p className="pl-4 text-[11px] leading-tight text-amber-800 dark:text-amber-300">
                  {t.asOf(updatedAgoLabel(platform.carried_from, now, t))}
                </p>
              ) : null}
              <ul className="mt-0.5 flex flex-col gap-0.5 pl-4">
                {trains.map(({ train, left }, i) => {
                  const clockTime = arrivalClockTime(data.timestamp, trainEtaMinutes(train), lang);
                  const soon = left !== null && left <= 1;
                  return (
                    <li key={`${train.train_no}-${i}`} className="flex items-baseline gap-2 text-sm">
                      <span
                        className={`w-14 shrink-0 font-semibold tabular-nums ${
                          soon ? "text-green-700 dark:text-green-400" : ""
                        }`}
                      >
                        {minutesLabel(left, t)}
                      </span>
                      {clockTime ? (
                        <span className="shrink-0 text-xs tabular-nums text-neutral-600 dark:text-neutral-400">
                          {clockTime}
                        </span>
                      ) : null}
                      <span className="min-w-0 truncate text-xs text-neutral-600 dark:text-neutral-400">
                        {train.destination}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {updated}
    </section>
  );
}
