"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, RotateCcw, Search } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useSettingsStore } from "@/lib/settings-store";
import { RowView, rowId } from "./controls";
import { SECTIONS, type Row, type SectionId } from "./types";

/**
 * One chunk per section: nothing but the section the rider opens is ever
 * downloaded. (The panel itself is a lazy chunk too, loaded when the dialog
 * first opens; see components/SettingsMenu.tsx.)
 */
const LOADERS: Record<SectionId, () => Promise<{ rows: Row[] }>> = {
  quick: () => import("./catalog/quick"),
  map: () => import("./catalog/map"),
  lines: () => import("./catalog/lines"),
  trains: () => import("./catalog/trains"),
  live: () => import("./catalog/live"),
  routing: () => import("./catalog/routing"),
  alerts: () => import("./catalog/alerts"),
  places: () => import("./catalog/places"),
  display: () => import("./catalog/display"),
  data: () => import("./catalog/data"),
};

const cache = new Map<SectionId, Row[]>();
async function loadRows(id: SectionId): Promise<Row[]> {
  const hit = cache.get(id);
  if (hit) return hit;
  const { rows } = await LOADERS[id]();
  cache.set(id, rows);
  return rows;
}

function useRows(id: SectionId, enabled: boolean): Row[] | null {
  const [rows, setRows] = useState<Row[] | null>(cache.get(id) ?? null);
  useEffect(() => {
    if (!enabled || rows) return;
    let cancelled = false;
    void loadRows(id).then((r) => !cancelled && setRows(r));
    return () => {
      cancelled = true;
    };
  }, [id, enabled, rows]);
  return rows;
}

function Section({ id, open, onToggle, advanced }: { id: SectionId; open: boolean; onToggle: () => void; advanced: boolean }) {
  const { lang } = useT();
  const meta = SECTIONS.find((s) => s.id === id)!;
  const rows = useRows(id, open);
  const visible = rows?.filter((r) => advanced || !r.advanced);
  const hiddenCount = rows ? rows.length - (visible?.length ?? 0) : 0;
  return (
    <section className="border-b border-neutral-200 dark:border-neutral-800">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-h-14 w-full items-center gap-2 px-4 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{meta.title[lang]}</span>
            <span className="block truncate text-xs text-neutral-600 dark:text-neutral-400">{meta.summary[lang]}</span>
          </span>
          {open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
        </button>
      </h3>
      {open && (
        <div className="px-2 pb-3">
          {!visible ? (
            <p className="px-2 py-3 text-sm text-neutral-600 dark:text-neutral-400" role="status">
              …
            </p>
          ) : (
            <>
              {visible.map((row) => (
                <RowView key={rowId(row)} row={row} />
              ))}
              {hiddenCount > 0 && (
                <p className="px-2 pt-1 text-xs text-neutral-600 dark:text-neutral-400">
                  {lang === "th" ? `มีอีก ${hiddenCount} ตัวเลือกขั้นสูง` : `${hiddenCount} more in advanced options`}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

const norm = (s: string) => s.toLowerCase();

/** Search across every section: loads them all (once) the first time something is typed. */
function SearchResults({ query }: { query: string }) {
  const { lang } = useT();
  const [all, setAll] = useState<{ id: SectionId; rows: Row[] }[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(SECTIONS.filter((s) => s.id !== "quick").map(async (s) => ({ id: s.id, rows: await loadRows(s.id) }))).then(
      (r) => !cancelled && setAll(r),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  const q = norm(query.trim());
  const hits = useMemo(() => {
    if (!all) return [];
    const seen = new Set<string>();
    const out: { section: SectionId; row: Row }[] = [];
    for (const { id, rows } of all) {
      for (const row of rows) {
        const key = rowId(row);
        if (seen.has(key)) continue;
        const hay = norm(`${row.label.en} ${row.label.th} ${row.hint?.en ?? ""} ${row.hint?.th ?? ""} ${row.keywords ?? ""}`);
        // Searching reaches advanced options too: that is how you find them.
        if (hay.includes(q)) {
          seen.add(key);
          out.push({ section: id, row });
        }
      }
    }
    return out;
  }, [all, q]);

  if (!all) return <p className="px-4 py-3 text-sm" role="status">…</p>;
  if (hits.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-neutral-600 dark:text-neutral-400" role="status">
        {lang === "th" ? "ไม่พบการตั้งค่า" : "No settings match."}
      </p>
    );
  }
  return (
    <div className="px-2 pb-3">
      <p className="sr-only" role="status">
        {lang === "th" ? `พบ ${hits.length} รายการ` : `${hits.length} settings found`}
      </p>
      {hits.map(({ section, row }) => (
        <div key={rowId(row)}>
          <p className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
            {SECTIONS.find((s) => s.id === section)!.title[lang]}
          </p>
          <RowView row={row} />
        </div>
      ))}
    </div>
  );
}

export default function SettingsPanel() {
  const { lang, t } = useT();
  const reset = useSettingsStore((s) => s.reset);
  const [open, setOpen] = useState<SectionId | null>("quick");
  const [advanced, setAdvanced] = useState(false);
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  return (
    <div className="overflow-y-auto pb-4">
      <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <label className="relative block">
          <span className="sr-only">{lang === "th" ? "ค้นหาการตั้งค่า" : "Search settings"}</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={lang === "th" ? "ค้นหาการตั้งค่า…" : "Search settings…"}
            className="min-h-11 w-full rounded-lg border border-neutral-300 bg-white pl-9 pr-3 text-base dark:border-neutral-600 dark:bg-neutral-800"
          />
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={advanced}
          onClick={() => setAdvanced((v) => !v)}
          className="mt-1 flex min-h-11 w-full items-center gap-3 rounded-lg px-1 text-left text-sm"
        >
          <span className="flex-1 font-medium">{lang === "th" ? "แสดงตัวเลือกขั้นสูง" : "Show advanced options"}</span>
          <span
            aria-hidden="true"
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${advanced ? "bg-green-700" : "bg-neutral-400 dark:bg-neutral-600"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${advanced ? "left-[22px]" : "left-0.5"}`} />
          </span>
        </button>
      </div>

      {searching ? (
        <SearchResults query={query} />
      ) : (
        SECTIONS.map((s) => (
          <Section key={s.id} id={s.id} open={open === s.id} advanced={advanced} onToggle={() => setOpen(open === s.id ? null : s.id)} />
        ))
      )}

      <div className="mt-4 px-4">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
        >
          <RotateCcw size={14} aria-hidden="true" />
          {t.settingsReset}
        </button>
      </div>
    </div>
  );
}
