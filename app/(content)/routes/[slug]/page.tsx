import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { findPath } from "@/lib/transit-graph";
import {
  pageMeta, breadcrumbLd, describeRoute, mapLink, routeLd, routePairs, routePairsBySlug, stationPath,
} from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";

export const dynamicParams = false;
export const generateStaticParams = () => routePairs.map((p) => ({ slug: p.slug }));

export async function generateMetadata({ params }: PageProps<"/routes/[slug]">): Promise<Metadata> {
  const pair = routePairsBySlug.get((await params).slug);
  const path = pair && findPath(pair.from.code, pair.to.code);
  if (!pair || !path) return {};
  const title = `${pair.from.nameEn} to ${pair.to.nameEn} by Train (${Math.round(path.minutes)} min)`;
  const description = `How to get from ${pair.from.nameEn} (${pair.from.nameTh}) to ${pair.to.nameEn} (${pair.to.nameTh}): ${path.stops} stops, ${path.changes} ${path.changes === 1 ? "change" : "changes"}, about ${Math.round(path.minutes)} minutes.`;
  return pageMeta({ title, description, path: `/routes/${pair.slug}`, type: "article" });
}

export default async function RoutePage({ params }: PageProps<"/routes/[slug]">) {
  const pair = routePairsBySlug.get((await params).slug);
  const path = pair && findPath(pair.from.code, pair.to.code);
  if (!pair || !path) notFound();
  const steps = describeRoute(path);
  return (
    <>
      <JsonLd
        data={[
          breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "Routes", path: "/routes" },
            { name: `${pair.from.nameEn} to ${pair.to.nameEn}`, path: `/routes/${pair.slug}` },
          ]),
          routeLd(pair, path),
        ]}
      />
      <nav aria-label="Breadcrumb" className="mb-3 text-sm">
        <Link href="/routes" className="underline underline-offset-2">Routes</Link> › {pair.from.nameEn} to {pair.to.nameEn}
      </nav>
      <h1 className="text-2xl font-bold">
        {pair.from.nameEn} to {pair.to.nameEn} by BTS and MRT
      </h1>
      <p lang="th" className="text-neutral-600 dark:text-neutral-400">
        {pair.from.nameTh} → {pair.to.nameTh}
      </p>
      <p className="mt-3">
        The trip from <Link href={stationPath(pair.from)} className="underline underline-offset-2">{pair.from.nameEn}</Link> to{" "}
        <Link href={stationPath(pair.to)} className="underline underline-offset-2">{pair.to.nameEn}</Link> takes about{" "}
        <strong>{Math.round(path.minutes)} minutes</strong> ({path.stops} stops,{" "}
        {path.changes === 0 ? "no changes" : `${path.changes} ${path.changes === 1 ? "change" : "changes"}`}
        {path.walkMeters > 0 ? `, ${Math.round(path.walkMeters / 10) * 10} m of walking` : ""}), not counting the wait for the first train.
        The same line sequence works in reverse.
      </p>
      <h2 className="mt-6 text-xl font-semibold">Step by step</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Start at {pair.from.nameEn}.</li>
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <p className="mt-6">
        <Link href={mapLink(pair.from, pair.to)} className="inline-block rounded-lg bg-green-700 px-4 py-2 font-medium text-white hover:bg-green-800">
          Show this route on the map
        </Link>
      </p>
      <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
        Times are estimates from track distance and typical train speed, not a timetable.
      </p>
    </>
  );
}
