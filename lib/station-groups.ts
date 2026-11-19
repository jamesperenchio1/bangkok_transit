import { stationsByCode, type LineKey, type Station } from "@/data/stations";
import sequences from "@/data/line-sequences.json";
import { LINE_ORDER } from "@/lib/line-colors";

export interface StationGroup {
  line: LineKey;
  stations: Station[];
}

/** Every station grouped by line in running order (branches follow the trunk, interchanges listed once per line). */
export function stationsByLine(): StationGroup[] {
  const seqs = sequences as Record<string, string[][]>;
  return LINE_ORDER.map((line) => {
    const seen = new Set<string>();
    const list: Station[] = [];
    for (const segment of seqs[line] ?? []) {
      for (const code of segment) {
        const station = stationsByCode.get(code);
        if (station && !seen.has(code)) {
          seen.add(code);
          list.push(station);
        }
      }
    }
    return { line, stations: list };
  });
}
