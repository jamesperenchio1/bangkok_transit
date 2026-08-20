"use client";

import { useEffect, useState } from "react";
import { X, MapPin } from "lucide-react";
import { useArrivals } from "@/lib/use-arrivals";
import type { Station } from "@/data/stations";

export interface ArrivalsSheetProps {
  station: Station | null;
  onClose: () => void;
}

function minutesLabel(minutes?: number): string {
  if (minutes === undefined || minutes === null) return "—";
  if (minutes <= 0) return "Arriving";
  return `${minutes} min`;
}

export function ArrivalsSheet({ station, onClose }: ArrivalsSheetProps) {
  const { data, error, loading } = useArrivals(station?.code ?? null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const open = station !== null;
  const dataAgeMs = data ? now - Date.parse(data.timestamp + "Z") : 0;
  const isStale = dataAgeMs > 90_000;

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-neutral-200 bg-white shadow-2xl transition-transform duration-200 dark:border-neutral-800 dark:bg-neutral-900 ${
        open ? "translate-y-0" : "translate-y-full"
      }`}
      style={{ maxHeight: "70vh" }}
      aria-hidden={!open}
    >
      {station && (
        <div className="flex max-h-[70vh] flex-col overflow-y-auto p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="rounded px-1.5 py-0.5 text-xs font-semibold text-white"
                  style={{ backgroundColor: station.lines[0]?.color ?? "#666" }}
                >
                  {station.code}
                </span>
                <h2 className="text-lg font-semibold">{station.nameEn}</h2>
              </div>
              <p className="text-sm text-neutral-500">{station.nameTh}</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>

          {station.lat !== undefined && station.lon !== undefined && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${station.lat},${station.lon}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-3 flex w-fit items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <MapPin size={14} />
              Open in Google Maps
            </a>
          )}

          {loading && !data && (
            <p className="py-6 text-center text-sm text-neutral-500">Loading…</p>
          )}
          {error && !data && (
            <p className="py-6 text-center text-sm text-red-500">{error}</p>
          )}

          {data && !data.service_active && (
            <p className="mb-2 text-sm text-neutral-500">
              Service is not currently running. Next service ~{data.next_service}.
            </p>
          )}

          {data && (
            <div className="flex flex-col gap-3">
              {data.platforms.map((p) => (
                <div
                  key={p.platform}
                  className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
                >
                  <p className="mb-1 text-xs font-medium text-neutral-500">
                    Platform {p.platform} · toward {p.direction.split("|").pop()?.trim()}
                  </p>
                  {p.trains.length === 0 ? (
                    <p className="text-sm text-neutral-400">No trains currently reported.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {p.trains.map((t, i) => (
                        <li key={i} className="text-sm">
                          {isStale ? "updating…" : minutesLabel(t.minutes as number)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {isStale && (
                <p className="text-center text-xs text-neutral-400">Updating…</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
