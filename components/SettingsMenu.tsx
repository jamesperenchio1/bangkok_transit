"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Settings as SettingsIcon, X } from "lucide-react";
import { useT } from "@/lib/i18n";

// Only this shell (a button and a dialog frame) is in the main bundle. The
// panel - search, sections, every option's text - is downloaded when the
// dialog is first opened, and each section's rows when it is expanded.
const SettingsPanel = dynamic(() => import("@/components/settings/SettingsPanel"), {
  ssr: false,
  loading: () => (
    <p className="px-4 py-6 text-sm text-neutral-600 dark:text-neutral-400" role="status">
      …
    </p>
  ),
});

/**
 * Preferences in a native modal <dialog> (focus trap, Escape, focus return
 * for free). Every choice is applied immediately and remembered on this
 * device; see lib/settings-store.ts.
 */
export function SettingsMenu() {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  // Once opened, the panel stays mounted (closed dialogs are display:none) so
  // reopening is instant and keeps its scroll position and open section.
  const [everOpened, setEverOpened] = useState(false);
  const { t } = useT();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        onClick={() => {
          setEverOpened(true);
          setOpen(true);
        }}
        // Start the download on hover/touch-start too: by the click it is usually done.
        onPointerEnter={() => void import("@/components/settings/SettingsPanel")}
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
        // A full-screen page on phones; a roomy two-pane window on larger screens.
        className="m-auto h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-black/50 dark:bg-neutral-900 dark:text-neutral-100 md:h-[min(86dvh,44rem)] md:w-[min(94vw,54rem)] md:rounded-2xl md:border md:border-neutral-200 md:dark:border-neutral-800"
      >
        <div className="flex h-full flex-col">
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
          {everOpened && <SettingsPanel />}
        </div>
      </dialog>
    </>
  );
}
