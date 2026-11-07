"use client";

import { useId, useState } from "react";
import type { LineKey } from "@/data/stations";
import { LINE_COLORS, LINE_NAMES, LINE_ORDER } from "@/lib/line-colors";
import { useLangStore, useT, type Lang } from "@/lib/i18n";
import { useSettingsStore, type Settings } from "@/lib/settings-store";
import type { ActionId, Row, Text } from "./types";

const pick = (text: Text, lang: Lang) => text[lang];

function Label({ row, lang, id }: { row: { label: Text; hint?: Text }; lang: Lang; id: string }) {
  return (
    <span className="min-w-0 flex-1 py-1.5">
      <span id={id} className="block text-sm font-medium">
        {pick(row.label, lang)}
      </span>
      {row.hint && <span className="block text-xs text-neutral-600 dark:text-neutral-400">{pick(row.hint, lang)}</span>}
    </span>
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
      <Label row={row} lang={lang} id={labelId} />
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
  return (
    <div className="px-2 py-1">
      <Label row={row} lang={lang} id={labelId} />
      <div role="radiogroup" aria-labelledby={labelId} className="mt-1 flex flex-wrap gap-1.5">
        {row.options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => update({ [row.key]: o.value })}
            className={`min-h-11 rounded-full border px-3.5 text-sm font-medium ${
              value === o.value
                ? "border-green-700 bg-green-700 text-white"
                : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
            }`}
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
        <Label row={row} lang={lang} id={labelId} />
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

/** One chip per line. `inverted`: lit = shown (the setting stores the hidden ones); otherwise lit = selected. */
function Lines({ row, lang }: { row: Extract<Row, { kind: "lines" }>; lang: Lang }) {
  const list = useSettingsStore((s) => s.settings[row.key]) as LineKey[];
  const toggleLine = useSettingsStore((s) => s.toggleLine);
  const labelId = useId();
  return (
    <div className="px-2 py-1">
      <Label row={row} lang={lang} id={labelId} />
      <div role="group" aria-labelledby={labelId} className="mt-1 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
        {LINE_ORDER.map((line) => {
          const listed = list.includes(line);
          const on = row.inverted ? !listed : listed;
          return (
            <button
              key={line}
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => toggleLine(row.key, line)}
              className="flex min-h-11 items-center gap-2 rounded-lg border border-neutral-300 px-3 text-left text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              <span
                aria-hidden="true"
                className="h-3 w-3 shrink-0 rounded-full border border-black/20"
                style={{ backgroundColor: on ? LINE_COLORS[line] : "transparent" }}
              />
              <span lang="en" className={row.inverted && !on ? "text-neutral-500 line-through" : ""}>
                {LINE_NAMES[line]}
              </span>
            </button>
          );
        })}
      </div>
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

/** Buttons that do something once (not a stored preference). Heavy helpers are imported on click, not up front. */
function Action({ row, lang }: { row: Extract<Row, { kind: "action" }>; lang: Lang }) {
  const { t } = useT();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const replace = useSettingsStore((s) => s.replace);
  const T = (en: string, th: string) => (lang === "th" ? th : en);

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
      setStatus(T("Downloading…", "กำลังดาวน์โหลด…"));
      try {
        const { warmMapNow } = await import("@/lib/offline-warm");
        await warmMapNow();
        setStatus(T("Done. The map works offline now.", "เสร็จแล้ว ใช้แผนที่แบบออฟไลน์ได้"));
      } catch {
        setStatus(T("Couldn't finish. Try again on a better connection.", "ดาวน์โหลดไม่สำเร็จ ลองใหม่เมื่อสัญญาณดีขึ้น"));
      } finally {
        setBusy(false);
      }
    },
    clearMap: async () => {
      try {
        await caches.delete("openfreemap-tiles");
        const { OFFLINE_DONE_KEY } = await import("@/lib/offline-warm");
        localStorage.removeItem(OFFLINE_DONE_KEY);
        setStatus(T("Deleted. It will be downloaded again on a later visit.", "ลบแล้ว จะดาวน์โหลดใหม่ในการเข้าครั้งถัดไป"));
      } catch {
        setStatus(T("Nothing to delete.", "ไม่มีอะไรให้ลบ"));
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
          "Bangkok Transit. Map data © OpenStreetMap contributors, tiles by OpenFreeMap, places by Photon. Live BTS times are estimates.",
          "Bangkok Transit ข้อมูลแผนที่ © ผู้ร่วมจัดทำ OpenStreetMap, แผนที่ย่อยโดย OpenFreeMap, สถานที่โดย Photon เวลารถไฟสดเป็นค่าประมาณ",
        ),
      ),
  };

  const needsBox = row.id === "exportSettings" || row.id === "importSettings";
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
    case "lines":
      return <Lines row={row} lang={lang} />;
    case "language":
      return <LanguageRow row={row} lang={lang} />;
    case "action":
      return <Action row={row} lang={lang} />;
  }
}

/** The key of a row, for React lists. */
export function rowId(row: Row): string {
  return row.kind === "action" ? `a-${row.id}` : row.kind === "language" ? "language" : String(row.key);
}

export type { Settings };
