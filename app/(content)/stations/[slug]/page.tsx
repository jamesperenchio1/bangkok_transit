import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { shownCode, stations } from "@/data/stations";
import {
  pageMeta, breadcrumbLd, linePath, mapLink, neighbours, routePairs, stationLd, stationLines, stationPath, stationSlug,
  stationsBySlug, linesByKey,
} from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";
import interchanges from "@/data/interchanges.json";
import { stationsByCode } from "@/data/stations";

export const dynamicParams = false;
export const generateStaticParams = () => stations.map((s) => ({ slug: stationSlug(s) }));

export async function generateMetadata({ params }: PageProps<"/stations/[slug]">): Promise<Metadata> {
  const s = stationsBySlug.get((await params).slug);
  if (!s) return {};
  const lines = stationLines(s).map((l) => l.nameEn);
  const title = `${s.nameEn} Station (${s.nameTh}): ${lines.length > 1 ? "Interchange" : lines[0]}`;
  const description = `${s.nameEn} (${s.nameTh}, ${shownCode(s)}) station on the ${lines.join(" and ")}. Neighbouring stations, interchanges, map location${s.hasLiveArrivals ? " and live BTS train arrivals" : ""}.`;
  return pageMeta({ title, description, path: stationPath(s) });
}

export default async function StationPage({ params }: PageProps<"/stations/[slug]">) {
  const s = stationsBySlug.get((await params).slug);
  if (!s) notFound();
  const lines = stationLines(s);
  const next = neighbours(s.code);
  const transfers = (interchanges as { a: string; b: string; note: string }[])
    .filter((i) => i.a === s.code || i.b === s.code)
    .map((i) => stationsByCode.get(i.a === s.code ? i.b : i.a))
    .filter((x): x is NonNullable<typeof x> => !!x);
  const routes = routePairs.filter((p) => p.from.code === s.code || p.to.code === s.code).slice(0, 12);
  return (
    <>
      <JsonLd
        data={[
          breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "Stations", path: "/stations" },
            { name: s.nameEn, path: stationPath(s) },
          ]),
          stationLd(s),
        ]}
      />
      <nav aria-label="Breadcrumb" className="mb-3 text-sm">
        <Link href="/stations" className="underline underline-offset-2">Stations</Link> › {s.nameEn}
      </nav>
      <h1 className="text-2xl font-bold">{s.nameEn} station</h1>
      <p lang="th" className="text-neutral-600 dark:text-neutral-400">{s.nameTh}</p>
      <p className="mt-3">
        {s.nameEn} ({shownCode(s)}) is on the{" "}
        {lines.map((l, i) => (
          <span key={l.key}>
            {i > 0 && " and "}
            <Link href={linePath(l)} className="underline underline-offset-2">{l.nameEn}</Link>
          </span>
        ))}{" "}
        in Bangkok. {s.hasLiveArrivals ? "Live train arrivals are shown on the map." : "Live arrivals are not available for this line."}
      </p>
      <p className="mt-3">
        <Link href={mapLink(s)} className="inline-block rounded-lg bg-green-700 px-4 py-2 font-medium text-white hover:bg-green-800">
          Plan a route from {s.nameEn}
        </Link>
      </p>

      <h2 className="mt-8 text-xl font-semibold">Neighbouring stations</h2>
      <ul className="mt-2 list-disc pl-5">
        {next.map(({ line, station }) => (
          <li key={`${line.key}-${station.code}`}>
            <Link href={stationPath(station)} className="underline underline-offset-2">{station.nameEn}</Link>{" "}
            <span className="text-sm text-neutral-600 dark:text-neutral-400">({linesByKey.get(line.key)?.nameEn})</span>
          </li>
        ))}
      </ul>

      {transfers.length > 0 && (
        <>
          <h2 className="mt-8 text-xl font-semibold">Walking interchanges</h2>
          <ul className="mt-2 list-disc pl-5">
            {transfers.map((t) => (
              <li key={t.code}>
                <Link href={stationPath(t)} className="underline underline-offset-2">{t.nameEn}</Link>{" "}
                <span className="text-sm text-neutral-600 dark:text-neutral-400">({stationLines(t).map((l) => l.nameEn).join(", ")})</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {routes.length > 0 && (
        <>
          <h2 className="mt-8 text-xl font-semibold">Popular routes</h2>
          <ul className="mt-2 list-disc pl-5">
            {routes.map((p) => (
              <li key={p.slug}>
                <Link href={`/routes/${p.slug}`} className="underline underline-offset-2">
                  {p.from.nameEn} to {p.to.nameEn}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-8 text-sm text-neutral-600 dark:text-neutral-400">
        Coordinates: {s.lat.toFixed(5)}, {s.lon.toFixed(5)}
      </p>
    </>
  );
}
