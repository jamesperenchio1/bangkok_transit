"use client";

/**
 * The route map page: map, station panel, and search.
 *
 * Owns which station is selected and the staged warming described below. The map
 * and the panel stay dumb about each other.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { BtsRouteMap } from "@/components/bts-route-map";
import { StationPanel } from "@/components/station-panel";
import { useLanguage } from "@/components/language-provider";
import { prefetchArrivals } from "@/lib/use-arrivals";
import { btsSchematic } from "@/lib/bts";
import type { StationInfoMap } from "@/lib/station-info";

/**
 * Warmed on load so the first station tap is instant. Deliberately a handful and
 * not the whole network: 60 parallel requests is the exact burst the upstream
 * rate-limits, and a visitor opens one or two stations. These are the busiest
 * interchanges — Siam, Asok and Mo Chit.
 */
const LIKELY_CODES = ["CEN", "E4", "N8"];

/** Spacing between warm-up requests, to stay well clear of the burst limit. */
const WARM_STAGGER_MS = 400;

const RECENT_KEY = "bts:recent-station";

interface Props {
  stationInfo: StationInfoMap;
}

export function RouteMapClient({ stationInfo }: Props) {
  const { t, language } = useLanguage();
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [crowding, setCrowding] = useState<Record<string, number>>({});

  const select = useCallback((code: string) => {
    setSelected(code);
    setQuery("");
    try {
      window.localStorage.setItem(RECENT_KEY, code);
    } catch {
      // Storage unavailable; the panel still works, we just can't warm it next time.
    }
  }, []);

  // One request covers crowding for the whole network, which is why the map can
  // tint every station without asking about each one.
  useEffect(() => {
    let cancelled = false;
    // Same reason as arrivals: don't let the browser's own cache answer with a
    // stale copy of a live reading.
    fetch("/api/network", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.crowding) setCrowding(d.crowding);
      })
      .catch(() => {
        // Crowding is decoration; the map is complete without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Staggered warm-up: whatever they looked at last, then the big interchanges.
  useEffect(() => {
    let recent: string | null = null;
    try {
      recent = window.localStorage.getItem(RECENT_KEY);
    } catch {
      recent = null;
    }

    const codes = [...new Set([recent, ...LIKELY_CODES].filter((c): c is string => Boolean(c)))];
    const timers = codes.map((code, i) =>
      window.setTimeout(() => prefetchArrivals(code), i * WARM_STAGGER_MS)
    );
    return () => timers.forEach(window.clearTimeout);
  }, []);

  const searchable = useMemo(
    () =>
      btsSchematic.lines.flatMap((line) =>
        line.stations.map((s) => ({
          code: s.code,
          nameEn: s.nameEn,
          nameTh: s.nameTh,
          color: line.color,
        }))
      ),
    []
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const seen = new Set<string>();
    return searchable
      .filter((s) => {
        if (seen.has(s.code)) return false;
        const match =
          s.code.toLowerCase().startsWith(q) ||
          s.nameEn.toLowerCase().includes(q) ||
          s.nameTh.includes(query.trim());
        if (match) seen.add(s.code);
        return match;
      })
      .slice(0, 8);
  }, [query, searchable]);

  return (
    // Pinned to the viewport minus the 3rem nav: the map must fill the screen
    // exactly rather than growing the page, or the SVG overflows and the fit-to-
    // content viewBox is cropped instead of letterboxed. dvh so mobile browser
    // chrome collapsing doesn't leave a gap.
    <div className="relative flex h-[calc(100dvh-3rem)] flex-col overflow-hidden lg:flex-row">
      <div className="relative min-h-0 flex-1">
        <div className="absolute left-3 right-3 top-3 z-20 max-w-sm sm:left-4 sm:top-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchStation")}
              aria-label={t("searchStation")}
              className="h-10 w-full rounded-lg border border-border/70 bg-background/95 pl-9 pr-9 text-sm shadow-sm backdrop-blur placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={t("closePanel")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {query && (
            <ul className="mt-1.5 overflow-hidden rounded-lg border bg-background/98 shadow-lg backdrop-blur">
              {results.map((s) => (
                <li key={s.code}>
                  <button
                    type="button"
                    onClick={() => select(s.code)}
                    onPointerEnter={() => prefetchArrivals(s.code)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular text-white"
                      style={{ backgroundColor: s.color }}
                    >
                      {s.code}
                    </span>
                    <span className="truncate">{language === "th" ? s.nameTh : s.nameEn}</span>
                  </button>
                </li>
              ))}
              {results.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted-foreground">{t("noResults")}</li>
              )}
            </ul>
          )}
        </div>

        <BtsRouteMap
          selectedCode={selected}
          onSelect={select}
          onPrefetch={prefetchArrivals}
          crowding={crowding}
          language={language}
        />
      </div>

      {selected && (
        <>
          {/* Bottom sheet on phones, a column beside the map on wide screens. */}
          <div className="absolute inset-x-0 bottom-0 z-30 max-h-[62%] overflow-hidden rounded-t-2xl border-t shadow-2xl lg:static lg:z-auto lg:max-h-none lg:w-[22rem] lg:shrink-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none">
            <StationPanel
              code={selected}
              info={stationInfo[selected]}
              onClose={() => setSelected(null)}
            />
          </div>
        </>
      )}
    </div>
  );
}
