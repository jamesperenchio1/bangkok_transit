"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { stations, type Station } from "@/data/stations";
import { LINE_COLORS } from "@/lib/line-colors";
import { useArrivals } from "@/lib/use-arrivals";
import { minutesLabel, upcomingTrains } from "@/lib/format-eta";
import { stationName, useT } from "@/lib/i18n";

export interface StationSearchProps {
  onSelectStation: (station: Station) => void;
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
  keys: [normalize(s.nameEn), normalize(s.nameTh), normalize(s.code)],
}));

function SearchResultEta({ station }: { station: Station }) {
  const { data, live, now } = useArrivals(station.hasLiveArrivals ? station.code : null);
  const { t } = useT();
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

export function StationSearch({ onSelectStation }: StationSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { lang, t } = useT();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const results = useMemo(() => {
    const q = normalize(query);
    if (!q) return [];
    return searchIndex
      .filter(({ keys }) => keys.some((key) => key.includes(q)))
      .map(({ station }) => station)
      .slice(0, MAX_RESULTS);
  }, [query]);

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
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length) {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      select(results[active]);
    }
  };

  const select = (station: Station) => {
    onSelectStation(station);
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
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <input
            autoFocus
            role="combobox"
            aria-label={t.searchStations}
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results[active] ? `${listId}-${results[active].code}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t.searchPlaceholder}
            className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-sm placeholder:text-neutral-600 dark:border-neutral-600 dark:bg-neutral-800 dark:placeholder:text-neutral-400"
          />

          {/* Announces the result count as the user types (polite, not per keystroke noise). */}
          <p className="sr-only" role="status">
            {query.trim() ? (results.length > 0 ? t.searchResultsCount(results.length) : t.noStations) : ""}
          </p>

          <ul id={listId} role="listbox" aria-label={t.searchStations} hidden={results.length === 0} className="mt-1 max-h-64 overflow-y-auto">
            {results.map((s, i) => (
              <li
                key={s.code}
                id={`${listId}-${s.code}`}
                role="option"
                aria-selected={i === active}
                onClick={() => select(s)}
                onMouseMove={() => setActive(i)}
                className={`flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${
                  i === active ? "bg-neutral-100 dark:bg-neutral-800" : ""
                }`}
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: LINE_COLORS[s.lines[0].line] }}
                />
                <span lang={lang} className="flex-1 truncate">{stationName(s, lang)}</span>
                <SearchResultEta station={s} />
                <span className="shrink-0 text-xs text-neutral-600 dark:text-neutral-400">{s.code}</span>
              </li>
            ))}
          </ul>

          {query.trim() && results.length === 0 && (
            <p className="px-2 py-2 text-sm text-neutral-600 dark:text-neutral-400">{t.noStations}</p>
          )}
        </div>
      )}
    </div>
  );
}
