import type { Metadata } from "next";
import Link from "next/link";
import { stations } from "@/data/stations";
import { LINES, pageMeta, breadcrumbLd, linePath, lineStations, stationPath } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";

export const metadata: Metadata = pageMeta({
  title: `All ${stations.length} Bangkok BTS, MRT & Rail Stations`,
  description: `Directory of all ${stations.length} Bangkok rail stations by line, in English and Thai, with live arrivals and route planning.`,
  path: "/stations",
});

export default function StationsIndex() {
  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "/" }, { name: "Stations", path: "/stations" }])} />
      <h1 className="text-2xl font-bold">Bangkok BTS, MRT and rail stations</h1>
      <p className="mt-2">Every station on all {LINES.length} lines, grouped by line.</p>
      {LINES.map((l) => (
        <section key={l.key} className="mt-6">
          <h2 className="text-lg font-semibold">
            <Link href={linePath(l)} className="underline-offset-2 hover:underline">{l.nameEn}</Link>
          </h2>
          <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {lineStations(l.key).map((s) => (
              <li key={s.code}>
                <Link href={stationPath(s)} className="underline-offset-2 hover:underline">{s.nameEn}</Link>{" "}
                <span lang="th" className="text-sm text-neutral-600 dark:text-neutral-400">{s.nameTh}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
