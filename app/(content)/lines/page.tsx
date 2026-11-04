import type { Metadata } from "next";
import Link from "next/link";
import { LINES, pageMeta, breadcrumbLd, linePath, lineStations, lineTermini } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";

export const metadata: Metadata = pageMeta({
  title: "All 9 Bangkok BTS, MRT & Rail Lines",
  description: "Every Bangkok rail line: BTS Sukhumvit, Silom and Gold, MRT Blue, Purple, Yellow and Pink, Airport Rail Link and SRT Red, with all stations in order.",
  path: "/lines",
});

export default function LinesIndex() {
  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "/" }, { name: "Lines", path: "/lines" }])} />
      <h1 className="text-2xl font-bold">Bangkok BTS, MRT and rail lines</h1>
      <p className="mt-2">
        Bangkok has {LINES.length} operating rail lines. Choose one for its full station list, termini and interchanges.
      </p>
      <ul className="mt-6 space-y-3">
        {LINES.map((l) => {
          const termini = lineTermini(l.key).map((s) => s.nameEn).join(" – ");
          return (
            <li key={l.key} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800" style={{ borderLeft: `6px solid ${l.color}` }}>
              <Link href={linePath(l)} className="text-lg font-semibold underline-offset-2 hover:underline">{l.nameEn}</Link>
              <p lang="th" className="text-sm text-neutral-600 dark:text-neutral-400">{l.nameTh}</p>
              <p className="text-sm">{lineStations(l.key).length} stations · {termini}</p>
            </li>
          );
        })}
      </ul>
    </>
  );
}
