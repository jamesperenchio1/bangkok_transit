"use client";

import { useEffect, useState } from "react";
import { X, Download } from "lucide-react";

const DISMISSED_KEY = "bts:install-hint-dismissed";

export function InstallHint() {
  const [show, setShow] = useState(false);
  type BeforeInstallPromptEvent = Event & { prompt: () => void; userChoice: Promise<{ outcome: string }> };
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISSED_KEY) === "1") return;
    } catch {}
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isSafari = /safari/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
    if (isIos && isSafari) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setIos(true);
      setShow(true);
      return;
    }
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!show) return null;
  const dismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch {}
    setShow(false);
  };
  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    setShow(false);
  };
  return (
    <div role="status" className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
      <Download size={14} className="shrink-0" aria-hidden="true" />
      <span className="flex-1">
        {ios
          ? "Install this app: tap Share, then \u201CAdd to Home Screen\u201D."
          : "Install Bangkok Transit for offline use."}
      </span>
      {!ios && deferred && (
        <button onClick={install} className="shrink-0 rounded-full bg-green-700 px-3 py-1 text-xs font-medium text-white hover:bg-green-800">
          Install
        </button>
      )}
      <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 p-1">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}