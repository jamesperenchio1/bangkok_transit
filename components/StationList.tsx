"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { List, X } from "lucide-react";
import { stationsByCode, type LineKey, type Station } from "@/data/stations";
import sequences from "@/data/line-sequences.json";
import { LINE_COLORS, LINE_NAMES, LINE_ORDER } from "@/lib/line-colors";
import { stationName, useT } from "@/lib/i18n";

export interface StationListProps {
  onSelectStation: (station: Station) => void;
}

/**
 * Every station, grouped by line in running order, in a native modal
 * <dialog>. The map is a canvas, so its stations can't be reached by
 * keyboard or screen reader; this is the equivalent: a plain, ordered list
 * where each entry opens the same station card the map does. The native
 * dialog supplies the focus trap, Escape to close, and focus return.
 */
export function StationList({ onSelectStation }: StationListProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const { lang, t } = useT();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Computed only when first opened: ~190 buttons nobody needs until asked.
  const groups = useMemo(() => {
    if (!open) return [];
    const seqs = sequences as Record<string, string[][]>;
    return LINE_ORDER.map((line: LineKey) => {
      const seen = new Set<string>();
      const list: Station[] = [];
      for (const segment of seqs[line] ?? []) {
        for (const code of segment) {
          const station = stationsByCode.get(code);
          if (station && !seen.has(code)) {
            seen.add(code);
            list.push(station);
          }
        }
      }
      return { line, stations: list };
    });
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={t.stationList}
        aria-haspopup="dialog"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <List size={16} aria-hidden="true" />
      </button>

      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current) setOpen(false); // backdrop click
        }}
        aria-labelledby="station-list-title"
        className="m-auto max-h-[80vh] w-[min(92vw,28rem)] overflow-hidden rounded-2xl border border-neutral-200 bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-black/50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
      >
        <div className="flex max-h-[80vh] flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
            <h2 id="station-list-title" className="text-base font-semibold">
              {t.stationListTitle}
            </h2>
            <button
              onClick={() => setOpen(false)}
              aria-label={t.close}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          <div className="overflow-y-auto px-4 pb-4">
            {groups.map(({ line, stations: list }) => (
              <section key={line} aria-labelledby={`station-list-${line}`} className="mt-4">
                <h3 id={`station-list-${line}`} className="flex items-center gap-2 text-sm font-semibold">
                  <span
                    aria-hidden="true"
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: LINE_COLORS[line] }}
                  />
                  <span lang="en">{LINE_NAMES[line]}</span>
                </h3>
                <ul className="mt-1">
                  {list.map((s) => (
                    <li key={s.code}>
                      <button
                        onClick={() => {
                          setOpen(false);
                          onSelectStation(s);
                        }}
                        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        <span className="w-12 shrink-0 text-xs text-neutral-600 dark:text-neutral-400">{s.code}</span>
                        <span lang={lang} className="flex-1">
                          {stationName(s, lang)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </dialog>
    </>
  );
}
