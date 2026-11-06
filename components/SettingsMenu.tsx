"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Settings as SettingsIcon, X } from "lucide-react";
import type { LineKey } from "@/data/stations";
import { LINE_COLORS, LINE_NAMES, LINE_ORDER } from "@/lib/line-colors";
import { useT } from "@/lib/i18n";
import { useSettingsStore, type Settings } from "@/lib/settings-store";

type BooleanSetting = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

/** A labelled on/off switch. Same pattern (and 44px target) as the station-alert switch. */
function Toggle({ setting, label, hint }: { setting: BooleanSetting; label: string; hint?: string }) {
  const on = useSettingsStore((s) => s.settings[setting]);
  const update = useSettingsStore((s) => s.update);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => update({ [setting]: !on })}
      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
    >
      <span className="flex-1 py-1.5">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-neutral-600 dark:text-neutral-400">{hint}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          on ? "bg-green-700" : "bg-neutral-400 dark:bg-neutral-600"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

function LineToggle({ line }: { line: LineKey }) {
  const hidden = useSettingsStore((s) => s.settings.hiddenLines.includes(line));
  const toggleLine = useSettingsStore((s) => s.toggleLine);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!hidden}
      onClick={() => toggleLine(line)}
      className="flex min-h-11 items-center gap-2 rounded-lg border border-neutral-300 px-3 text-left text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
    >
      <span
        aria-hidden="true"
        className="h-3 w-3 shrink-0 rounded-full border border-black/20"
        style={{ backgroundColor: hidden ? "transparent" : LINE_COLORS[line] }}
      />
      <span lang="en" className={hidden ? "text-neutral-500 line-through" : ""}>
        {LINE_NAMES[line]}
      </span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4" aria-label={title}>
      <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
        {title}
      </h3>
      <div className="mt-1">{children}</div>
    </section>
  );
}

/**
 * Preferences in a native modal <dialog> (focus trap, Escape, focus return
 * for free). Every choice is applied immediately and remembered on this
 * device; see lib/settings-store.ts.
 */
export function SettingsMenu() {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const { t } = useT();
  const reset = useSettingsStore((s) => s.reset);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={t.settings}
        aria-haspopup="dialog"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <SettingsIcon size={16} aria-hidden="true" />
      </button>

      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current) setOpen(false); // backdrop click
        }}
        aria-labelledby="settings-title"
        className="m-auto max-h-[80dvh] w-[min(92vw,28rem)] overflow-hidden rounded-2xl border border-neutral-200 bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-black/50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
      >
        <div className="flex max-h-[80dvh] flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
            <h2 id="settings-title" className="text-base font-semibold">
              {t.settingsTitle}
            </h2>
            <button
              onClick={() => setOpen(false)}
              aria-label={t.close}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          <div className="overflow-y-auto px-2 pb-4">
            <Section title={t.settingsMap}>
              <Toggle setting="showLabels" label={t.settingShowLabels} />
              <Toggle setting="showTrains" label={t.settingShowTrains} />
              <Toggle setting="showLocation" label={t.settingShowLocation} />
              <Toggle setting="autoZoom" label={t.settingAutoZoom} hint={t.settingAutoZoomHint} />
            </Section>

            <Section title={t.settingsLines}>
              <div className="grid grid-cols-1 gap-2 px-2 min-[380px]:grid-cols-2">
                {LINE_ORDER.map((line) => (
                  <LineToggle key={line} line={line} />
                ))}
              </div>
            </Section>

            <Section title={t.settingsRoutes}>
              <Toggle setting="fewerChanges" label={t.settingFewerChanges} hint={t.settingFewerChangesHint} />
              <Toggle setting="avoidWalking" label={t.settingAvoidWalking} hint={t.settingAvoidWalkingHint} />
            </Section>

            <Section title={t.settingsDisplay}>
              <Toggle setting="largeText" label={t.settingLargeText} />
              <Toggle setting="reduceMotion" label={t.settingReduceMotion} />
            </Section>

            <Section title={t.settingsData}>
              <Toggle setting="onlinePlaces" label={t.settingOnlinePlaces} hint={t.settingOnlinePlacesHint} />
              <Toggle setting="dataSaver" label={t.settingDataSaver} hint={t.settingDataSaverHint} />
            </Section>

            <div className="mt-4 px-2">
              <button
                type="button"
                onClick={reset}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
              >
                <RotateCcw size={14} aria-hidden="true" />
                {t.settingsReset}
              </button>
              <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">{t.settingsAbout}</p>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
