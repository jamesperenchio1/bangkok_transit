"use client";

import { useEffect } from "react";

/** Matches lib/seo's brand and the light `theme-color` in app/layout.tsx. */
const LIGHT = "#76b729";
/** `--background` from app/globals.css under [data-theme="dark"]. */
const DARK = "#0a0a0a";

/**
 * The browser paints its status bar / address bar with `<meta name="theme-color">`.
 * Next renders it once from the viewport export, in the light colour, which is
 * right for first paint (layout.tsx's pre-hydration script only sets
 * `data-theme` when the rider has saved a choice). Once the app is running, the
 * bar should follow the theme the rider actually sees - a dark app under a
 * green status bar shows as a hard seam on iOS.
 *
 * One meta, updated in place: adding a second with a `media` query would win
 * unpredictably against Next's.
 */
export function ThemeColorSync() {
  useEffect(() => {
    const root = document.documentElement;
    const query = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      // No data-theme = "system" (components/HomeClient.tsx), so the OS decides.
      const theme = root.dataset.theme;
      const dark = theme === "dark" || (theme !== "light" && query.matches);
      let meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "theme-color";
        document.head.appendChild(meta);
      }
      const color = dark ? DARK : LIGHT;
      if (meta.content !== color) meta.content = color;
    };

    apply();
    // The setting screen writes data-theme directly; nothing else to hook into.
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    query.addEventListener("change", apply);

    return () => {
      observer.disconnect();
      query.removeEventListener("change", apply);
    };
  }, []);

  return null;
}
