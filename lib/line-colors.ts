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

/**
 * White text is illegible on the Gold and Yellow lines' pale, high-luminance
 * brand colors - everything else is dark enough for white to stay readable.
 * YIQ luminance (ITU-R BT.601 weights) rather than a plain RGB average since
 * the eye is far more sensitive to green than red/blue.
 */
export function readableTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? "#171717" : "#ffffff";
}
