import type { Metadata } from "next";
import Link from "next/link";
import { pageMeta, breadcrumbLd, routePairs } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";

export const metadata: Metadata = pageMeta({
  title: "Bangkok BTS & MRT Routes Between Major Stations",
  description: "Step-by-step BTS, MRT, Airport Rail Link and SRT Red routes between Bangkok's busiest stations, airports and interchanges, with travel time estimates.",
  path: "/routes",
});

export default function RoutesIndex() {
  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "/" }, { name: "Routes", path: "/routes" }])} />
      <h1 className="text-2xl font-bold">Bangkok BTS and MRT routes</h1>
      <p className="mt-2">How to travel between Bangkok&apos;s major stations, airports and interchanges.</p>
      <ul className="mt-4 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {routePairs.map((p) => (
          <li key={p.slug}>
            <Link href={`/routes/${p.slug}`} className="underline-offset-2 hover:underline">
              {p.from.nameEn} to {p.to.nameEn}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
