"use client";

import dynamic from "next/dynamic";
import type { TransitMapClientProps } from "@/components/transit-map-client";

const TransitMapClient = dynamic(
  () => import("@/components/transit-map-client").then((mod) => mod.TransitMapClient),
  { ssr: false }
);

export function TransitMapLoader(props: TransitMapClientProps) {
  return <TransitMapClient {...props} />;
}
