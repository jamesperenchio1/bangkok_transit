import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { shownCode, stations } from "@/data/stations";
import {
  pageMeta, breadcrumbLd, linePath, mapLink, neighbours, routePairs, stationLd, stationLines, stationPath, stationSlug,
  stationsBySlug, linesByKey,
} from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";
import { StationArrivals } from "@/components/StationArrivals";
import interchanges from "@/data/interchanges.json";
import { stationsByCode } from "@/data/stations";
import { placesNearStation } from "@/lib/places-index";
import { clockLabel, getService } from "@/lib/service-hours";

export const dynamicParams = false;
export const generateStaticParams = () => stations.map((s) => ({ slug: stationSlug(s) }));

/**
 * A plain "450 m" / "1.2 km". The content pages are prerendered in English,
 * so they cannot use the client distance helper (which follows the rider's
 * unit setting and language).
 */
function metresLabel(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

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
  // Bundled places nearest this station. The data file can be empty (or not
  // yet generated), in which case the section simply does not render.
  const nearby = placesNearStation(s.code, 6);
  const hasStationInfo = (s.exits?.length ?? 0) > 0 || !!s.landmark;
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.lat},${s.lon}`)}`;
  const introExtras = s.exits?.length
    ? s.landmark
      ? " Station exits, the nearby landmark, service hours and nearby places follow."
      : " Station exits, service hours and nearby places follow."
    : s.landmark
      ? " The nearby landmark, service hours and nearby places follow."
      : " Service hours and nearby places follow.";
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
        in Bangkok. {s.hasLiveArrivals ? "Live BTS arrivals are shown below." : "Live arrivals are not available for this line."}
        {introExtras}
      </p>
      <p className="mt-3">
        <Link href={mapLink(s)} className="inline-block rounded-lg bg-green-700 px-4 py-2 font-medium text-white hover:bg-green-800">
          Plan a route from {s.nameEn}
        </Link>
      </p>

      {hasStationInfo && (
        <>
          <h2 className="mt-8 text-xl font-semibold">Station information</h2>
          {(s.exits?.length ?? 0) > 0 && (
            <>
              <h3 className="mt-3 text-base font-semibold">Exits</h3>
              <ul className="mt-1 list-disc pl-5">
                {s.exits!.map((exit, i) => (
                  <li key={`${i}-${exit}`}>{exit}</li>
                ))}
              </ul>
            </>
          )}
          {s.landmark && (
            <p className="mt-2 text-sm">
              <span className="font-semibold">Nearby:</span> {s.landmark}
            </p>
          )}
        </>
      )}

      <h2 className="mt-8 text-xl font-semibold">Service hours</h2>
      <ul className="mt-2 flex flex-col gap-1">
        {lines.map((l) => {
          const service = getService(l.key);
          if (!service) return null;
          // A peak/late range when they differ, otherwise one typical wait.
          const frequency =
            service.peak === service.late
              ? `every ${service.offPeak} min`
              : `every ${service.peak}–${service.late} min`;
          return (
            <li key={l.key} className="text-sm">
              <span
                aria-hidden="true"
                className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-baseline"
                style={{ backgroundColor: l.color }}
              />
              <span className="font-medium">{l.nameEn}</span> · First train {clockLabel(service.first, "en")} ·
              Last train {clockLabel(service.last, "en")} · {frequency}.
            </li>
          );
        })}
      </ul>

      {s.hasLiveArrivals && <StationArrivals station={s} />}

      {nearby.length > 0 && (
        <>
          <h2 className="mt-8 text-xl font-semibold">Nearby places</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {nearby.map(({ place, meters }) => (
              <li key={place.id}>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.lat},${place.lon}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {place.name}
                </a>{" "}
                <span className="text-sm text-neutral-600 dark:text-neutral-400">
                  {place.kind ? `${place.kind}, ` : ""}
                  {metresLabel(meters)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            Place and exit data ©{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              OpenStreetMap contributors
            </a>
          </p>
        </>
      )}

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
        <span className="font-medium">Location:</span>{" "}
        <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          View on Google Maps
        </a>
      </p>
    </>
  );
}
