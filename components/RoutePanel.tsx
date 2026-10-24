"use client";

import { useEffect, useRef } from "react";
import { X, MapPin, ArrowRight } from "lucide-react";
import { useArrivals } from "@/lib/use-arrivals";
import {
  arrivalClockTime,
  minutesLabel,
  trainEtaMinutes,
  upcomingTrains,
  updatedAgoLabel,
} from "@/lib/format-eta";
import type { Station } from "@/data/stations";
import { terminusInDirection, type PathResult } from "@/lib/transit-graph";
import type { GeoPosition } from "@/lib/use-geolocation";
import { LINE_COLORS, LINE_NAMES } from "@/lib/line-colors";
import { stationName, useT } from "@/lib/i18n";
import { StopAlertControl } from "@/components/StopAlertControl";
import type { StopAlert } from "@/lib/use-stop-alert";

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
      <MapPin size={14} aria-hidden="true" />
      {t.googleMaps}
    </a>
  );
}

export type RoutePanelState = { mode: "route"; start: Station; destination: Station; path: PathResult | null };

export interface RoutePanelProps {
  state: RoutePanelState | null;
  userPosition: GeoPosition | null;
  stopAlert: StopAlert;
  onClose: () => void;
}

export function RoutePanel({ state, userPosition, stopAlert, onClose }: RoutePanelProps) {
  const open = state !== null;
  const { lang, t } = useT();
  const headingRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Latest onClose without re-running the focus effect on every parent render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // A non-modal dialog: on open, move focus to its heading so keyboard and
  // screen-reader users land on the route; on close, hand focus back to
  // whatever opened it. Escape closes.
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const target = returnFocusRef.current;
      if (target?.isConnected) target.focus();
    };
  }, [open]);

  const from = state ? stationName(state.start, lang) : "";
  const to = state ? stationName(state.destination, lang) : "";
  const summary = state?.path
    ? [t.stops(state.path.stops), t.changes(state.path.changes), t.aboutMinutes(state.path.minutes)].join(", ")
    : state
      ? t.noRoute
      : "";

  return (
    <>
    {/* Always mounted so assistive tech reliably announces the change. */}
    <p className="sr-only" role="status" lang={lang}>
      {state ? t.routeFound(from, to, summary) : ""}
    </p>
    <div
      role="dialog"
      aria-modal="false"
      aria-label={open ? t.routeDialog(from, to) : undefined}
      className={`fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-neutral-200 bg-white shadow-2xl transition-transform duration-200 dark:border-neutral-800 dark:bg-neutral-900 ${
        open ? "translate-y-0" : "translate-y-full"
      }`}
      style={{ maxHeight: "70vh" }}
      aria-hidden={!open}
    >
      {state?.mode === "route" && (
        <div className="flex max-h-[70vh] flex-col overflow-y-auto p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div ref={headingRef} tabIndex={-1} lang={lang} className="flex items-center gap-2 text-sm font-semibold outline-none">
              <span>{from}</span>
              <ArrowRight size={14} className="shrink-0 text-neutral-600 dark:text-neutral-400" aria-label={t.destination} role="img" />
              <span>{to}</span>
            </div>
            <button
              onClick={onClose}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              aria-label={t.close}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          {state.path && <RouteSummary path={state.path} />}

          <div className="mb-3">
            <GoogleMapsLink
              href={directionsUrl(userPosition ?? state.start, state.destination)}
            />
          </div>

          {state.path && <StopAlertControl alert={stopAlert} />}

          {!state.path && (
            <p className="py-4 text-center text-sm text-neutral-600 dark:text-neutral-400">
              {t.noRoute}
            </p>
          )}

          {state.path && (
            <ul className="flex flex-col">
              {state.path.legs.map((leg, i, legs) => {
                const isLast = i === legs.length - 1;
                const nextLeg = legs[i + 1];
                // Connector colors: the line ridden into this station, and out of it.
                // A walking transfer has no line, so it's drawn dashed and grey.
                const incomingColor = leg.mode === "ride" && leg.line ? LINE_COLORS[leg.line] : null;
                const outgoingColor = nextLeg?.mode === "ride" && nextLeg.line ? LINE_COLORS[nextLeg.line] : null;
                const dotColor = incomingColor ?? outgoingColor ?? LINE_COLORS[leg.station.lines[0].line];
                // For a change badge: the next line actually ridden, past any walk.
                const nextRide = legs.slice(i + 1).find((l) => l.mode === "ride");
                const nextLineColor = nextRide?.line ? LINE_COLORS[nextRide.line] : null;

                return (
                  <li key={`${leg.station.code}-${i}`} className="flex items-stretch gap-3">
                    <div className="relative w-4 shrink-0">
                      {i > 0 &&
                        (leg.mode === "walk" ? (
                          <span className="absolute top-0 left-1/2 h-1/2 -translate-x-1/2 border-l-2 border-dotted border-neutral-400" />
                        ) : (
                          incomingColor && (
                            <span
                              className="absolute top-0 left-1/2 h-1/2 w-0.5 -translate-x-1/2"
                              style={{ backgroundColor: incomingColor }}
                            />
                          )
                        ))}
                      {!isLast &&
                        (nextLeg.mode === "walk" ? (
                          <span className="absolute bottom-0 left-1/2 h-1/2 -translate-x-1/2 border-l-2 border-dotted border-neutral-400" />
                        ) : (
                          outgoingColor && (
                            <span
                              className="absolute bottom-0 left-1/2 h-1/2 w-0.5 -translate-x-1/2"
                              style={{ backgroundColor: outgoingColor }}
                            />
                          )
                        ))}
                      <span
                        className="absolute top-1/2 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-neutral-900"
                        style={{ backgroundColor: dotColor }}
                      />
                    </div>
                    <div className="flex-1 py-1.5">
                      <p className="flex items-center text-sm font-medium">
                        {stationName(leg.station, lang)}
                        {leg.isChange && (
                          <span className="ml-1.5 inline-flex items-center gap-1" title={t.changeLine}>
                            <span className="sr-only">
                              {nextRide?.line ? t.changeLineTo(LINE_NAMES[nextRide.line]) : t.changeLine}
                            </span>
                            <span
                              className="h-2.5 w-2.5 rounded-full ring-1 ring-white dark:ring-neutral-900"
                              style={{ backgroundColor: incomingColor ?? "#999" }}
                            />
                            <ArrowRight size={10} className="text-neutral-600 dark:text-neutral-400" aria-hidden="true" />
                            <span
                              className="h-2.5 w-2.5 rounded-full ring-1 ring-white dark:ring-neutral-900"
                              style={{ backgroundColor: nextLineColor ?? "#999" }}
                            />
                          </span>
                        )}
                      </p>
                      {leg.mode === "walk" && leg.walkMeters !== undefined && (
                        <p className="text-xs text-neutral-600 dark:text-neutral-400">{t.walked(leg.walkMeters)}</p>
                      )}
                      {leg.boardToward && (
                        <p className="text-xs text-neutral-600 dark:text-neutral-300">
                          {nextLeg?.line && (
                            // The line by name, so it never depends on colour alone.
                            <span lang="en" className="font-medium">{LINE_NAMES[nextLeg.line]} · </span>
                          )}
                          {t.boardToward(stationName(leg.boardToward, lang))}
                        </p>
                      )}
                      {leg.boardToward && leg.station.hasLiveArrivals && nextLeg?.line && (
                        // Live times for the platform this route boards from.
                        <LiveEta
                          station={leg.station}
                          directionKey={terminusInDirection(nextLeg.line, leg.station.code, nextLeg.station.code)}
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
  </>
  );
}

function RouteSummary({ path }: { path: PathResult }) {
  const { t } = useT();
  const parts = [t.stops(path.stops), t.changes(path.changes)];
  if (path.walkMeters > 0) parts.push(t.walk(path.walkMeters));
  parts.push(t.aboutMinutes(path.minutes));
  return <p className="-mt-2 mb-3 text-xs text-neutral-600 dark:text-neutral-300">{parts.join(" · ")}</p>;
}

function LiveEta({ station, directionKey }: { station: Station; directionKey?: string }) {
  const { data, live, now } = useArrivals(station.code);
  const { lang, t } = useT();
  if (!data) return null;
  // Last-known (not live) data is still shown, with its age, in amber.
  const age = live ? null : (
    <span className="text-amber-800 dark:text-amber-300"> · {t.lastKnown}, {updatedAgoLabel(data.timestamp, now, t)}</span>
  );
  if (!data.service_active) {
    // Upstream's next_service string already includes its own leading "~"
    // (e.g. "~05:30") - strip it before adding ours, or it doubles up.
    const nextService = data.next_service?.replace(/^~\s*/, "") ?? "?";
    return (
      <p className="text-xs text-neutral-600 dark:text-neutral-400">
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
  const clockTime = arrivalClockTime(data.timestamp, trainEtaMinutes(next.train), lang);
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
