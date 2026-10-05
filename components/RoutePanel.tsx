"use client";

import { X, MapPin, ArrowRight } from "lucide-react";
import { useArrivals } from "@/lib/use-arrivals";
import { arrivalClockTime, minutesLabel, upcomingTrains, updatedAgoLabel } from "@/lib/format-eta";
import type { Station } from "@/data/stations";
import { terminusInDirection, type PathResult } from "@/lib/transit-graph";
import type { GeoPosition } from "@/lib/use-geolocation";
import { LINE_COLORS } from "@/lib/line-colors";
import { stationName, useT } from "@/lib/i18n";

function directionsUrl(
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number },
) {
  return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lon}&destination=${destination.lat},${destination.lon}&travelmode=transit`;
}

function GoogleMapsLink({ href }: { href: string }) {
  const { t } = useT();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex w-fit items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      <MapPin size={14} />
      {t.googleMaps}
    </a>
  );
}

export type RoutePanelState = { mode: "route"; start: Station; destination: Station; path: PathResult | null };

export interface RoutePanelProps {
  state: RoutePanelState | null;
  userPosition: GeoPosition | null;
  onClose: () => void;
}

export function RoutePanel({ state, userPosition, onClose }: RoutePanelProps) {
  const open = state !== null;
  const { lang, t } = useT();

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-neutral-200 bg-white shadow-2xl transition-transform duration-200 dark:border-neutral-800 dark:bg-neutral-900 ${
        open ? "translate-y-0" : "translate-y-full"
      }`}
      style={{ maxHeight: "70vh" }}
      aria-hidden={!open}
    >
      {state?.mode === "route" && (
        <div className="flex max-h-[70vh] flex-col overflow-y-auto p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span>{stationName(state.start, lang)}</span>
              <ArrowRight size={14} className="shrink-0 text-neutral-400" />
              <span>{stationName(state.destination, lang)}</span>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              aria-label={t.close}
            >
              <X size={20} />
            </button>
          </div>

          {state.path && <RouteSummary path={state.path} />}

          <div className="mb-3">
            <GoogleMapsLink
              href={directionsUrl(userPosition ?? state.start, state.destination)}
            />
          </div>

          {!state.path && (
            <p className="py-4 text-center text-sm text-neutral-500">
              {t.noRoute}
            </p>
          )}

          {state.path && (
            <ul className="flex flex-col">
              {state.path.map((leg, i) => {
                const isLast = i === state.path!.length - 1;
                const nextLeg = state.path![i + 1];
                const incomingColor = leg.line ? LINE_COLORS[leg.line] : null;
                const outgoingColor = nextLeg?.line ? LINE_COLORS[nextLeg.line] : null;
                const dotColor = incomingColor ?? outgoingColor ?? "#999";

                return (
                  <li key={leg.station.code} className="flex items-stretch gap-3">
                    <div className="relative w-4 shrink-0">
                      {incomingColor && (
                        <span
                          className="absolute top-0 left-1/2 h-1/2 w-0.5 -translate-x-1/2"
                          style={{ backgroundColor: incomingColor }}
                        />
                      )}
                      {!isLast && outgoingColor && (
                        <span
                          className="absolute bottom-0 left-1/2 h-1/2 w-0.5 -translate-x-1/2"
                          style={{ backgroundColor: outgoingColor }}
                        />
                      )}
                      <span
                        className="absolute top-1/2 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-neutral-900"
                        style={{ backgroundColor: dotColor }}
                      />
                    </div>
                    <div className="flex-1 py-1.5">
                      <p className="flex items-center text-sm font-medium">
                        {stationName(leg.station, lang)}
                        {leg.isTransfer && (
                          <span
                            className="ml-1.5 inline-flex items-center gap-1"
                            title={
                              leg.towardStation
                                ? t.changeLineToward(stationName(leg.towardStation, lang))
                                : t.changeLine
                            }
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-full ring-1 ring-white dark:ring-neutral-900"
                              style={{ backgroundColor: incomingColor ?? "#999" }}
                            />
                            <ArrowRight size={10} className="text-neutral-400" />
                            <span
                              className="h-2.5 w-2.5 rounded-full ring-1 ring-white dark:ring-neutral-900"
                              style={{ backgroundColor: outgoingColor ?? "#999" }}
                            />
                          </span>
                        )}
                      </p>
                      {leg.station.hasLiveArrivals && (isLast || i === 0) && (
                        <LiveEta
                          station={leg.station}
                          // The platform heading the way this route rides:
                          // out of the start, or into the destination.
                          directionKey={
                            i === 0
                              ? nextLeg?.line
                                ? terminusInDirection(nextLeg.line, leg.station.code, nextLeg.station.code)
                                : undefined
                              : leg.line
                                ? terminusInDirection(leg.line, state.path![i - 1].station.code, leg.station.code)
                                : undefined
                          }
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function RouteSummary({ path }: { path: PathResult }) {
  // A walking transfer between nearby stations is a graph edge too, labelled
  // with the line being walked to - which the station being walked from
  // doesn't serve. Only legs on a line the previous station serves are rides.
  const stops = path.filter(
    (leg, i) => i > 0 && leg.line !== null && path[i - 1].station.lines.some((l) => l.line === leg.line),
  ).length;
  const changes = path.filter((leg) => leg.isTransfer).length;
  const { t } = useT();
  return (
    <p className="-mt-2 mb-3 text-xs text-neutral-600 dark:text-neutral-300">
      {t.stops(stops)} · {t.changes(changes)}
    </p>
  );
}

function LiveEta({ station, directionKey }: { station: Station; directionKey?: string }) {
  const { data, live, now } = useArrivals(station.code);
  const { lang, t } = useT();
  if (!data) return null;
  // Last-known (not live) data is still shown, with its age, in amber.
  const age = live ? null : (
    <span className="text-amber-600 dark:text-amber-400"> · {t.lastKnown}, {updatedAgoLabel(data.timestamp, now, t)}</span>
  );
  if (!data.service_active) {
    // Upstream's next_service string already includes its own leading "~"
    // (e.g. "~05:30") - strip it before adding ours, or it doubles up.
    const nextService = data.next_service?.replace(/^~\s*/, "") ?? "?";
    return (
      <p className="text-xs text-neutral-500">
        {t.notRunning(nextService)}
        {age}
      </p>
    );
  }
  // Falls back to the first platform when the direction can't be matched
  // (e.g. a short-working train's platform reports a different terminus).
  const platform =
    data.platforms?.find((p) => directionKey && p.direction_key === directionKey) ?? data.platforms?.[0];
  const trains = upcomingTrains(platform?.trains ?? [], data.timestamp, now);
  const [next, ...upcoming] = trains;
  if (!next) return null;
  const clockTime = arrivalClockTime(data.timestamp, next.train.eta_precise ?? next.train.eta_minutes, lang);
  const laterMinutes = upcoming
    .slice(0, 2)
    .map(({ left }) => minutesLabel(left, t))
    .join(", ");
  return (
    <p className="text-xs text-neutral-600 dark:text-neutral-300">
      {t.nextArrival} {next.left !== null && next.left <= 0 ? "" : "~"}{minutesLabel(next.left, t)}
      {clockTime ? ` · ${clockTime}` : ""}
      {laterMinutes ? ` (${t.then} ~${laterMinutes})` : ""}
      {age}
    </p>
  );
}
