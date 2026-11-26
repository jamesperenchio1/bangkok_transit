"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { MapPin, Search, X } from "lucide-react";
import { codeAliases, shownCode, stations, stationsByCode, type Station } from "@/data/stations";
import { LINE_COLORS, LINE_NAMES } from "@/lib/line-colors";
import { stationsByLine } from "@/lib/station-groups";
import { useArrivals } from "@/lib/use-arrivals";
import { minutesLabel, upcomingTrains } from "@/lib/format-eta";
import { stationName, useT } from "@/lib/i18n";
import { MIN_QUERY_LENGTH, searchPlaces, type Place } from "@/lib/google-places";
import { googleMapsKey } from "@/lib/google-maps";
import { searchLocalPlaces } from "@/lib/places-index";
import { useSettingsStore } from "@/lib/settings-store";

export interface StationSearchProps {
  onSelectStation: (station: Station) => void;
  onSelectPlace: (place: Place) => void;
}

/** One keyboard-navigable list: stations first, then places found online. */
type Item = { kind: "station"; station: Station; key: string } | { kind: "place"; place: Place; key: string };

const PLACE_DEBOUNCE_MS = 350;

/**
 * Places matching the query, fetched online after a short pause. Each new
 * keystroke cancels the previous request; a failure (offline, rate limit) is
 * reported, never thrown, so station search keeps working regardless.
 */
function usePlaces(query: string, enabled: boolean, lang: "en" | "th", limit: number) {
  const [state, setState] = useState<{ query: string; places: Place[]; error: boolean }>({
    query: "",
    places: [],
    error: false,
  });
  const q = query.trim();
  const active = enabled && q.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchPlaces(q, lang, controller.signal, limit)
        .then((places) => setState({ query: q, places, error: false }))
        .catch((err) => {
          if (!controller.signal.aborted) setState({ query: q, places: [], error: true });
          void err;
        });
    }, PLACE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q, active, lang, limit]);

  // Results belong to the query that produced them: while a newer query is in
  // flight nothing from the old one is shown as if it matched.
  const ready = active && state.query === q;
  return { places: ready ? state.places : [], error: ready && state.error, loading: active && !ready };
}

const MAX_RESULTS = 8;

/**
 * Lowercase and drop spaces, dots and hyphens, so "แยกคปอ" finds
 * "แยก คปอ.", "n 15" finds "N15", and "phayathai" finds "Phaya Thai".
 * (toLowerCase leaves Thai untouched.)
 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s.\-]+/g, "");
}

// Normalized once: the station list is static.
const searchIndex = stations.map((s) => ({
  station: s,
  keys: [normalize(s.nameEn), normalize(s.nameTh), ...codeAliases(s).map(normalize)],
}));

const searchKeys = searchIndex.map(({ keys }) => keys);

// Inlined at build time, so this is a constant check, not a runtime env read.
const HAS_GOOGLE_KEY = googleMapsKey().length > 0;

/** Bundled places carry a `local:` id; Google's are opaque. */
function isLocalPlace(place: Place): boolean {
  return place.id.startsWith("local:");
}

/**
 * Whether two results name the same real place: same normalised name and
 * within ~150 m. Google almost always returns the mall/shop the bundled list
 * already had, sometimes with a different suffix ("ICONSIAM" vs "ICONSIAM
 * Shopping Mall"), so this only suppresses near-identical rows.
 */
function samePlace(a: Place, b: Place): boolean {
  if (normalize(a.name) !== normalize(b.name)) return false;
  const metresPerDegree = 111_320;
  const dLat = (a.lat - b.lat) * metresPerDegree;
  const dLon = (a.lon - b.lon) * metresPerDegree * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return dLat * dLat + dLon * dLon <= 150 * 150;
}

function SearchResultEta({ station }: { station: Station }) {
  const { data, live, now } = useArrivals(station.hasLiveArrivals ? station.code : null);
  const { t } = useT();
  const showLiveTimes = useSettingsStore((s) => s.settings.showLiveTimes);
  if (!showLiveTimes) return null;
  if (!station.hasLiveArrivals) {
    return <span className="shrink-0 text-[11px] text-neutral-600 dark:text-neutral-400">{t.noLiveData}</span>;
  }
  if (!data) return null;
  if (!data.service_active) {
    return <span className="shrink-0 text-[11px] text-neutral-600 dark:text-neutral-400">{t.closed}</span>;
  }
  // First upcoming train that has an ETA: an untimed one ahead of it would
  // show "—" while a real time is available.
  const next = upcomingTrains(data.platforms?.[0]?.trains ?? [], data.timestamp, now).find(
    ({ left }) => left !== null,
  );
  if (!next) return null;
  // Last-known (not live) times show in amber with a "~", like elsewhere.
  return (
    <span
      className={`shrink-0 text-[11px] ${
        live ? "text-neutral-600 dark:text-neutral-300" : "text-amber-800 dark:text-amber-300"
      }`}
      title={live ? undefined : t.lastKnownDelayed}
    >
      {live ? "" : "~"}
      {minutesLabel(next.left, t)}
    </span>
  );
}

const RECENTS_KEY = "bts:search-recents:v1";
type RecentEntry = { kind: "station"; code: string } | { kind: "place"; place: Place };

export function StationSearch({ onSelectStation, onSelectPlace }: StationSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<Item[]>([]);
  const { lang, t } = useT();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  // The full list by line, shown while the box is empty: the old separate
  // "browse" button, folded in. Built only once the panel has been opened.
  const groups = useMemo(() => (open ? stationsByLine() : []), [open]);

  // Load recents when the panel opens.
  useEffect(() => {
    if (!open) return;
    let entries: RecentEntry[] = [];
    try {
      entries = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    } catch {}
    const items: Item[] = [];
    for (const e of entries) {
      if (e.kind === "station") {
        const s = stationsByCode.get(e.code);
        if (s) items.push({ kind: "station", station: s, key: `s-${s.code}` });
      } else if (e.kind === "place" && e.place) {
        items.push({ kind: "place", place: e.place, key: `p-${e.place.id}` });
      }
    }
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setRecents(items.slice(0, 5));
  }, [open]);

  const { onlinePlaces, placeResults } = useSettingsStore((s) => s.settings);

  // Bundled places are a plain array in the app, so they are searched
  // synchronously on every keystroke: no chunk to await, no request, no
  // Google billing, and they still work offline.
  const localResults = useMemo(
    () => searchLocalPlaces(query.trim(), placeResults, lang),
    [query, placeResults, lang],
  );

  // Google is the fallback only: switched on, a key is configured, the query
  // is long enough for its text search, and the bundled list did not already
  // fill the result slots.
  const googleEnabled =
    onlinePlaces && HAS_GOOGLE_KEY && query.trim().length >= MIN_QUERY_LENGTH && localResults.length < placeResults;
  // Always ask for the full limit: the answer is cached per query, so a
  // stable request key avoids re-billing as bundled matches fill the slots.
  const {
    places: googlePlaces,
    error: placesError,
    loading: placesLoading,
  } = usePlaces(query, googleEnabled, lang, placeResults);

  // Fill whatever slots the bundled list left, dropping Google rows that are
  // the same real place.
  const places = useMemo(() => {
    const room = Math.max(0, placeResults - localResults.length);
    const extra = googlePlaces
      .filter((p) => !localResults.some((local) => samePlace(local, p)))
      .slice(0, room);
    return [...localResults, ...extra].slice(0, placeResults);
  }, [localResults, googlePlaces, placeResults]);

  // The typo-tolerant matcher is a separate chunk, fetched the first time the
  // panel opens (the main bundle never carries it). Until it arrives - a
  // moment on a slow link - plain substring matching answers.
  const [fuzzy, setFuzzy] = useState<typeof import("@/lib/fuzzy") | null>(null);
  useEffect(() => {
    if (!open || fuzzy) return;
    let cancelled = false;
    void import("@/lib/fuzzy").then((m) => !cancelled && setFuzzy(m));
    return () => {
      cancelled = true;
    };
  }, [open, fuzzy]);

  const stationResults = useMemo(() => {
    const q = normalize(query);
    if (!q) return [];
    if (fuzzy) return fuzzy.rank(q, searchKeys, MAX_RESULTS).map((i) => searchIndex[i].station);
    return searchIndex
      .filter(({ keys }) => keys.some((key) => key.includes(q)))
      .map(({ station }) => station)
      .slice(0, MAX_RESULTS);
  }, [query, fuzzy]);

  const results: Item[] = useMemo(
    () => [
      ...stationResults.map((station): Item => ({ kind: "station", station, key: `s-${station.code}` })),
      ...places.map((place): Item => ({ kind: "place", place, key: `p-${place.id}` })),
    ],
    [stationResults, places],
  );

  // The highlighted row, kept in range as results arrive or shrink.
  const current = Math.min(active, results.length - 1);
  const hasLocalPlaces = places.some(isLocalPlace);
  const hasGooglePlaces = places.some((p) => !isLocalPlace(p));

  const close = (returnFocus = false) => {
    setOpen(false);
    setQuery("");
    setActive(0);
    if (returnFocus) triggerRef.current?.focus();
  };

  // ARIA combobox keyboard model: arrows move the highlighted result without
  // leaving the input, Enter picks it, Escape closes and returns focus.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      setActive(() => (current + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length) {
      e.preventDefault();
      setActive(() => (current - 1 + results.length) % results.length);
    } else if (e.key === "Enter" && results[current]) {
      e.preventDefault();
      select(results[current]);
    }
  };

  const select = (item: Item) => {
    if (item.kind === "station") onSelectStation(item.station);
    else onSelectPlace(item.place);
    // Record recent
    try {
      const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]") as RecentEntry[];
      const entry: RecentEntry =
        item.kind === "station" ? { kind: "station", code: item.station.code } : { kind: "place", place: item.place };
      const key = item.kind === "station" ? `s-${item.station.code}` : `p-${item.place.id}`;
      const filtered = raw.filter((e) =>
        e.kind === "station" ? `s-${e.code}` !== key : `p-${e.place.id}` !== key,
      );
      filtered.unshift(entry);
      localStorage.setItem(RECENTS_KEY, JSON.stringify(filtered.slice(0, 5)));
    } catch {}
    close();
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={() => (open ? close() : setOpen(true))}
        aria-label={open ? t.closeSearch : t.searchStations}
        aria-expanded={open}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {open ? <X size={16} aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 flex max-h-[70dvh] w-72 flex-col rounded-xl border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <input
            autoFocus
            role="combobox"
            aria-label={t.searchStations}
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results[current] ? `${listId}-${results[current].key}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t.searchPlaceholder}
            className="min-h-11 w-full shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-base placeholder:text-neutral-600 dark:border-neutral-600 dark:bg-neutral-800 dark:placeholder:text-neutral-400"
          />

          {/* Announces the result count as the user types (polite, not per keystroke noise). */}
          <p className="sr-only" role="status">
            {query.trim()
              ? results.length > 0
                ? t.searchResultsCount(results.length)
                : placesLoading
                  ? t.searchingPlaces
                  : t.noStations
              : ""}
          </p>

          <ul id={listId} role="listbox" aria-label={t.searchStations} hidden={results.length === 0} className="mt-1 min-h-0 overflow-y-auto">
            {results.map((item, i) => {
              const rowClass = `flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${
                i === current ? "bg-neutral-100 dark:bg-neutral-800" : ""
              }`;
              // A heading row where each group begins, so stations, bundled
              // places and Google results are never mixed without a label.
              const placeGroup = item.kind === "place" ? (isLocalPlace(item.place) ? "local" : "google") : null;
              const previous = results[i - 1];
              const previousGroup =
                previous?.kind === "place" ? (isLocalPlace(previous.place) ? "local" : "google") : null;
              const groupStart = placeGroup !== null && placeGroup !== previousGroup;
              const groupHeading =
                placeGroup === "local"
                  ? hasGooglePlaces
                    ? t.localPlacesHeading
                    : t.placesHeading
                  : hasLocalPlaces
                    ? t.morePlaces
                    : t.placesHeading;
              return (
                <Fragment key={item.key}>
                  {groupStart && (
                    <li role="presentation" className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
                      {groupHeading}
                    </li>
                  )}
                  {item.kind === "station" ? (
                    <li
                      id={`${listId}-${item.key}`}
                      role="option"
                      aria-selected={i === current}
                      onClick={() => select(item)}
                      onMouseMove={() => setActive(i)}
                      className={rowClass}
                    >
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: LINE_COLORS[item.station.lines[0].line] }}
                      />
                      <span lang={lang} className="flex-1 truncate">{stationName(item.station, lang)}</span>
                      <SearchResultEta station={item.station} />
                      <span className="shrink-0 text-xs text-neutral-600 dark:text-neutral-400">{shownCode(item.station)}</span>
                    </li>
                  ) : (
                    <li
                      id={`${listId}-${item.key}`}
                      role="option"
                      aria-selected={i === current}
                      onClick={() => select(item)}
                      onMouseMove={() => setActive(i)}
                      className={rowClass}
                    >
                      <MapPin size={14} className="shrink-0 text-neutral-600 dark:text-neutral-400" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.place.name}</span>
                        <span className="block truncate text-xs text-neutral-600 dark:text-neutral-400">
                          {[item.place.kind, item.place.detail].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ul>

          {query.trim() && googleEnabled && localResults.length === 0 && placesLoading && (
            <p className="px-2 py-2 text-xs text-neutral-600 dark:text-neutral-400">{t.searchingPlaces}</p>
          )}
          {query.trim() && placesError && (
            <p className="px-2 py-2 text-xs text-neutral-600 dark:text-neutral-400">{t.placesUnavailable}</p>
          )}
          {query.trim() && results.length === 0 && !placesLoading && !placesError && (
            <p className="px-2 py-2 text-sm text-neutral-600 dark:text-neutral-400">{t.noStations}</p>
          )}

           {!query.trim() && recents.length > 0 && (
             <div className="mt-1">
               <p className="px-2 pt-1 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
                 {t.recent}
               </p>
               <ul>
                 {recents.map((item) => {
                   const rowClass = "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800";
                   return (
                     <li key={item.key}>
                       {item.kind === "station" ? (
                         <button type="button" onClick={() => select(item)} className={rowClass}>
                           <span className="w-12 shrink-0 text-xs text-neutral-600 dark:text-neutral-400">{shownCode(item.station)}</span>
                           <span lang={lang} className="flex-1 truncate">{stationName(item.station, lang)}</span>
                         </button>
                       ) : (
                         <button type="button" onClick={() => select(item)} className={rowClass}>
                           <MapPin size={14} className="shrink-0 text-neutral-600 dark:text-neutral-400" aria-hidden="true" />
                           <span className="min-w-0 flex-1 truncate">{item.place.name}</span>
                         </button>
                       )}
                     </li>
                   );
                 })}
               </ul>
             </div>
           )}

           {!query.trim() && (
            <div className="mt-1 min-h-0 overflow-y-auto" data-testid="browse-stations">
              <p className="px-2 pt-1 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
                {t.browseByLine}
              </p>
              {groups.map(({ line, stations: list }) => (
                <section key={line} aria-labelledby={`${listId}-line-${line}`} className="mt-2">
                  <h3 id={`${listId}-line-${line}`} className="flex items-center gap-2 px-2 text-sm font-semibold">
                    <span
                      aria-hidden="true"
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: LINE_COLORS[line] }}
                    />
                    <span lang="en">{LINE_NAMES[line]}</span>
                  </h3>
                  <ul>
                    {list.map((s) => (
                      <li key={s.code}>
                        <button
                          type="button"
                          onClick={() => select({ kind: "station", station: s, key: s.code })}
                          className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          <span className="w-12 shrink-0 text-xs text-neutral-600 dark:text-neutral-400">{shownCode(s)}</span>
                          <span lang={lang} className="flex-1 truncate">
                            {stationName(s, lang)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
