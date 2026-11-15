"use client";

import { useRef, useState, type PointerEvent } from "react";

/** Drag distance (px) past which letting go dismisses the sheet. */
export const DISMISS_DISTANCE = 90;
/** A flick: faster than this (px/ms) and past a short minimum, it dismisses too. */
const FLICK_SPEED = 0.6;
const FLICK_MIN_DISTANCE = 30;

/** Whether a finished downward drag of `dy` px over `ms` should close the sheet. Pure, so it is tested. */
export function shouldDismiss(dy: number, ms: number): boolean {
  return dy > DISMISS_DISTANCE || (dy > FLICK_MIN_DISTANCE && dy / Math.max(1, ms) > FLICK_SPEED);
}

/**
 * Drag-down-to-dismiss for a bottom sheet. Spread `handleProps` on the grab
 * bar; apply `dragY` as the sheet's translateY while it is not null (and turn
 * its transition off, so it follows the finger).
 */
export function useSheetDrag(onDismiss: () => void) {
  const [dragY, setDragY] = useState<number | null>(null);
  const start = useRef<{ y: number; t: number } | null>(null);

  const end = (e: PointerEvent, commit: boolean) => {
    const s = start.current;
    start.current = null;
    setDragY(null);
    if (commit && s && shouldDismiss(e.clientY - s.y, e.timeStamp - s.t)) onDismiss();
  };

  const handleProps = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      start.current = { y: e.clientY, t: e.timeStamp };
      setDragY(0);
    },
    onPointerMove: (e: PointerEvent) => {
      if (start.current) setDragY(Math.max(0, e.clientY - start.current.y));
    },
    onPointerUp: (e: PointerEvent) => end(e, true),
    onPointerCancel: (e: PointerEvent) => end(e, false),
  };

  return { dragY, handleProps };
}
