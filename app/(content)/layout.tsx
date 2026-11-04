import Link from "next/link";
import { LINES, SITE_NAME, linePath } from "@/lib/seo";

// Shell for the static, crawlable pages (lines, stations, routes). The root
// layout locks the body to the viewport for the map, so this supplies its own
// scroll container. No MapLibre, no client JS beyond Next's own: these pages
// are fast, and "Open on the map" links hand over to the app.
export default function ContentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <nav aria-label="Primary" className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
          <Link href="/" className="font-semibold text-green-800 dark:text-green-400">
            {SITE_NAME}
          </Link>
          <Link href="/lines" className="underline-offset-2 hover:underline">Lines</Link>
          <Link href="/stations" className="underline-offset-2 hover:underline">Stations</Link>
          <Link href="/routes" className="underline-offset-2 hover:underline">Routes</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 leading-relaxed">{children}</main>
      <footer className="border-t border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto max-w-3xl px-4 py-6 text-sm text-neutral-700 dark:text-neutral-300">
          <p className="mb-2 font-semibold">Bangkok rail lines</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {LINES.map((l) => (
              <li key={l.key}>
                <Link href={linePath(l)} className="underline underline-offset-2">{l.nameEn}</Link>
              </li>
            ))}
          </ul>
          <p className="mt-4">
            <Link href="/" className="underline underline-offset-2">Open the live map and route planner</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
