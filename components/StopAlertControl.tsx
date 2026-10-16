"use client";

import { useId } from "react";
import { Bell, BellRing, X } from "lucide-react";
import type { StopAlert } from "@/lib/use-stop-alert";
import type { StationsBefore } from "@/lib/stop-alert";
import { useT } from "@/lib/i18n";

/** The on/off switch and options, shown inside the route sheet. */
export function StopAlertControl({ alert }: { alert: StopAlert }) {
  const { t } = useT();
  const id = useId();
  const { settings, update } = alert;

  return (
    <section aria-label={t.alertOptions} className="mb-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-700">
      <button
        type="button"
        role="switch"
        aria-checked={settings.enabled}
        onClick={() => update({ enabled: !settings.enabled })}
        className="flex min-h-11 w-full items-center gap-2 text-left text-sm font-medium"
      >
        {settings.enabled ? <BellRing size={18} aria-hidden="true" /> : <Bell size={18} aria-hidden="true" />}
        <span className="flex-1">{t.alertToggle}</span>
        <span
          aria-hidden="true"
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            settings.enabled ? "bg-green-700" : "bg-neutral-400 dark:bg-neutral-600"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
              settings.enabled ? "left-[22px]" : "left-0.5"
            }`}
          />
        </span>
      </button>

      {settings.enabled && (
        <div className="mt-2 flex flex-col gap-2 text-sm">
          <label htmlFor={`${id}-when`} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t.alertWhen}</span>
            <select
              id={`${id}-when`}
              value={settings.stationsBefore}
              onChange={(e) => update({ stationsBefore: Number(e.target.value) as StationsBefore })}
              className="min-h-11 rounded-lg border border-neutral-300 bg-white px-2 dark:border-neutral-600 dark:bg-neutral-800"
            >
              <option value={0}>{t.alertAtDestination}</option>
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {t.alertStopsBefore(n)}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-x-4">
            {(
              [
                ["sound", t.alertSound],
                ["vibrate", t.alertVibrate],
                ["atChanges", t.alertAtChanges],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings[key]}
                  onChange={(e) => update({ [key]: e.target.checked })}
                  className="h-5 w-5 accent-green-700"
                />
                {label}
              </label>
            ))}
          </div>

          <button
            type="button"
            onClick={alert.test}
            className="min-h-11 w-fit rounded-full border border-neutral-300 px-4 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
          >
            {t.alertTest}
          </button>

          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            {alert.hasPosition ? "" : `${t.waitingLocation} `}
            {t.alertKeepScreen}
          </p>
        </div>
      )}
    </section>
  );
}

/** The alert itself: assertive, so a screen reader speaks it at once. */
export function StopAlertBanner({ alert }: { alert: StopAlert }) {
  const { t } = useT();
  return (
    <div role="alert">
      {alert.message && (
        <div className="flex items-center gap-3 border-b border-green-900 bg-green-700 px-4 py-3 text-sm font-semibold text-white">
          <BellRing size={20} className="shrink-0" aria-hidden="true" />
          <span className="flex-1">{alert.message}</span>
          <button
            onClick={alert.dismiss}
            aria-label={t.alertDismiss}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-green-800"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
