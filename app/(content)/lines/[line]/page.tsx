import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  LINES, breadcrumbLd, pageMeta, linePath, lineBranches, lineLd, lineStations, lineTermini, linesBySlug, mapLink, stationLines, stationPath,
} from "@/lib/seo";
import type { LineKey, Station } from "@/data/stations";
import { JsonLd } from "@/components/JsonLd";

function StationRows({ stations, lineKey }: { stations: Station[]; lineKey: LineKey }) {
  return (
    <ol className="mt-3 divide-y divide-neutral-200 dark:divide-neutral-800">
      {stations.map((s) => {
        const others = stationLines(s).filter((l) => l.key !== lineKey);
        return (
          <li key={s.code} className="flex flex-wrap items-baseline gap-x-2 py-2">
            <span className="w-12 shrink-0 font-mono text-sm text-neutral-600 dark:text-neutral-400">{s.code}</span>
            <Link href={stationPath(s)} className="font-medium underline-offset-2 hover:underline">{s.nameEn}</Link>
            <span lang="th" className="text-sm text-neutral-600 dark:text-neutral-400">{s.nameTh}</span>
            {others.length > 0 && (
              <span className="text-xs text-neutral-600 dark:text-neutral-400">
                · interchange: {others.map((o) => o.nameEn).join(", ")}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export const dynamicParams = false;
export const generateStaticParams = () => LINES.map((l) => ({ line: l.slug }));

export async function generateMetadata({ params }: PageProps<"/lines/[line]">): Promise<Metadata> {
  const line = linesBySlug.get((await params).line);
  if (!line) return {};
  const list = lineStations(line.key);
  const termini = lineTermini(line.key).map((s) => s.nameEn);
  const title = `${line.nameEn}: ${list.length} Stations & Map`;
  const description = `${line.nameEn} (${line.nameTh}) has ${list.length} stations from ${termini[0]} to ${termini[termini.length - 1]}. Full station list, interchanges and route planner.`;
  return pageMeta({ title, description, path: linePath(line) });
}

export default async function LinePage({ params }: PageProps<"/lines/[line]">) {
  const line = linesBySlug.get((await params).line);
  if (!line) notFound();
  const list = lineStations(line.key);
  const termini = lineTermini(line.key);
  const branches = lineBranches(line.key);
  return (
    <>
      <JsonLd
        data={[
          breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "Lines", path: "/lines" },
            { name: line.nameEn, path: linePath(line) },
          ]),
          lineLd(line, list, branches.length > 1),
        ]}
      />
      <nav aria-label="Breadcrumb" className="mb-3 text-sm">
        <Link href="/lines" className="underline underline-offset-2">Lines</Link> › {line.nameEn}
      </nav>
      <h1 className="text-2xl font-bold">{line.nameEn} stations</h1>
      <p lang="th" className="text-neutral-600 dark:text-neutral-400">{line.nameTh}</p>
      <p className="mt-3">
        The {line.nameEn} has {list.length} stations. Terminal stations: {termini.map((s) => s.nameEn).join(", ")}.
        {line.live
          ? " Live train arrivals are available at every station on this line."
          : " Live arrivals are not available for this line; the map and route planner still cover it."}
      </p>
      <p className="mt-3">
        <Link href={mapLink()} className="inline-block rounded-lg bg-green-700 px-4 py-2 font-medium text-white hover:bg-green-800">
          Open the map and plan a route
        </Link>
      </p>
      {branches.length > 1 ? (
        <>
          <h2 className="mt-8 text-xl font-semibold">All {list.length} stations by branch</h2>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            This line splits, so stations are listed in order along each branch. The junction station is the start of
            each branch it serves.
          </p>
          {branches.map((branch) => (
            <section key={branch[0].code + branch[branch.length - 1].code} aria-labelledby={`branch-${branch[branch.length - 1].code}`}>
              <h3 id={`branch-${branch[branch.length - 1].code}`} className="mt-6 text-lg font-semibold">
                {branch[0].nameEn} to {branch[branch.length - 1].nameEn}
              </h3>
              <StationRows stations={branch} lineKey={line.key} />
            </section>
          ))}
        </>
      ) : (
        <>
          <h2 className="mt-8 text-xl font-semibold">All {list.length} stations in order</h2>
          <StationRows stations={list} lineKey={line.key} />
        </>
      )}
    </>
  );
}
