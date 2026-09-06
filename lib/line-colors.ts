import type { LineKey } from "@/data/stations";

/**
 * Canonical per-line colors, matching each line's official brand color as
 * already embedded on every station in `data/stations.ts`. Centralized here
 * (rather than scanning stations for a match) so the map and the route
 * panel are guaranteed to agree, and so a line color survives even if a
 * station's own `lines[]` entry ever gets edited independently.
 */
export const LINE_COLORS: Record<LineKey, string> = {
  sukhumvit: "#76b729",
  silom: "#008c44",
  gold: "#a3833c",
  yellow: "#fdb913",
  pink: "#ec4498",
  blue: "#1c3f94",
  purple: "#a1458e",
  arl: "#8b3f97",
  srtRed: "#a5122a",
};
