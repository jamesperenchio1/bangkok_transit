"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  ChevronLeft,
  ChevronRight,
  Clock,
  HardDriveDownload,
  Map as MapIcon,
  MapPin,
  Navigation,
  RotateCcw,
  Route,
  Search,
  SlidersHorizontal,
  TrainFront,
  type LucideIcon,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { DEFAULT_SETTINGS, useSettingsStore, type Settings } from "@/lib/settings-store";
import { GroupHeading, RowView, isChanged, rowId, rowVisible } from "./controls";
import { SECTIONS, SECTION_KEYS, type Row, type SectionIcon, type SectionId } from "./types";

/**
 * One chunk per section: nothing but the section the rider opens is ever
 * downloaded. (The panel itself is a lazy chunk too, loaded when the dialog
 * first opens; see components/SettingsMenu.tsx.)
 */
const LOADERS: Record<SectionId, () => Promise<{ rows: Row[] }>> = {
  general: () => import("./catalog/general"),
  map: () => import("./catalog/map"),
  lines: () => import("./catalog/lines"),
  trains: () => import("./catalog/trains"),
  live: () => import("./catalog/live"),
  routing: () => import("./catalog/routing"),
  alerts: () => import("./catalog/alerts"),
  places: () => import("./catalog/places"),
  data: () => import("./catalog/data"),
};

const ICONS: Record<SectionIcon, LucideIcon> = {
  general: SlidersHorizontal,
  map: MapIcon,
  lines: Route,
  trains: TrainFront,
  live: Clock,
  routing: Navigation,
  alerts: BellRing,
  places: MapPin,
  data: HardDriveDownload,
};

const cache = new Map<SectionId, Row[]>();
async function loadRows(id: SectionId): Promise<Row[]> {
  const hit = cache.get(id);
  if (hit) return hit;
  const { rows } = await LOADERS[id]();
  cache.set(id, rows);
  return rows;
}

function useRows(id: SectionId): Row[] | null {
  const [loaded, setLoaded] = useState<{ id: SectionId; rows: Row[] } | null>(
    cache.has(id) ? { id, rows: cache.get(id)! } : null,
  );
  useEffect(() => {
    if (cache.has(id)) return;
    let cancelled = false;
    void loadRows(id).then((rows) => !cancelled && setLoaded({ id, rows }));
    return () => {
      cancelled = true;
    };
  }, [id]);
  return cache.get(id) ?? (loaded?.id === id ? loaded.rows : null);
}

const sectionChanged = (id: SectionId, settings: Settings) =>
  SECTION_KEYS[id].some((key) => isChanged(key, settings[key]));

/** The rows of a section, with a small heading wherever a new group starts. */
function RowList({ rows }: { rows: Row[] }) {
  return (
    <>
      {rows.map((row) => (
        <Fragment key={rowId(row)}>
          {row.group && <GroupHeading text={row.group} />}
          <RowView row={row} />
        </Fragment>
      ))}
    </>
  );
}

function SectionView({ id }: { id: SectionId }) {
  const { lang } = useT();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const rows = useRows(id);
  const meta = SECTIONS.find((s) => s.id === id)!;
  const changed = sectionChanged(id, settings);

  const resetSection = () => {
    const patch: Record<string, unknown> = {};
    for (const key of SECTION_KEYS[id]) {
      const value = DEFAULT_SETTINGS[key];
      patch[key] = Array.isArray(value) ? [...value] : value;
    }
    update(patch as Partial<Settings>);
  };

  return (
    <section aria-labelledby={`settings-section-${id}`} className="px-2 pb-6">
      <div className="flex items-center gap-2 px-2 pb-1 pt-3">
        <h3 id={`settings-section-${id}`} className="min-w-0 flex-1 text-lg font-semibold max-md:sr-only">
          {meta.title[lang]}
        </h3>
        {changed && (
          <button
            type="button"
            onClick={resetSection}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800 max-md:ml-auto"
          >
            <RotateCcw size={14} aria-hidden="true" />
            {lang === "th" ? "คืนค่าหมวดนี้" : "Reset this section"}
          </button>
        )}
      </div>
      {!rows ? (
        <p className="px-2 py-3 text-sm text-neutral-600 dark:text-neutral-400" role="status">
          …
        </p>
      ) : (
        <RowList rows={rows.filter((row) => rowVisible(row, settings))} />
      )}
    </section>
  );
}

const norm = (s: string) => s.toLowerCase();

/** Search across every section: loads them all (once) the first time something is typed. */
function SearchResults({ query }: { query: string }) {
  const { lang } = useT();
  const settings = useSettingsStore((s) => s.settings);
  const [all, setAll] = useState<{ id: SectionId; rows: Row[] }[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(SECTIONS.map(async (s) => ({ id: s.id, rows: await loadRows(s.id) }))).then(
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
        if (seen.has(key) || !rowVisible(row, settings)) continue;
        const hay = norm(`${row.label.en} ${row.label.th} ${row.hint?.en ?? ""} ${row.hint?.th ?? ""} ${row.keywords ?? ""}`);
        if (hay.includes(q)) {
          seen.add(key);
          out.push({ section: id, row });
        }
      }
    }
    return out;
  }, [all, q, settings]);

  if (!all) {
    return (
      <p className="px-4 py-3 text-sm" role="status">
        …
      </p>
    );
  }
  if (hits.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-neutral-600 dark:text-neutral-400" role="status">
        {lang === "th" ? "ไม่พบการตั้งค่า" : "No settings match."}
      </p>
    );
  }
  return (
    <div className="px-2 pb-6">
      <p className="sr-only" role="status">
        {lang === "th" ? `พบ ${hits.length} รายการ` : `${hits.length} settings found`}
      </p>
      {hits.map(({ section, row }) => (
        <div key={rowId(row)}>
          <p className="px-2 pt-3 text-[11px] font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
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
  const settings = useSettingsStore((s) => s.settings);
  const reset = useSettingsStore((s) => s.reset);
  const [page, setPage] = useState<SectionId | null>(null);
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  // Phones show the list or one section at a time; wider screens show both, with General open first.
  const shown: SectionId = page ?? "general";
  const meta = SECTIONS.find((s) => s.id === page);
  const inSection = page !== null && !searching;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        {inSection && meta && (
          <button
            type="button"
            onClick={() => setPage(null)}
            className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-full pl-1 pr-3 text-sm font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-800 md:hidden"
          >
            <ChevronLeft size={18} aria-hidden="true" />
            <span className="sr-only">{lang === "th" ? "กลับ: " : "Back: "}</span>
            {meta.title[lang]}
          </button>
        )}
        <label className={`relative block min-w-0 flex-1 ${inSection ? "max-md:hidden" : ""}`}>
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
      </div>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={lang === "th" ? "หมวดการตั้งค่า" : "Settings sections"}
          className={`flex min-h-0 w-full flex-col overflow-y-auto border-neutral-200 pb-4 dark:border-neutral-800 md:w-60 md:shrink-0 md:border-r ${
            page || searching ? "max-md:hidden" : ""
          }`}
        >
          <ul className="flex flex-col gap-0.5 p-2">
            {SECTIONS.map((s) => {
              const Icon = ICONS[s.icon];
              const active = !searching && shown === s.id;
              const changed = sectionChanged(s.id, settings);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-current={page === s.id ? "page" : undefined}
                    onClick={() => {
                      setQuery("");
                      setPage(s.id);
                    }}
                    // Start the section's rows downloading as the pointer arrives.
                    onPointerEnter={() => void loadRows(s.id)}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                      active ? "md:bg-neutral-100 md:dark:bg-neutral-800" : ""
                    }`}
                  >
                    <Icon size={20} aria-hidden="true" className="shrink-0 text-neutral-600 dark:text-neutral-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{s.title[lang]}</span>
                      <span className="block truncate text-xs text-neutral-600 dark:text-neutral-400">{s.summary[lang]}</span>
                    </span>
                    {changed && (
                      <>
                        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-green-700 dark:bg-green-500" />
                        <span className="sr-only">{lang === "th" ? "(มีการเปลี่ยนแปลง)" : "(changed)"}</span>
                      </>
                    )}
                    <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-neutral-500 md:hidden" />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 px-4">
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
            >
              <RotateCcw size={14} aria-hidden="true" />
              {t.settingsReset}
            </button>
          </div>
        </nav>

        <div className={`min-h-0 min-w-0 flex-1 overflow-y-auto ${!page && !searching ? "max-md:hidden" : ""}`}>
          {searching ? <SearchResults query={query} /> : <SectionView key={shown} id={shown} />}
        </div>
      </div>
    </div>
  );
}
