"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { shownCode, type Station } from "@/data/stations";
import { StationActions } from "@/components/StationActions";
import { lineName, readableTextColor } from "@/lib/line-colors";
import { stationLineColor } from "@/lib/map-data";
import { stationName, useT } from "@/lib/i18n";
import { useBackLayer } from "@/lib/use-back-layer";

export type StationSheetProps = {
  station: Station | null;
  onClose: () => void;
  startCode: string | null;
  destinationCode: string | null;
  onSetStart: (station: Station) => void;
  onSetDestination: (station: Station) => void;
};

/** Past this much downward travel the sheet closes on release. */
const DISMISS_PX = 110;
/** ...and a quick flick closes it even without covering that distance. */
const FLICK_PX_PER_MS = 0.55;

type DragState = { code: string | null; pointerId: number | null; offset: number };
type Gesture = { pointerId: number; startY: number; lastY: number; lastAt: number; velocity: number };

/**
 * The v2 station card: a native-feeling bottom sheet over the live map.
 *
 * Deliberately not modal (there is no scrim and the map keeps its gestures):
 * it is a detail panel for a pin the rider just tapped, so panning away from
 * it is a legitimate way to dismiss it. The sheet owns the gesture, the close
 * button, Escape and the system back gesture; the row of actions and live
 * times comes from the same StationActions the popup uses, so the two can
 * never disagree about a station.
 */
export function StationSheet({
  station,
  onClose,
  startCode,
  destinationCode,
  onSetStart,
  onSetDestination,
}: StationSheetProps) {
  const { t, lang } = useT();
  const titleId = useId();

  // Keyed by station code so opening a different pin starts at rest without
  // waiting for an effect to reset the translate.
  const [drag, setDrag] = useState<DragState>({ code: null, pointerId: null, offset: 0 });
  const gesture = useRef<Gesture | null>(null);

  const code = station?.code ?? null;
  const offset = drag.code === code ? drag.offset : 0;
  const dragging = drag.code === code && drag.pointerId !== null;

  useBackLayer(Boolean(station), onClose);

  useEffect(() => {
    if (!station) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [station, onClose]);

  if (!station) return null;

  const start = (event: React.PointerEvent<HTMLDivElement>) => {
    // The close button and the classic link live in the header; starting a
    // drag there would capture the pointer and swallow their click.
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    gesture.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastAt: event.timeStamp,
      velocity: 0,
    };
    setDrag({ code, pointerId: event.pointerId, offset: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;

    const elapsed = event.timeStamp - g.lastAt;
    if (elapsed > 0) g.velocity = (event.clientY - g.lastY) / elapsed;
    g.lastY = event.clientY;
    g.lastAt = event.timeStamp;

    // Downward only: pulling the sheet up would uncover nothing.
    const down = Math.max(0, event.clientY - g.startY);
    setDrag({ code, pointerId: event.pointerId, offset: down });
  };

  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.pointerId !== event.pointerId) return;

    const down = Math.max(0, event.clientY - g.startY);
    // A flick that ended a while ago (finger held still before lifting) is
    // not a flick; only recent movement counts.
    const fresh = event.timeStamp - g.lastAt < 80;
    const dismissed = down > DISMISS_PX || (fresh && g.velocity > FLICK_PX_PER_MS && down > 16);

    if (dismissed) {
      // onClose normally unmounts this sheet in the same paint; resetting the
      // translate too means a parent that keeps it mounted still gets a
      // spring-back instead of a sheet stuck below the screen edge.
      setDrag({ code, pointerId: null, offset: 0 });
      onClose();
      return;
    }
    setDrag({ code, pointerId: null, offset: 0 });
  };

  const cancel = () => {
    // Also fired by the browser right after a normal pointerup, when the
    // gesture is already over: only an interrupted drag should spring back.
    if (!gesture.current) return;
    gesture.current = null;
    setDrag({ code, pointerId: null, offset: 0 });
  };

  const color = stationLineColor(station);
  const codeColor = readableTextColor(color);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1100] flex justify-center">
      <section
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        className="pointer-events-auto flex max-h-[72vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-b-0 border-neutral-200 bg-white shadow-[0_-6px_28px_rgba(0,0,0,0.22)] dark:border-neutral-800 dark:bg-neutral-900"
        style={{
          maxHeight: "72dvh",
          transform: `translateY(${offset}px)`,
          transition: dragging ? "none" : "transform 240ms var(--ease-out)",
        }}
      >
        {/* The whole header is the drag surface, like a native sheet: a rider
            grabs the card, not a 4px handle. touch-none stops the browser's
            pull-to-refresh from fighting the gesture. */}
        <div
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={cancel}
          onLostPointerCapture={cancel}
          className="shrink-0 touch-none cursor-grab select-none active:cursor-grabbing"
        >
          <div className="flex justify-center pb-1 pt-2">
            <span className="h-1 w-9 rounded-full bg-neutral-300 dark:bg-neutral-600" aria-hidden="true" />
          </div>
          <div className="flex items-start gap-2 px-4 pb-2">
            <span
              className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold"
              style={{ backgroundColor: color, color: codeColor }}
            >
              {shownCode(station)}
            </span>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="truncate text-base font-semibold leading-tight">
                {stationName(station, lang)}
              </h2>
              <p
                lang={lang === "en" ? "th" : "en"}
                className="truncate text-sm leading-tight text-neutral-600 dark:text-neutral-400"
              >
                {(lang === "en" ? station.nameTh : station.nameEn) || station.nameEn}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label={t.close}
              title={t.close}
              className="-mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1 px-4 pb-3">
            {station.lines.map((l) => (
              <span
                key={l.line}
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: l.color, color: readableTextColor(l.color) }}
              >
                {lineName(l.line, lang)}
              </span>
            ))}
          </div>
        </div>

        {/* Content scrolls inside the sheet; overscroll containment keeps a
            swipe at the end of the list from panning the map underneath. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {(station.landmark || (station.exits && station.exits.length > 0)) && (
            <div className="mb-2 flex flex-col gap-0.5 text-xs text-neutral-600 dark:text-neutral-400">
              {station.landmark && (
                <p>
                  <span className="font-medium">{t.landmarkNear}:</span> {station.landmark}
                </p>
              )}
              {station.exits && station.exits.length > 0 && (
                <p>
                  <span className="font-medium">{t.exits}:</span> {station.exits.join(", ")}
                </p>
              )}
            </div>
          )}
          <StationActions
            station={station}
            startCode={startCode}
            destinationCode={destinationCode}
            onSetStart={onSetStart}
            onSetDestination={onSetDestination}
          />
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-neutral-200 pt-2 text-[11px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            <span>v2 preview · station sheet</span>
            <Link href="/" className="font-medium underline underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200">
              Classic app
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
