"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Accessibility,
  ArrowLeft,
  ArrowUpDown,
  Building2,
  Bus,
  Church,
  DoorOpen,
  ExternalLink,
  GraduationCap,
  Hospital,
  Landmark,
  MapPin,
  ShoppingBag,
  Ship,
  Store,
  Toilet,
  Trees,
  type LucideIcon,
} from "lucide-react";
import { stations, type Station } from "@/data/stations";
import { StationActions } from "@/components/StationActions";
import { LinePill, TransferIcon } from "@/components/TransitBadges";
import { fetchStationDetails, type PlaceKind, type StationDetails } from "@/lib/station-details";
import { haversineMeters } from "@/lib/line-geometry";
import { distanceLabel } from "@/lib/format-distance";
import { LINE_COLORS, readableTextColor } from "@/lib/line-colors";
import { stationName, useT, type Lang } from "@/lib/i18n";

// Mirrors lib/transit-graph.ts's walking-transfer distance, so the stations
// listed under Connections are exactly the ones routes will walk to.
const WALK_CONNECTION_METERS = 400;

const PLACE_ICONS: Record<PlaceKind, LucideIcon> = {
  mall: ShoppingBag,
  attraction: Landmark,
  museum: Building2,
  hospital: Hospital,
  university: GraduationCap,
  market: Store,
  park: Trees,
  temple: Church,
  pier: Ship,
  landmark: Landmark,
};

function formatOpened(opened: string, lang: Lang): string {
  const [y, m, d] = opened.split("-").map(Number);
  if (!m) return lang === "th" ? String(y + 543) : String(y);
  return new Date(Date.UTC(y, m - 1, d || 1)).toLocaleDateString(lang === "th" ? "th-TH" : "en-GB", {
    year: "numeric",
    month: "long",
    ...(d ? { day: "numeric" } : {}),
    timeZone: "UTC",
  });
}

function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <section className="border-t border-neutral-200 px-4 py-4 dark:border-neutral-800">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        <Icon size={18} className="text-neutral-500" />
        {title}
      </h2>
      {children}
    </section>
  );
}

export interface StationDetailProps {
  station: Station;
  startCode: string | null;
  destinationCode: string | null;
  onSetStart: (station: Station) => void;
  onSetDestination: (station: Station) => void;
  onOpenStation: (station: Station) => void;
  onClose: () => void;
}

/**
 * A station's own full-screen page: photos, lines, live times, exits,
 * accessibility, connections and what's nearby. The extras come from
 * public/station-details/<code>.json (see lib/station-details.ts); anything
 * a station has no data for is simply left out.
 */
export function StationDetail({
  station,
  startCode,
  destinationCode,
  onSetStart,
  onSetDestination,
  onOpenStation,
  onClose,
}: StationDetailProps) {
  const { lang, t } = useT();
  const [loaded, setLoaded] = useState<{ code: string; details: StationDetails | null } | null>(null);
  const details = loaded?.code === station.code ? loaded.details : undefined;

  useEffect(() => {
    let cancelled = false;
    fetchStationDetails(station.code).then((d) => {
      if (!cancelled) setLoaded({ code: station.code, details: d });
    });
    return () => {
      cancelled = true;
    };
  }, [station.code]);

  // Close on Escape, like any other overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const walkConnections = useMemo(
    () =>
      stations
        .filter(
          (s) =>
            s.code !== station.code &&
            !s.lines.some((l) => station.lines.some((m) => m.line === l.line)) &&
            haversineMeters([station.lat, station.lon], [s.lat, s.lon]) <= WALK_CONNECTION_METERS,
        )
        .map((s) => ({ station: s, meters: haversineMeters([station.lat, station.lon], [s.lat, s.lon]) }))
        .sort((a, b) => a.meters - b.meters),
    [station],
  );

  const color = LINE_COLORS[station.lines[0]?.line] ?? "#666";
  const otherName = lang === "th" ? station.nameEn : station.nameTh;
  const summary = details?.summary?.[lang] ?? details?.summary?.[lang === "th" ? "en" : "th"];
  const wikiTitle = details?.wikipedia?.[lang] ?? details?.wikipedia?.en ?? details?.wikipedia?.th;
  const wikiLang = details?.wikipedia?.[lang] ? lang : details?.wikipedia?.en ? "en" : "th";
  const hasAccessibility =
    details &&
    (details.wheelchair || details.elevators > 0 || details.toilets !== undefined || details.accessibleToilet);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={stationName(station, lang)}
      className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-white dark:bg-neutral-950"
    >
      <div className="flex items-center gap-2 border-b border-neutral-200 px-2 py-2 dark:border-neutral-800">
        <button
          onClick={onClose}
          aria-label={t.back}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          <ArrowLeft size={24} />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{stationName(station, lang)}</h1>
      </div>

      <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {details && details.photos.length > 0 && (
          <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pt-4" aria-label="Photos">
            {details.photos.map((photo) => (
              <figure key={photo.page} className="w-[85%] max-w-md shrink-0 snap-center">
                {/* Plain <img>: a static export has no image optimizer, and these are already Commons thumbnails. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.thumb}
                  alt=""
                  loading="lazy"
                  className="aspect-[4/3] w-full rounded-xl bg-neutral-100 object-cover dark:bg-neutral-800"
                />
                <figcaption className="mt-1 truncate text-[11px] text-neutral-500">
                  <a href={photo.page} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {t.photoCredit}: {photo.author ?? "Wikimedia Commons"}
                    {photo.license ? ` · ${photo.license}` : ""}
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        <div className="px-4 pt-4 pb-4">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 shrink-0 rounded-md px-2 py-1 text-sm font-bold"
              style={{ backgroundColor: color, color: readableTextColor(color) }}
            >
              {station.code}
            </span>
            <div className="min-w-0">
              <p className="text-xl leading-tight font-bold">{stationName(station, lang)}</p>
              {otherName && otherName !== stationName(station, lang) && (
                <p className="text-sm text-neutral-500">{otherName}</p>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {station.lines.length > 1 && <TransferIcon size={22} />}
            {station.lines.map((l) => (
              <LinePill key={l.line} line={l.line} />
            ))}
          </div>
          {details?.opened && (
            <p className="mt-2 text-xs text-neutral-500">{t.opened(formatOpened(details.opened, lang))}</p>
          )}
          {summary && <p className="mt-3 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">{summary}</p>}

          <div className="mt-4">
            <StationActions
              station={station}
              startCode={startCode}
              destinationCode={destinationCode}
              onSetStart={onSetStart}
              onSetDestination={onSetDestination}
            />
          </div>
        </div>

        {(walkConnections.length > 0 || (details?.busStops ?? 0) > 0) && (
          <Section title={t.connections} icon={ArrowUpDown}>
            <ul className="flex flex-col gap-2">
              {walkConnections.map(({ station: s, meters }) => (
                <li key={s.code} className="flex flex-wrap items-center gap-1.5 text-sm">
                  <TransferIcon walk size={20} />
                  <button onClick={() => onOpenStation(s)} className="font-medium hover:underline">
                    {t.walkToStation(stationName(s, lang), distanceLabel(meters))}
                  </button>
                  {s.lines.map((l) => (
                    <LinePill key={l.line} line={l.line} short />
                  ))}
                </li>
              ))}
              {details && details.busStops > 0 && (
                <li className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                  <Bus size={18} className="text-neutral-500" />
                  {t.busStops(details.busStops)}
                </li>
              )}
            </ul>
          </Section>
        )}

        {details && (details.exits.length > 0 || details.unlabeledExits > 0) && (
          <Section title={t.exits} icon={DoorOpen}>
            {details.exits.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {details.exits.map((exit) => (
                  <span
                    key={exit.label}
                    title={exit.elevator ? t.liftExit : undefined}
                    className="inline-flex min-w-9 items-center justify-center gap-1 rounded-md border-2 border-amber-400 bg-amber-300 px-2 py-1 text-sm font-bold text-neutral-900"
                  >
                    {exit.label}
                    {exit.elevator && <Accessibility size={14} aria-label={t.liftExit} />}
                  </span>
                ))}
                {details.unlabeledExits > 0 && (
                  <span className="self-center text-xs text-neutral-500">{t.moreUnnumbered(details.unlabeledExits)}</span>
                )}
              </div>
            ) : (
              <p className="text-sm text-neutral-700 dark:text-neutral-300">{t.exitCount(details.unlabeledExits)}</p>
            )}
          </Section>
        )}

        {hasAccessibility && (
          <Section title={t.accessibility} icon={Accessibility}>
            <ul className="flex flex-col gap-1.5 text-sm text-neutral-700 dark:text-neutral-300">
              {details.wheelchair && (
                <li>
                  {details.wheelchair === "yes"
                    ? `✓ ${t.wheelchairYes}`
                    : details.wheelchair === "limited"
                      ? `◐ ${t.wheelchairLimited}`
                      : `✕ ${t.wheelchairNo}`}
                </li>
              )}
              {details.elevators > 0 && <li>✓ {t.lifts(details.elevators)}</li>}
              {details.toilets !== undefined && (
                <li className="flex items-center gap-1.5">
                  <Toilet size={16} className="text-neutral-500" />
                  {details.toilets ? t.toiletsYes : t.toiletsNo}
                </li>
              )}
              {details.accessibleToilet && <li>✓ {t.accessibleToilet}</li>}
            </ul>
          </Section>
        )}

        {details && details.nearby.length > 0 && (
          <Section title={t.nearby} icon={MapPin}>
            <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
              {details.nearby.map((place) => {
                const Icon = PLACE_ICONS[place.kind] ?? MapPin;
                return (
                  <li key={`${place.nameEn}-${place.lat}`}>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 py-2"
                    >
                      <Icon size={18} className="shrink-0 text-neutral-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {lang === "th" ? place.nameTh : place.nameEn}
                        </span>
                        <span className="block text-xs text-neutral-500">{t.placeKinds[place.kind]}</span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-neutral-500">{distanceLabel(place.meters)}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {details === null && (
          <p className="border-t border-neutral-200 px-4 py-4 text-sm text-neutral-500 dark:border-neutral-800">
            {t.noDetails}
          </p>
        )}
        {details === undefined && (
          <p className="border-t border-neutral-200 px-4 py-4 text-sm text-neutral-500 dark:border-neutral-800">
            {t.loadingDetails}
          </p>
        )}

        <div className="flex flex-wrap gap-2 border-t border-neutral-200 px-4 py-4 dark:border-neutral-800">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${station.lat},${station.lon}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            <MapPin size={16} />
            {t.openInMaps}
          </a>
          {wikiTitle && (
            <a
              href={`https://${wikiLang}.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replace(/ /g, "_"))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              <ExternalLink size={16} />
              {t.readMore}
            </a>
          )}
        </div>

        <p className="px-4 pb-6 text-[11px] text-neutral-400">{t.sources}</p>
      </div>
    </div>
  );
}
