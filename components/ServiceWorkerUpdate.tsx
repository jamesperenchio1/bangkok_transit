"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { whenMapPainted } from "@/lib/map-ready";

/** update() asks the server for a new worker; once an hour is plenty for an app that ships a few times a week. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;
/** If the worker never reports taking over (a browser that doesn't fire controllerchange), reload anyway - it is what the rider asked for. */
const RELOAD_FALLBACK_MS = 5_000;

/**
 * "A new version is available." The service worker installs new builds but
 * waits (app/sw.ts), so the page keeps running the code it loaded. Offering
 * the reload is what makes that safe: the rider reloads when they are not in
 * the middle of a route, instead of a worker swapping chunks under an open
 * page (the 404s that skipWaiting used to cause).
 *
 * Deliberately quiet: no network at mount, and the first check waits for the
 * map to paint (lib/map-ready.ts) so nothing competes with the lines.
 */
export function ServiceWorkerUpdate() {
  const { t } = useT();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const reloadRequested = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    const listeners: Array<() => void> = [];
    let watched: ServiceWorkerRegistration | null = null;
    let lastCheck = 0;

    // Only offer an update to a page that is already being controlled: a
    // waiting worker on an uncontrolled first visit is not an update, it is
    // the install the page doesn't need to know about.
    const offer = (worker: ServiceWorker | null | undefined) => {
      if (cancelled || !worker || !navigator.serviceWorker.controller) return;
      setWaiting(worker);
    };

    const watch = (registration: ServiceWorkerRegistration) => {
      if (watched === registration) return;
      watched = registration;
      const onUpdateFound = () => {
        const installing = registration.installing;
        if (!installing) return;
        const onStateChange = () => {
          // "installed" without skipping waiting means it is queued behind
          // the running worker.
          if (installing.state === "installed" && registration.waiting) offer(registration.waiting);
        };
        installing.addEventListener("statechange", onStateChange);
        listeners.push(() => installing.removeEventListener("statechange", onStateChange));
      };
      registration.addEventListener("updatefound", onUpdateFound);
      listeners.push(() => registration.removeEventListener("updatefound", onUpdateFound));
    };

    /**
     * Looks at the live registration: is a worker waiting, and (once in a
     * while) is there a newer one to install? The network call is throttled
     * per page load - update() re-fetches sw.js, and glancing back at the tab
     * must not turn into a request every time.
     */
    const check = async (alsoUpdate = false) => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (cancelled || !registration) return;
      watch(registration);
      if (registration.waiting) offer(registration.waiting);
      if (!alsoUpdate) return;
      const now = Date.now();
      if (now - lastCheck < UPDATE_CHECK_MS) return;
      lastCheck = now;
      try {
        await registration.update();
      } catch {
        // Offline, or the server said no: the next check will try again.
      }
    };

    const onControllerChange = () => {
      if (!reloadRequested.current) return;
      reloadRequested.current = false;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    listeners.push(() => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange));

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void check(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    listeners.push(() => document.removeEventListener("visibilitychange", onVisible));

    // A waiting worker is already there (installed by a previous page load) —
    // free to look for, so do it at once; the network check waits its turn.
    void check();
    // The worker is registered on window load, which can be after this mount;
    // `ready` resolves then, without a request of its own. It can resolve
    // undefined where service workers are blocked or unsupported.
    void navigator.serviceWorker.ready
      .then((registration) => {
        if (cancelled || !registration) return;
        watch(registration);
        if (registration.waiting) offer(registration.waiting);
      })
      .catch(() => {});
    void whenMapPainted().then(() => void check(true));

    return () => {
      cancelled = true;
      for (const off of listeners) off();
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waiting) return;
    reloadRequested.current = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
    // Belt and braces: if the swap never reports back, the reload still
    // gives the waiting worker control.
    window.setTimeout(() => {
      if (reloadRequested.current) {
        reloadRequested.current = false;
        window.location.reload();
      }
    }, RELOAD_FALLBACK_MS);
  }, [waiting]);

  if (!waiting || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      // Above the sheets (z-50) and the map's controls (z-1002): the one
      // thing that must never be hidden behind an open route panel.
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-[1100] mx-auto flex max-w-sm items-center gap-2 rounded-xl border border-neutral-200 bg-white py-2 pl-3 pr-2 text-sm text-neutral-900 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
    >
      <span className="flex-1">{t.updateAvailable}</span>
      <button
        type="button"
        onClick={applyUpdate}
        className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800 dark:bg-green-600 dark:hover:bg-green-500"
      >
        <RefreshCw size={14} aria-hidden="true" />
        {t.reload}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t.dismiss}
        className="shrink-0 rounded-full p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
