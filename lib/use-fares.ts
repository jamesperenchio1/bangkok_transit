import { useEffect, useState } from "react";
import type { FareData } from "@/lib/fares";

let cached: FareData | null = null;
let pending: Promise<FareData> | null = null;

function load(): Promise<FareData> {
  // A separate chunk: the tables are tens of KB and only matter once a route exists.
  pending ??= import("@/data/fares.json").then((m) => (cached = m.default as unknown as FareData));
  return pending;
}

/** The fare tables, or null until they have loaded (they are fetched once, when first asked for). */
export function useFares(enabled: boolean): FareData | null {
  const [data, setData] = useState<FareData | null>(cached);
  useEffect(() => {
    if (!enabled || cached) return;
    let live = true;
    load().then((d) => live && setData(d), () => {});
    return () => {
      live = false;
    };
  }, [enabled]);
  return data ?? cached;
}
