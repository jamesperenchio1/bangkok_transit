"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertTriangle size={32} className="text-amber-500" />
      <h1 className="text-base font-semibold">Something went wrong</h1>
      <p className="max-w-xs text-sm text-neutral-500">
        The map hit an unexpected error. You can try again, or reload the page.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={reset}
          className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Reload
        </a>
      </div>
    </div>
  );
}
