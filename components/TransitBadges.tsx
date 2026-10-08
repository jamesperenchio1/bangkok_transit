import { ArrowLeftRight, Footprints } from "lucide-react";
import type { LineKey } from "@/data/stations";
import { LINE_COLORS, readableTextColor } from "@/lib/line-colors";
import { lineName, useT } from "@/lib/i18n";

/**
 * The interchange sign: two opposing arrows in a white disc with a dark
 * ring - the same badge the map draws at each change on a route (see
 * drawTransferIcon in TransitMap), so the list and the map read alike. A
 * walking transfer gets a walking figure instead.
 */
export function TransferIcon({ walk = false, size = 22 }: { walk?: boolean; size?: number }) {
  const Icon = walk ? Footprints : ArrowLeftRight;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border-2 border-neutral-800 bg-white text-neutral-900"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.6)} strokeWidth={2.75} />
    </span>
  );
}

/** A line's name on its brand color, so same-colored lines (two greens, two purples) stay distinguishable. */
export function LinePill({ line, short = false, className }: { line: LineKey; short?: boolean; className?: string }) {
  const { lang } = useT();
  const color = LINE_COLORS[line];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${className ?? ""}`}
      style={{ backgroundColor: color, color: readableTextColor(color) }}
    >
      {lineName(line, lang, short)}
    </span>
  );
}
