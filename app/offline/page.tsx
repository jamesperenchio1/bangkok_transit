"use client";

import Link from "next/link";
import { useEffect } from "react";
import { RotateCw } from "lucide-react";
import { restoreLang, useT } from "@/lib/i18n";

/**
 * Served by the service worker for a navigation that neither the network nor
 * the cache could answer (app/sw.ts), and indexable by nobody.
 *
 * Deliberately the smallest page in the app: no map, no data, no inline
 * script, one icon and two colours, so it renders from the precache even
 * when everything else is unavailable. The links go to pages that are
 * precached (next.config.ts) - an offline page full of dead links is worse
 * than none.
 *
 * It is a client component because the copy follows the rider's language
 * (useT), which a server component can't do; that is also why the noindex
 * directive sits in this route's layout instead of here.
 */
export default function OfflinePage() {
  const { t } = useT();

  // This page is usually reached without the app's own hydration path, so the
  // saved language is restored here; without it a Thai rider who taps a link
  // in a tunnel gets English.
  useEffect(() => {
    restoreLang();
  }, []);

  return (
    <div className="flex-1 overflow-y-auto bg-neutral-50 dark:bg-neutral-950">
      <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-4 px-6 py-10 text-neutral-900 dark:text-neutral-100">
        <span aria-hidden="true" className="h-1.5 w-12 rounded-full bg-green-700 dark:bg-green-500" />
        <h1 className="text-2xl font-bold">{t.offlineTitle}</h1>
        <p className="text-neutral-700 dark:text-neutral-300">{t.offlineBody}</p>
        <div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 dark:bg-green-600 dark:hover:bg-green-500"
          >
            <RotateCw size={16} aria-hidden="true" />
            {t.reload}
          </button>
        </div>
        <nav aria-label="Primary" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <Link href="/" className="underline underline-offset-2">Map</Link>
          <Link href="/lines" className="underline underline-offset-2">Lines</Link>
          <Link href="/routes" className="underline underline-offset-2">Routes</Link>
        </nav>
      </main>
    </div>
  );
}
