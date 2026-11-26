import Link from "next/link";

/**
 * Always-on preview marker, so the classic app is one tap away without
 * hijacking the v2 header controls. Pinned to the middle of the right edge:
 * the only strip of the map that no header control, banner, legend or
 * attribution reaches.
 */
export function PreviewBadge() {
  return (
    <Link
      href="/"
      title="Back to the classic app"
      className="fixed right-[max(0.5rem,env(safe-area-inset-right))] top-1/2 z-[950] flex -translate-y-1/2 flex-col rounded-lg border border-neutral-300 bg-white/95 px-2.5 py-1.5 text-[10px] leading-tight shadow-md backdrop-blur hover:bg-white dark:border-neutral-700 dark:bg-neutral-900/95 dark:hover:bg-neutral-900"
    >
      <span className="font-semibold text-green-800 dark:text-green-400">v2 preview</span>
      <span className="text-neutral-600 dark:text-neutral-400">Classic app →</span>
    </Link>
  );
}
