import { stations, type LineKey } from "@/data/stations";

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
  srtDarkRed: "#a5122a",
  srtLightRed: "#e8656f",
};

const DARK_TEXT = "#171717";
const LIGHT_TEXT = "#ffffff";

/** WCAG 2 relative luminance of a #rrggbb colour. */
function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG 2 contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The text colour (white or near-black) that reads best on `hex`, by WCAG
 * contrast ratio. A luminance cut-off is not enough: BTS Sukhumvit green
 * (#76b729) sits just under a typical YIQ threshold and got white text at
 * 2.4:1, far below the 4.5:1 that small text needs. Picking whichever of the
 * two has the higher ratio is right for every line colour, pale or dark.
 */
export function readableTextColor(hex: string): string {
  return contrastRatio(hex, LIGHT_TEXT) >= contrastRatio(hex, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

/**
 * Human-readable line names ("BTS Sukhumvit Line"), so a line is never
 * identified by colour alone - screen readers and colour-blind users get the
 * name as text. Derived from the station data, which already carries them.
 */
export const LINE_NAMES: Record<LineKey, string> = (() => {
  const names = {} as Record<LineKey, string>;
  for (const s of stations) for (const l of s.lines) names[l.line] ??= l.name;
  return names;
})();

/** Display order for grouping stations by line. */
export const LINE_ORDER: LineKey[] = ["sukhumvit", "silom", "gold", "yellow", "pink", "blue", "purple", "arl", "srtDarkRed", "srtLightRed"];
