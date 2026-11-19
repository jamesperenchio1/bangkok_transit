import { useEffect, useState } from "react";
import type { FareData } from "@/lib/fares";

let cached: FareData | null = null;
let pending: Promise<FareData> | null = null;

function load(): Promise<FareData> {
  // Separate chunks: the tables are tens of KB and only matter once a route exists.
  pending ??= Promise.all([import("@/data/fares.json"), import("@/data/fare-rules.json")]).then(
    ([fares, rules]) => (cached = { ...(fares.default as unknown as FareData), rules: rules.default.rules as FareData["rules"] }),
  );
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
