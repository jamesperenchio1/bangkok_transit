"use client";

import { shownCode, type Station } from "@/data/stations";
import { StationActions } from "@/components/StationActions";
import { GooglePlaceMap } from "@/components/GooglePlaceMap";
import { readableTextColor } from "@/lib/line-colors";
import { stationName, useT } from "@/lib/i18n";
import { stationLineColor } from "@/lib/map-data";
import { distanceLabel, nearestStation } from "@/lib/nearest-station";
import type { Place } from "@/lib/google-places";
import type { TrainDescription } from "@/lib/train-model";

/**
 * The cards both maps open - a station, a picked place, a live train. They are
 * plain React with no map library in sight; MapLibre mounts them in a Popup
 * and Google in an InfoWindow, each as its own React root (which is why the
 * language lives in a Zustand store and not in context).
 */

export interface CardRouteState {
  startCode: string | null;
  destinationCode: string | null;
  onSetStart: (station: Station) => void;
  onSetDestination: (station: Station) => void;
}

// Its own component so the name re-renders when the language changes - a card
// is a separate React root that only re-renders on demand otherwise.
function CardStationName({ station }: { station: Station }) {
  const { lang } = useT();
  return (
    <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
      {stationName(station, lang)}
    </span>
  );
}

export function StationCard({ station, ...route }: { station: Station } & CardRouteState) {
  const color = stationLineColor(station);
  return (
    <div className="flex flex-col gap-2 py-0.5">
      <div className="flex items-center gap-2">
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold"
          style={{ backgroundColor: color, color: readableTextColor(color) }}
        >
          {shownCode(station)}
        </span>
        <CardStationName station={station} />
      </div>
      <StationActions station={station} {...route} />
    </div>
  );
}

export function PlaceCard({ place, ...route }: { place: Place } & CardRouteState) {
  const { lang, t } = useT();
  const { station, meters } = nearestStation(place.lat, place.lon);
  const color = stationLineColor(station);
  return (
    <div className="flex flex-col gap-2 py-0.5">
      <div className="pr-8">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{place.name}</p>
        {(place.kind || place.detail) && (
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            {[place.kind, place.detail].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <GooglePlaceMap place={place} />
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-700 dark:text-neutral-300">
        {t.placeNearest}:
        <span
          className="shrink-0 rounded px-1.5 py-0.5 font-semibold"
          style={{ backgroundColor: color, color: readableTextColor(color) }}
        >
          {shownCode(station)}
        </span>
        <span lang={lang}>{stationName(station, lang)}</span>
        <span>· {t.placeAway(distanceLabel(meters))}</span>
      </p>
      <StationActions station={station} {...route} />
    </div>
  );
}

/** A live train: its number, where it is heading and the next stop. The text comes from lib/train-model.ts. */
export function TrainCard({ trainNo, text }: { trainNo: string; text: TrainDescription }) {
  return (
    <div className="flex flex-col gap-0.5 py-0.5">
      <div className="flex items-center gap-2">
        {/* Neutral, like the train itself: the line is already clear from the track it's on. */}
        <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-xs font-semibold text-white dark:bg-neutral-200 dark:text-neutral-900">
          {trainNo}
        </span>
        <span className="text-sm font-semibold">{text.title}</span>
      </div>
      <div className="text-sm">{text.toward}</div>
      {text.next && <div className="text-xs text-neutral-600 dark:text-neutral-300">{text.next}</div>}
    </div>
  );
}
