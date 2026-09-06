"use client";

import { useEffect, useState } from "react";
import { X, MapPin, ArrowRight, RefreshCw } from "lucide-react";
import { useArrivals } from "@/lib/use-arrivals";
import type { Station } from "@/data/stations";
import type { PathResult } from "@/lib/transit-graph";
import type { GeoPosition } from "@/lib/use-geolocation";
import { LINE_COLORS } from "@/lib/line-colors";

function minutesLabel(minutes?: number): string {
  if (minutes === undefined || minutes === null) return "—";
  if (minutes <= 0) return "Arriving";
  return `${minutes} min`;
}

function directionsUrl(
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number },
) {
  return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lon}&destination=${destination.lat},${destination.lon}&travelmode=transit`;
}

function GoogleMapsLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex w-fit items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      <MapPin size={14} />
      Get directions in Google Maps
    </a>
  );
}

function ArrivalsList({ station }: { station: Station }) {
  const { data, error, loading } = useArrivals(station.hasLiveArrivals ? station.code : null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!station.hasLiveArrivals) {
    return <p className="py-2 text-sm text-neutral-500">No live arrivals for this line.</p>;
  }

  const dataAgeMs = data ? now - Date.parse(data.timestamp + "Z") : 0;
  const isStale = dataAgeMs > 90_000;

  return (
    <>
      {loading && !data && (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-800"
            />
          ))}
        </div>
      )}
      {error && !data && <p className="py-4 text-center text-sm text-red-500">{error}</p>}
      {data && !data.service_active && (
        <p className="mb-2 text-sm text-neutral-500">
          Service is not currently running. Next service ~{data.next_service}.
        </p>
      )}
      {data && !data.platforms?.length && (
        <p className="py-2 text-sm text-neutral-500">No live arrivals for this station.</p>
      )}
      {data && data.platforms?.length > 0 && (
        <div className="flex flex-col gap-2">
          {data.platforms.map((p) => (
            <div key={p.platform} className="rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-800">
              <p className="mb-1 text-xs font-medium text-neutral-500">
                Platform {p.platform} · toward {p.direction.split("|").pop()?.trim()}
              </p>
              {p.trains.length === 0 ? (
                <p className="text-sm text-neutral-400">No trains currently reported.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {p.trains.map((t, i) => (
                    <li key={i} className="text-sm">
                      {isStale ? "updating…" : minutesLabel(t.eta_minutes)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export type RoutePanelState =
  | { mode: "station"; station: Station }
  | { mode: "route"; start: Station; destination: Station; path: PathResult | null };

export interface RoutePanelProps {
  state: RoutePanelState | null;
  userPosition: GeoPosition | null;
  onClose: () => void;
}

export function RoutePanel({ state, userPosition, onClose }: RoutePanelProps) {
  const open = state !== null;

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-neutral-200 bg-white shadow-2xl transition-transform duration-200 dark:border-neutral-800 dark:bg-neutral-900 ${
        open ? "translate-y-0" : "translate-y-full"
      }`}
      style={{ maxHeight: "70vh" }}
      aria-hidden={!open}
    >
      {state?.mode === "station" && (
        <div className="flex max-h-[70vh] flex-col overflow-y-auto p-4">
          <Header
            title={state.station.nameEn}
            subtitle={state.station.nameTh}
            badgeColor={state.station.lines[0] ? LINE_COLORS[state.station.lines[0].line] : undefined}
            badgeText={state.station.code}
            onClose={onClose}
          />
          <div className="mb-3">
            <GoogleMapsLink
              href={
                userPosition
                  ? directionsUrl(userPosition, state.station)
                  : `https://www.google.com/maps/search/?api=1&query=${state.station.lat},${state.station.lon}`
              }
            />
          </div>
          <ArrivalsList station={state.station} />
        </div>
      )}

      {state?.mode === "route" && (
        <div className="flex max-h-[70vh] flex-col overflow-y-auto p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span>{state.start.nameEn}</span>
              <ArrowRight size={14} className="shrink-0 text-neutral-400" />
              <span>{state.destination.nameEn}</span>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>

          <div className="mb-3">
            <GoogleMapsLink
              href={directionsUrl(userPosition ?? state.start, state.destination)}
            />
          </div>

          {!state.path && (
            <p className="py-4 text-center text-sm text-neutral-500">
              No route found between these stations yet - try Google Maps above.
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
                      <p className="text-sm font-medium">
                        {leg.station.nameEn}
                        {leg.isTransfer && (
                          <span className="ml-1.5 inline-flex items-center gap-1 text-xs font-normal text-amber-600 dark:text-amber-400">
                            <RefreshCw size={11} />
                            Change line
                            {leg.towardStation && ` · Toward ${leg.towardStation.nameEn}`}
                          </span>
                        )}
                      </p>
                      {leg.station.hasLiveArrivals && isLast && <LiveEta station={leg.station} />}
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

function LiveEta({ station }: { station: Station }) {
  const { data } = useArrivals(station.code);
  const next = data?.platforms?.[0]?.trains?.[0]?.eta_minutes;
  if (next === undefined) return null;
  return <p className="text-xs text-neutral-500">Next arrival ~{minutesLabel(next)}</p>;
}

function Header({
  title,
  subtitle,
  badgeColor,
  badgeText,
  onClose,
}: {
  title: string;
  subtitle: string;
  badgeColor?: string;
  badgeText: string;
  onClose: () => void;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-2">
      <div>
        <div className="flex items-center gap-2">
          <span
            className="rounded px-1.5 py-0.5 text-xs font-semibold text-white"
            style={{ backgroundColor: badgeColor ?? "#666" }}
          >
            {badgeText}
          </span>
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <p className="text-sm text-neutral-500">{subtitle}</p>
      </div>
      <button
        onClick={onClose}
        className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        aria-label="Close"
      >
        <X size={20} />
      </button>
    </div>
  );
}
