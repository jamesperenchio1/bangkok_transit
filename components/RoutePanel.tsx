"use client";

import { useSettingsStore } from "@/lib/settings-store";
import { computeFare, type FareResult } from "@/lib/fares";
import { useFares } from "@/lib/use-fares";
import { useEffect, useId, useRef, useState } from "react";
import { X, MapPin, ArrowRight, ChevronDown, ChevronUp } from "lucide-react";
import { useArrivals } from "@/lib/use-arrivals";
import {
  arrivalClockTime,
  minutesLabel,
  trainEtaMinutes,
  upcomingTrains,
  updatedAgoLabel,
} from "@/lib/format-eta";
import { shownCode, type Station } from "@/data/stations";
import { terminusInDirection, type PathResult } from "@/lib/transit-graph";
import type { GeoPosition } from "@/lib/use-geolocation";
import { LINE_COLORS, LINE_NAMES } from "@/lib/line-colors";
import { stationName, useT } from "@/lib/i18n";
import { distanceLabel } from "@/lib/nearest-station";
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
      className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-700 underline underline-offset-2 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
    >
      <MapPin size={14} aria-hidden="true" />
      {t.googleMaps}
    </a>
  );
}

// A walking transfer that ends in a ride is a change the rider has to make, but
// the graph only counts line swaps. Counting it keeps "no changes" from
// contradicting a "64 m walk" on the same line.
function effectiveChanges(path: PathResult) {
  let extra = 0;
  path.legs.forEach((leg, i) => {
    if (
      leg.mode === "walk" &&
      (leg.walkMeters ?? 0) > 0 &&
      path.legs.slice(i).some((later) => later.mode === "ride")
    ) {
      extra += 1;
    }
  });
  return path.changes + extra;
}

// Remembered for the session: a rider who expanded the stops once usually
// wants them expanded on the next trip too.
let showAllStops = false;

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
  const fares = useFares(!!state?.path);
  const headingRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState(showAllStops);
  const listId = useId();
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
  const changes = state?.path ? effectiveChanges(state.path) : 0;
  const summary = state?.path
    ? [t.stops(state.path.stops), t.changes(changes), t.aboutMinutes(state.path.minutes), fareText(t, computeFare(state.path, fares))].filter(Boolean).join(", ")
    : state
      ? t.noRoute
      : "";

  const legs = state?.path?.legs ?? [];
  const lastIndex = legs.length - 1;
  // Long trips hide the uneventful middle, but always keep the first stop
  // after boarding and the stop before the destination so the route still
  // reads as a journey rather than a list.
  const collapsible = !!state?.path && state.path.stops > 8 && lastIndex > 3;
  const hidden = legs.map(() => false);
  if (collapsible && !expanded) {
    for (let i = 2; i <= lastIndex - 2; i++) {
      const leg = legs[i];
      if (leg.mode === "walk" || leg.isChange) continue;
      hidden[i] = true;
    }
  }

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
        className={`fixed inset-x-0 bottom-0 z-50 rounded-t-2xl pb-[env(safe-area-inset-bottom)] border-t border-neutral-200 bg-white shadow-2xl transition-transform duration-200 dark:border-neutral-800 dark:bg-neutral-900 ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ maxHeight: "70dvh" }}
        aria-hidden={!open}
      >
        {state?.mode === "route" && (
          <div className="flex max-h-[70dvh] flex-col overflow-y-auto">
            <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white/95 px-4 pt-3 pb-2.5 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
              <div className="flex items-start justify-between gap-2">
                <div ref={headingRef} tabIndex={-1} className="min-w-0 outline-none">
                  <p
                    className="flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400"
                    lang={lang}
                  >
                    <span className="truncate" title={from}>{from}</span>
                    <ArrowRight
                      size={12}
                      className="shrink-0"
                      aria-label={t.destination}
                      role="img"
                    />
                    <span className="truncate" title={to}>{to}</span>
                  </p>
                  {state.path && (
                    <p className="mt-0.5 text-2xl font-semibold tracking-tight">
                      {t.aboutMinutes(state.path.minutes)}
                    </p>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  aria-label={t.close}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
              {state.path && <RouteSummary path={state.path} changes={changes} />}
            </div>

            {state.path && (
              <div className="px-4 pt-2">
                <StopAlertControl alert={stopAlert} />
              </div>
            )}

            {!state.path && (
              <p className="px-4 py-6 text-center text-sm text-neutral-600 dark:text-neutral-400">
                {t.noRoute}
              </p>
            )}

            {state.path && (
              <ul id={listId} className="flex flex-col px-4 pt-1">
                {legs.map((leg, i) => {
                  const isLast = i === lastIndex;
                  const nextLeg = legs[i + 1];
                  // Connector colors: the line ridden into this station, and out of it.
                  // A walking transfer has no line, so it's drawn dashed and grey.
                  const incomingColor = leg.mode === "ride" && leg.line ? LINE_COLORS[leg.line] : null;
                  const outgoingColor = nextLeg?.mode === "ride" && nextLeg.line ? LINE_COLORS[nextLeg.line] : null;
                  const dotColor = incomingColor ?? outgoingColor ?? LINE_COLORS[leg.station.lines[0].line];
                  // For a change badge: the next line actually ridden, past any walk.
                  const nextRide = legs.slice(i + 1).find((l) => l.mode === "ride");
                  const nextLineColor = nextRide?.line ? LINE_COLORS[nextRide.line] : null;

                  // A hidden run is drawn once, at its first station, as one tappable row.
                  if (hidden[i]) {
                    if (hidden[i - 1]) return null;
                    let count = 0;
                    while (i + count < legs.length && hidden[i + count]) count += 1;
                    return (
                      <li key={`collapsed-${i}`} className="flex items-stretch gap-3">
                        <div className="relative w-4 shrink-0">
                          <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 border-l-2 border-dotted border-neutral-300 dark:border-neutral-600" />
                        </div>
                        <div className="flex-1 py-1">
                          <button
                            type="button"
                            onClick={() => {
                              showAllStops = true;
                              setExpanded(true);
                            }}
                            aria-controls={listId}
                            aria-expanded={false}
                            className="inline-flex min-h-11 items-center gap-1 rounded-full border border-neutral-300 px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                          >
                            <ChevronDown size={14} aria-hidden="true" />
                            {t.showStops(count)}
                          </button>
                        </div>
                      </li>
                    );
                  }

                  const isDestination = isLast;
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
                          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-neutral-900 ${
                            isDestination ? "h-3.5 w-3.5" : "h-2.5 w-2.5"
                          }`}
                          style={{ backgroundColor: dotColor }}
                        />
                      </div>
                      <div className={`flex-1 py-1.5 ${isDestination ? "pb-3" : ""}`}>
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium">
                          <span className={isDestination ? "font-semibold" : undefined}>
                            {stationName(leg.station, lang)}
                          </span>
                          <span className="rounded bg-neutral-100 px-1 py-px font-mono text-[10px] font-semibold tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                            {shownCode(leg.station)}
                          </span>
                          {i === 0 && (
                            <span className="rounded-full bg-green-700 px-1.5 py-px text-[10px] font-semibold text-white">
                              {t.boardHere}
                            </span>
                          )}
                          {isDestination && (
                            <span className="rounded-full bg-green-700 px-1.5 py-px text-[10px] font-semibold text-white">
                              {t.getOffHere}
                            </span>
                          )}
                          {leg.isChange && (
                            <span className="inline-flex items-center gap-1" title={t.changeLine}>
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
                          <p className="text-xs text-neutral-600 dark:text-neutral-400">{t.walked(distanceLabel(leg.walkMeters, lang))}</p>
                        )}
                        {leg.boardToward && (
                          <p className="text-xs text-neutral-600 dark:text-neutral-300">
                            {nextLeg?.line && (
                              // The line by name, so it never depends on colour alone.
                              <span lang="en" className="font-medium">{LINE_NAMES[nextLeg.line]} · </span>
                            )}
                            {leg.boardVia
                              ? t.boardTowardVia(stationName(leg.boardToward, lang), stationName(leg.boardVia, lang))
                              : t.boardToward(stationName(leg.boardToward, lang))}
                          </p>
                        )}
                        {leg.boardToward && leg.station.hasLiveArrivals && nextLeg?.line && (
                          // Live times for the platform this route boards from.
                          <LiveEta
                            station={leg.station}
                            directionKey={terminusInDirection(nextLeg.line, leg.station.code, leg.station.code)}
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {state.path && collapsible && expanded && (
              <div className="px-4 pb-1">
                <button
                  type="button"
                  onClick={() => {
                    showAllStops = false;
                    setExpanded(false);
                  }}
                  aria-controls={listId}
                  aria-expanded
                  className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-neutral-700 underline underline-offset-2 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
                >
                  <ChevronUp size={14} aria-hidden="true" />
                  {t.hideStops}
                </button>
              </div>
            )}

            <div className="mt-1 border-t border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
              <GoogleMapsLink href={directionsUrl(userPosition ?? state.start, state.destination)} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export function fareText(t: ReturnType<typeof useT>["t"], fare: FareResult | null): string {
  if (!fare) return "";
  if (fare.complete) return t.fareTotal(fare.total);
  return fare.total > 0 ? t.farePartial(fare.total) : t.fareUnavailable;
}

function RouteSummary({ path, changes }: { path: PathResult; changes: number }) {
  const { lang, t } = useT();
  const parts = [t.stops(path.stops), t.changes(changes)];
  if (path.walkMeters > 0) parts.push(t.walk(distanceLabel(path.walkMeters, lang)));
  parts.push(t.aboutMinutes(path.minutes));
  const showFare = useSettingsStore((s) => s.settings.showFare);
  const fares = useFares(showFare);
  const fare = showFare ? computeFare(path, fares) : null;
  return (
    <>
      <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">{parts.join(" · ")}</p>
      {fare && (
        <div data-testid="route-fare" className="mt-1 text-sm text-neutral-900 dark:text-neutral-100">
          <p className="font-semibold">{fareText(t, fare)}</p>
          {fare.segments.length > 1 && (
            <p className="text-xs text-neutral-600 dark:text-neutral-300">
              {fare.segments.map((s) => t.fareLeg(lang === "th" ? s.nameTh : s.name, s.fare)).join(" · ")}
            </p>
          )}
          {fare.discount > 0 && (
            <p className="text-xs text-neutral-600 dark:text-neutral-300">{t.fareDiscount(fare.discount)}</p>
          )}
          <p className="text-xs text-neutral-600 dark:text-neutral-300">{t.faresAsOf(fare.asOf)}</p>
        </div>
      )}
    </>
  );
}

function LiveEta({ station, directionKey }: { station: Station; directionKey?: string }) {
  const { data, live, now } = useArrivals(station.code);
  const { lang, t } = useT();
  const { showLiveTimes, upcomingCount } = useSettingsStore((s) => s.settings);
  if (!showLiveTimes) return null;
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
    .slice(0, Math.max(0, upcomingCount - 1))
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
