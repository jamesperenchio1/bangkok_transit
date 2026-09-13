"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { stations, type Station } from "@/data/stations";
import { LINE_COLORS } from "@/lib/line-colors";
import { useArrivals } from "@/lib/use-arrivals";
import { minutesLabel } from "@/lib/format-eta";

export interface StationSearchProps {
  onSelectStation: (station: Station) => void;
}

const MAX_RESULTS = 8;

function SearchResultEta({ station }: { station: Station }) {
  const { data } = useArrivals(station.hasLiveArrivals ? station.code : null);
  if (!station.hasLiveArrivals) {
    return <span className="shrink-0 text-[11px] text-neutral-400">No live data</span>;
  }
  if (!data) return null;
  if (!data.service_active) {
    return <span className="shrink-0 text-[11px] text-neutral-400">Closed</span>;
  }
  const next = data.platforms?.[0]?.trains?.[0]?.eta_minutes;
  if (next === undefined) return null;
  return <span className="shrink-0 text-[11px] text-neutral-500">{minutesLabel(next)}</span>;
}

export function StationSearch({ onSelectStation }: StationSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const q = trimmed.toLowerCase();
    return stations
      .filter(
        (s) =>
          s.nameEn.toLowerCase().includes(q) ||
          s.nameTh.includes(trimmed) ||
          s.code.toLowerCase().includes(q),
      )
      .slice(0, MAX_RESULTS);
  }, [query]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const select = (station: Station) => {
    onSelectStation(station);
    close();
  };

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close search" : "Search stations"}
        className="rounded-full border border-neutral-300 p-2 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {open ? <X size={16} /> : <Search size={16} />}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stations…"
            className="w-full rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-800"
          />

          {results.length > 0 && (
            <ul className="mt-1 max-h-64 overflow-y-auto">
              {results.map((s) => (
                <li key={s.code}>
                  <button
                    onClick={() => select(s)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: LINE_COLORS[s.lines[0].line] }}
                    />
                    <span className="flex-1 truncate">{s.nameEn}</span>
                    <SearchResultEta station={s} />
                    <span className="shrink-0 text-xs text-neutral-400">{s.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {query.trim() && results.length === 0 && (
            <p className="px-2 py-2 text-sm text-neutral-400">No stations found.</p>
          )}
        </div>
      )}
    </div>
  );
}
