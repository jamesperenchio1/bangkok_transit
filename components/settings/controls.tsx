"use client";

import { Fragment, useEffect, useId, useState } from "react";
import { Check } from "lucide-react";
import { LINE_COLORS, LINE_NAMES, LINE_ORDER } from "@/lib/line-colors";
import { useLangStore, useT, type Lang } from "@/lib/i18n";
import { googleMapsKey } from "@/lib/google-maps";
import { DEFAULT_SETTINGS, useSettingsStore, type Settings } from "@/lib/settings-store";
import type { ActionId, Row, Text } from "./types";

const pick = (text: Text, lang: Lang) => text[lang];

/** Which map the rider is effectively on: Google only when chosen and usable in this build. */
export function effectiveProvider(settings: Settings): "standard" | "google" {
  return settings.mapProvider === "google" && googleMapsKey() !== "" ? "google" : "standard";
}

/** Whether a row applies right now: not for the other map, and not without what it needs. */
export function rowVisible(row: Row, settings: Settings): boolean {
  if (row.requires === "googleKey" && !googleMapsKey()) return false;
  if (row.provider && row.provider !== effectiveProvider(settings)) return false;
  return true;
}

/** True when a stored setting differs from its default. */
export function isChanged(key: keyof Settings, value: unknown): boolean {
  return JSON.stringify(value) !== JSON.stringify(DEFAULT_SETTINGS[key]);
}

function Label({
  row,
  lang,
  id,
  changed = false,
}: {
  row: { label: Text; hint?: Text };
  lang: Lang;
  id: string;
  /** Differs from the default: marked, so what you have touched is easy to see. */
  changed?: boolean;
}) {
  return (
    <span className="min-w-0 flex-1 py-1.5">
      <span id={id} className="flex items-center gap-1.5 text-sm font-medium">
        {pick(row.label, lang)}
        {changed && (
          <>
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-700 dark:bg-green-500" />
            <span className="sr-only">{lang === "th" ? "(เปลี่ยนจากค่าเริ่มต้น)" : "(changed from default)"}</span>
          </>
        )}
      </span>
      {row.hint && <span className="mt-0.5 block text-xs text-neutral-600 dark:text-neutral-400">{pick(row.hint, lang)}</span>}
    </span>
  );
}

/** The small heading above a group of rows. */
export function GroupHeading({ text }: { text: Text }) {
  const lang = useLangStore((s) => s.lang);
  return (
    <h4 className="px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-neutral-600 first:pt-1 dark:text-neutral-400">
      {pick(text, lang)}
    </h4>
  );
}

function Toggle({ row, lang }: { row: Extract<Row, { kind: "toggle" }>; lang: Lang }) {
  const on = useSettingsStore((s) => s.settings[row.key]) as boolean;
  const update = useSettingsStore((s) => s.update);
  const labelId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelId}
      onClick={() => update({ [row.key]: !on })}
      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
    >
      <Label row={row} lang={lang} id={labelId} changed={isChanged(row.key, on)} />
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-green-700" : "bg-neutral-400 dark:bg-neutral-600"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function Choice({ row, lang }: { row: Extract<Row, { kind: "choice" }>; lang: Lang }) {
  const value = useSettingsStore((s) => s.settings[row.key]) as string;
  const update = useSettingsStore((s) => s.update);
  const labelId = useId();
  const options = row.options.filter((o) => o.requires !== "googleKey" || googleMapsKey() !== "");
  // Two or three short options read best as one segmented control that fills the row.
  const segmented = options.length <= 3;
  return (
    <div className="px-2 py-1">
      <Label row={row} lang={lang} id={labelId} changed={isChanged(row.key, value)} />
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className={segmented ? "mt-1 grid gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800" : "mt-1 flex flex-wrap gap-1.5"}
        style={segmented ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => update({ [row.key]: o.value })}
            className={
              segmented
                ? `min-h-11 rounded-lg px-2 text-sm font-medium ${
                    value === o.value
                      ? "bg-green-700 text-white shadow-sm"
                      : "text-neutral-800 hover:bg-white dark:text-neutral-200 dark:hover:bg-neutral-700"
                  }`
                : `min-h-11 rounded-full border px-3.5 text-sm font-medium ${
                    value === o.value
                      ? "border-green-700 bg-green-700 text-white"
                      : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
                  }`
            }
          >
            {pick(o.label, lang)}
          </button>
        ))}
      </div>
    </div>
  );
}

function Range({ row, lang }: { row: Extract<Row, { kind: "range" }>; lang: Lang }) {
  const value = useSettingsStore((s) => s.settings[row.key]) as number;
  const update = useSettingsStore((s) => s.update);
  const labelId = useId();
  const shown = row.percent ? `${Math.round(value * 100)}%` : `${value}${row.unit ? ` ${row.unit}` : ""}`;
  return (
    <div className="px-2 py-1">
      <div className="flex items-baseline gap-2">
        <Label row={row} lang={lang} id={labelId} changed={isChanged(row.key, value)} />
        <output className="shrink-0 text-sm tabular-nums text-neutral-700 dark:text-neutral-300">{shown}</output>
      </div>
      <input
        type="range"
        aria-labelledby={labelId}
        min={row.min}
        max={row.max}
        step={row.step}
        value={value}
        onChange={(e) => update({ [row.key]: Number(e.target.value) })}
        className="h-11 w-full accent-green-700"
      />
    </div>
  );
}

/**
 * One row per line, two switches each: whether the line is drawn on the map,
 * and whether route planning may ride it. They are independent - a line can be
 * hidden from the map and still used for routes, or drawn and left out of
 * routes. Compact on purpose (one 44 px row per line) so all of them fit on a
 * phone without a long scroll.
 */
function LineTable({ row, lang }: { row: Extract<Row, { kind: "lineTable" }>; lang: Lang }) {
  const hidden = useSettingsStore((s) => s.settings.hiddenLines);
  const unused = useSettingsStore((s) => s.settings.unusedLines);
  const toggleLine = useSettingsStore((s) => s.toggleLine);
  const update = useSettingsStore((s) => s.update);
  const labelId = useId();
  const T = (en: string, th: string) => (lang === "th" ? th : en);
  const cell = (on: boolean, label: string, onClick: () => void) => (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`mx-auto flex h-11 w-14 items-center justify-center rounded-xl border-2 ${
        on
          ? "border-green-700 bg-green-700 text-white"
          : "border-neutral-300 text-transparent hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
      }`}
    >
      <Check size={20} strokeWidth={3} aria-hidden="true" />
    </button>
  );
  return (
    <div className="px-2 py-1" role="group" aria-labelledby={labelId}>
      <Label row={row} lang={lang} id={labelId} changed={isChanged("hiddenLines", hidden) || isChanged("unusedLines", unused)} />
      <div className="mt-1 grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-x-2 min-[400px]:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem]">
        <span aria-hidden="true" />
        <span aria-hidden="true" className="text-center text-[11px] font-semibold uppercase leading-tight tracking-wide text-neutral-600 dark:text-neutral-400">
          {T("On map", "บนแผนที่")}
        </span>
        <span aria-hidden="true" className="text-center text-[11px] font-semibold uppercase leading-tight tracking-wide text-neutral-600 dark:text-neutral-400">
          {T("Routes", "เส้นทาง")}
        </span>
        {LINE_ORDER.map((line) => (
          <Fragment key={line}>
            <span className="flex min-h-12 min-w-0 items-center gap-2 border-t border-neutral-200 text-sm dark:border-neutral-800">
              <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full border border-black/20" style={{ backgroundColor: LINE_COLORS[line] }} />
              <span lang="en" className="truncate">
                {LINE_NAMES[line]}
              </span>
            </span>
            <span className="border-t border-neutral-200 dark:border-neutral-800">
              {cell(!hidden.includes(line), `${LINE_NAMES[line]}: ${T("show on map", "แสดงบนแผนที่")}`, () => toggleLine("hiddenLines", line))}
            </span>
            <span className="border-t border-neutral-200 dark:border-neutral-800">
              {cell(!unused.includes(line), `${LINE_NAMES[line]}: ${T("use for routes", "ใช้ในการวางแผนเส้นทาง")}`, () => toggleLine("unusedLines", line))}
            </span>
          </Fragment>
        ))}
      </div>
      {(hidden.length > 0 || unused.length > 0) && (
        <button
          type="button"
          onClick={() => update({ hiddenLines: [], unusedLines: [] })}
          className="mt-2 inline-flex min-h-11 items-center rounded-full border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
        >
          {T("Turn every line back on", "เปิดทุกสายอีกครั้ง")}
        </button>
      )}
    </div>
  );
}

function LanguageRow({ row, lang }: { row: Extract<Row, { kind: "language" }>; lang: Lang }) {
  const setLang = useLangStore((s) => s.setLang);
  const labelId = useId();
  return (
    <div className="px-2 py-1">
      <Label row={row} lang={lang} id={labelId} />
      <div role="radiogroup" aria-labelledby={labelId} className="mt-1 flex gap-1.5">
        {(["en", "th"] as const).map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={lang === l}
            onClick={() => setLang(l)}
            className={`min-h-11 rounded-full border px-3.5 text-sm font-medium ${
              lang === l ? "border-green-700 bg-green-700 text-white" : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
            }`}
          >
            {l === "en" ? "English" : "ไทย"}
          </button>
        ))}
      </div>
    </div>
  );
}

const SAVED_KEYS = ["bts:settings:v1", "lang", "bts:stop-alert:v1", "bts:arrivals:v1", "bts:clock-offset:v1"];

/**
 * What the device holds of the offline map: the light pass (overview zooms, a
 * few MB) or the full set (plus street level around every station). Read from
 * the same keys the warm-up module writes.
 */
interface SavedMap {
  full: boolean;
  /** Bytes used by this whole site, per the browser - the map is most of it, but not all. */
  bytes: number | null;
  /** Whether the browser promised to keep it, or null where it cannot say. */
  persisted: boolean | null;
}

/** MB to one decimal below 10, whole MB above; GB past 1 GB. */
function formatSize(bytes: number): string {
  const mb = bytes / 1_048_576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

async function readSavedMap(): Promise<SavedMap | null> {
  try {
    const { OFFLINE_DONE_KEY, OFFLINE_OVERVIEW_KEY } = await import("@/lib/offline-warm");
    const full = localStorage.getItem(OFFLINE_DONE_KEY) !== null;
    const overview = localStorage.getItem(OFFLINE_OVERVIEW_KEY) !== null;
    if (!full && !overview) return null;
    // Not every browser has the storage API; estimate and persisted are both optional.
    const estimate = await navigator.storage?.estimate?.();
    const persisted = (await navigator.storage?.persisted?.()) ?? null;
    return { full, bytes: estimate?.usage ?? null, persisted };
  } catch {
    return null;
  }
}

/** The map download's own UI state, richer than a one-line status: it has real progress. */
type MapJob =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number; phase: "overview" | "detail" }
  | ({ kind: "saved" } & SavedMap)
  | { kind: "error" };

/** Buttons that do something once (not a stored preference). Heavy helpers are imported on click, not up front. */
function Action({ row, lang }: { row: Extract<Row, { kind: "action" }>; lang: Lang }) {
  const { t } = useT();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [mapJob, setMapJob] = useState<MapJob>({ kind: "idle" });
  const [text, setText] = useState("");
  const progressId = useId();
  const replace = useSettingsStore((s) => s.replace);
  const T = (en: string, th: string) => (lang === "th" ? th : en);

  // Arriving at the section should say what is already saved, not just offer
  // to download it again (the row is rendered afresh each time).
  useEffect(() => {
    if (row.id !== "downloadMap") return;
    let live = true;
    void readSavedMap().then((saved) => {
      if (live && saved) setMapJob({ kind: "saved", ...saved });
    });
    return () => {
      live = false;
    };
  }, [row.id]);

  const run: Record<ActionId, () => Promise<void> | void> = {
    testSound: async () => {
      const { unlockAudio, playDing, vibrate } = await import("@/lib/alert-output");
      unlockAudio();
      vibrate();
      const { alertVolume: volume, alertRepeats: repeats } = useSettingsStore.getState().settings;
      const result = await playDing({ volume, repeats });
      setStatus(result.media === "played" || result.webAudio === "running" ? t.alertTestPlayed : t.alertTestBlocked);
    },
    downloadMap: async () => {
      setBusy(true);
      setMapJob({ kind: "running", done: 0, total: 0, phase: "overview" });
      try {
        const { warmMapNow } = await import("@/lib/offline-warm");
        const summary = await warmMapNow({
          onProgress: (p) => {
            // One update per new percent: a full pass is hundreds of requests,
            // and the bar cannot show more than that anyway.
            const step = Math.max(1, Math.ceil(p.total / 100));
            if (p.done < p.total && p.done % step !== 0) return;
            setMapJob({ kind: "running", done: p.done, total: p.total, phase: p.phase });
          },
        });
        const saved = await readSavedMap();
        setMapJob({
          kind: "saved",
          full: saved ? saved.full : true,
          bytes: saved?.bytes ?? null,
          persisted: summary.persisted,
        });
      } catch {
        setMapJob({ kind: "error" });
      } finally {
        setBusy(false);
      }
    },
    clearMap: async () => {
      setMapJob({ kind: "idle" });
      try {
        await caches.delete("openfreemap-tiles");
        const { OFFLINE_DONE_KEY, OFFLINE_OVERVIEW_KEY } = await import("@/lib/offline-warm");
        localStorage.removeItem(OFFLINE_DONE_KEY);
        localStorage.removeItem(OFFLINE_OVERVIEW_KEY);
        setStatus(t.mapDeleted);
      } catch {
        setStatus(t.mapNothingToDelete);
      }
    },
    clearSaved: async () => {
      try {
        for (const k of SAVED_KEYS) localStorage.removeItem(k);
      } catch {
        // storage blocked
      }
      location.reload();
    },
    storage: async () => {
      const e = await navigator.storage?.estimate?.();
      if (!e?.usage) return setStatus(T("Not available in this browser.", "เบราว์เซอร์นี้ไม่รองรับ"));
      const mb = (e.usage / 1_048_576).toFixed(1);
      const of = e.quota ? T(` of ${(e.quota / 1_048_576 / 1024).toFixed(1)} GB available`, ` จาก ${(e.quota / 1_048_576 / 1024).toFixed(1)} GB`) : "";
      setStatus(`${mb} MB${of}`);
    },
    exportSettings: async () => {
      const raw = localStorage.getItem("bts:settings:v1") ?? JSON.stringify(useSettingsStore.getState().settings);
      setText(raw);
      try {
        await navigator.clipboard.writeText(raw);
        setStatus(T("Copied to the clipboard. Keep it somewhere safe.", "คัดลอกไปคลิปบอร์ดแล้ว เก็บไว้ในที่ปลอดภัย"));
      } catch {
        setStatus(T("Copy the text below.", "คัดลอกข้อความด้านล่าง"));
      }
    },
    importSettings: () => {
      if (!text.trim()) return setStatus(T("Paste your backup in the box first.", "วางข้อมูลสำรองในช่องก่อน"));
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return setStatus(T("That isn't a valid backup.", "ข้อมูลสำรองไม่ถูกต้อง"));
      }
      // Valid JSON of the wrong shape ([], null, 5) must not wipe the current settings.
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return setStatus(T("That isn't a valid backup.", "ข้อมูลสำรองไม่ถูกต้อง"));
      }
      replace(text);
      setStatus(T("Restored.", "กู้คืนแล้ว"));
    },
    about: () =>
      setStatus(
        T(
          "Bangkok Transit. Map data © OpenStreetMap contributors, tiles by OpenFreeMap, places by Google. Live BTS times are estimates.",
          "Bangkok Transit ข้อมูลแผนที่ © ผู้ร่วมจัดทำ OpenStreetMap, แผนที่ย่อยโดย OpenFreeMap, สถานที่โดย Google เวลารถไฟสดเป็นค่าประมาณ",
        ),
      ),
  };

  const needsBox = row.id === "exportSettings" || row.id === "importSettings";
  const running = mapJob.kind === "running" ? mapJob : null;
  // Floor, never round: 99.6% must not read as done.
  const percent = running && running.total > 0 ? Math.min(100, Math.floor((running.done / running.total) * 100)) : 0;
  return (
    <div className="px-2 py-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run[row.id]()}
        className="flex min-h-11 w-full items-center rounded-lg border border-neutral-300 px-3 text-left text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:hover:bg-neutral-800"
      >
        {pick(row.label, lang)}
      </button>
      {row.hint && <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{pick(row.hint, lang)}</p>}
      {row.id === "downloadMap" && (
        <div className="mt-2 text-xs text-neutral-700 dark:text-neutral-300">
          {running && (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span id={progressId}>{running.total > 0 ? t.mapDownloading(running.done, running.total) : t.mapPreparing}</span>
                {running.total > 0 && <span className="shrink-0 tabular-nums">{percent}%</span>}
              </div>
              {running.total > 0 && (
                <div
                  role="progressbar"
                  aria-labelledby={progressId}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  aria-valuetext={`${percent}%`}
                  className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
                >
                  <div className="h-full rounded-full bg-green-700 transition-[width]" style={{ width: `${percent}%` }} />
                </div>
              )}
              <p className="mt-1 text-neutral-600 dark:text-neutral-400">
                {running.phase === "detail" ? t.mapPhaseDetail : t.mapPhaseOverview}
              </p>
            </>
          )}
          {mapJob.kind === "saved" && (
            <>
              <div role="status">
                <p className="flex items-start gap-1.5">
                  <Check size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-green-700 dark:text-green-400" />
                  <span>{mapJob.full ? t.mapSavedFull : t.mapSavedOverview}</span>
                </p>
                {mapJob.bytes !== null && mapJob.bytes > 0 && (
                  <p className="mt-0.5 pl-5 text-neutral-600 dark:text-neutral-400">{t.mapSizeUsed(formatSize(mapJob.bytes))}</p>
                )}
                {mapJob.persisted !== null && (
                  <p className="mt-0.5 pl-5 text-neutral-600 dark:text-neutral-400">
                    {mapJob.persisted ? t.mapKept : t.mapMayRemove}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run.downloadMap()}
                className="mt-1.5 inline-flex min-h-11 items-center rounded-full border border-neutral-300 px-3.5 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:hover:bg-neutral-800"
              >
                {t.mapUpdate}
              </button>
            </>
          )}
          {mapJob.kind === "error" && (
            <p role="status" className="text-neutral-700 dark:text-neutral-300">
              {t.mapDownloadFailed}
            </p>
          )}
        </div>
      )}
      {needsBox && (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={T("Settings backup", "ข้อมูลสำรองการตั้งค่า")}
          rows={3}
          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white p-2 font-mono text-base dark:border-neutral-600 dark:bg-neutral-800"
        />
      )}
      {status && (
        <p role="status" className="mt-1 text-xs text-neutral-700 dark:text-neutral-300">
          {status}
        </p>
      )}
    </div>
  );
}

export function RowView({ row }: { row: Row }) {
  const lang = useLangStore((s) => s.lang);
  switch (row.kind) {
    case "toggle":
      return <Toggle row={row} lang={lang} />;
    case "choice":
      return <Choice row={row} lang={lang} />;
    case "range":
      return <Range row={row} lang={lang} />;
    case "lineTable":
      return <LineTable row={row} lang={lang} />;
    case "language":
      return <LanguageRow row={row} lang={lang} />;
    case "action":
      return <Action row={row} lang={lang} />;
  }
}

/** The key of a row, for React lists. */
export function rowId(row: Row): string {
  if (row.kind === "action") return `a-${row.id}`;
  if (row.kind === "language") return "language";
  if (row.kind === "lineTable") return "lineTable";
  return String(row.key);
}

export type { Settings };
