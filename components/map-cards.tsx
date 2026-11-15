"use client";

import { shownCode, type Station } from "@/data/stations";
import { StationActions } from "@/components/StationActions";
import { GooglePlaceMap } from "@/components/GooglePlaceMap";
import { LINE_COLORS, LINE_NAMES, readableTextColor } from "@/lib/line-colors";
import { stationName, useT } from "@/lib/i18n";
import { stationLineColor } from "@/lib/map-data";
import { distanceLabel } from "@/lib/nearest-station";
import { chooseStationForPlace } from "@/lib/place-station";
import type { Place } from "@/lib/google-places";
import type { PathOptions } from "@/lib/transit-graph";
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
  /** Compared when a place card decides which station to route through. */
  pathOptions?: PathOptions;
  /** A place card passes its place along, so the route ends with the walk to it. */
  onSetStart: (station: Station, place?: Place) => void;
  onSetDestination: (station: Station, place?: Place) => void;
}

// Its own component so the name re-renders when the language changes - a card
// is a separate React root that only re-renders on demand otherwise.
function CardStationName({ station }: { station: Station }) {
  const { lang } = useT();
  return (
    <span className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">
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
      <StationLines station={station} />
      <StationActions station={station} {...route} />
    </div>
  );
}

/** Every line that stops here, by name and colour, so an interchange reads as one at a glance. */
function StationLines({ station }: { station: Station }) {
  const { t } = useT();
  const lines = [...new Set(station.lines.map((l) => l.line))];
  return (
    // A labelled group, not a list: the card's only <ul>/listitems are the
    // arrivals, and the e2e suite counts them.
    <div role="group" className="flex flex-wrap gap-1.5" aria-label={t.linesAtStation}>
      {lines.map((line) => (
        <span
          key={line}
          className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: LINE_COLORS[line] }} aria-hidden="true" />
          {LINE_NAMES[line]}
        </span>
      ))}
    </div>
  );
}

export function PlaceCard({ place, ...route }: { place: Place } & CardRouteState) {
  const { lang, t } = useT();
  // The station that gets there soonest, not the one nearest as the crow
  // flies: see lib/place-station.ts.
  const { station, meters } = chooseStationForPlace(route.startCode, place, route.pathOptions);
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
        {route.startCode ? t.placeStation : t.placeNearest}:
        <span
          className="shrink-0 rounded px-1.5 py-0.5 font-semibold"
          style={{ backgroundColor: color, color: readableTextColor(color) }}
        >
          {shownCode(station)}
        </span>
        <span lang={lang}>{stationName(station, lang)}</span>
        <span>· {t.placeAway(distanceLabel(meters))}</span>
      </p>
      <StationActions
        station={station}
        startCode={route.startCode}
        destinationCode={route.destinationCode}
        onSetStart={(s) => route.onSetStart(s, place)}
        onSetDestination={(s) => route.onSetDestination(s, place)}
      />
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
