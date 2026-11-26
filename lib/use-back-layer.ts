"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Hardware/gesture back closes the topmost open layer instead of leaving the
 * page. Android back and the iOS edge swipe both fire `popstate`, which is the
 * only navigation signal a static export can hook without a router.
 *
 * Layers nest (search over the route sheet), so entries form a stack. Each
 * pushed history entry is tagged with the layer id; a pop only closes layers
 * above the entry the browser landed on. That keeps a programmatic close from
 * closing the layer underneath it.
 */

type Layer = { id: string; close: () => void };

const stack: Layer[] = [];
let seq = 0;
let listening = false;

function layerIdOf(state: unknown): string | undefined {
  if (!state || typeof state !== "object") return undefined;
  const id = (state as Record<string, unknown>).__btsLayer;
  return typeof id === "string" ? id : undefined;
}

function onPopState() {
  const landedOn = layerIdOf(window.history.state);
  // Close every layer that sits above the entry the browser moved to. When the
  // user goes back past the oldest layer this empties the stack.
  while (stack.length > 0 && stack[stack.length - 1].id !== landedOn) {
    stack.pop()?.close();
  }
}

function listen() {
  if (typeof window === "undefined" || listening) return;
  listening = true;
  window.addEventListener("popstate", onPopState);
}

/**
 * Push a history entry while `open`, and call `onClose` when the user goes
 * back. Closing through the UI goes back too, so the history entry never
 * outlives the layer. `onClose` can safely be called more than once.
 */
export function useBackLayer(open: boolean, onClose: () => void): void {
  // A lazy state initialiser gives each mounted layer a stable id without
  // touching a ref during render (which React 19's lint rejects).
  const [id] = useState(() => `bts-layer-${++seq}`);
  const closeRef = useRef(onClose);
  const pushed = useRef(false);

  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (open) {
      if (pushed.current) return;
      pushed.current = true;
      listen();
      stack.push({ id: id, close: () => closeRef.current() });
      // Keep whatever state the app already put on this entry; HomeClient
      // rewrites the query string with replaceState and must preserve it.
      const state = { ...(window.history.state ?? {}), __btsLayer: id };
      window.history.pushState(state, "");
      return;
    }

    if (!pushed.current) return;
    pushed.current = false;
    const at = stack.findIndex((layer) => layer.id === id);
    if (at >= 0) stack.splice(at, 1);
    if (layerIdOf(window.history.state) === id) {
      // The entry is still ours: step back over it. The popstate handler sees
      // the entry underneath and leaves it alone.
      window.history.back();
    }
  }, [open, id]);

  // A layer unmounted while open (route changed, component swapped) must not
  // leave a tagged entry behind, or the next back press would do nothing.
  useEffect(() => {
    return () => {
      if (!pushed.current) return;
      pushed.current = false;
      const at = stack.findIndex((layer) => layer.id === id);
      if (at >= 0) stack.splice(at, 1);
      if (layerIdOf(window.history.state) === id) {
        window.history.back();
      }
    };
  }, [id]);
}
