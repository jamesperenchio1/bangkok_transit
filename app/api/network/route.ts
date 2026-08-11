/**
 * Network-wide crowding, in one request.
 *
 * The upstream /stations endpoint returns all 60 live stations with their current
 * crowd state in a single ~10KB call, which is why the map warms itself with this
 * instead of fanning out to 60 per-station requests (that pattern trips the 429).
 *
 * Only the crowding is kept — names, codes and positions already ship with the
 * committed schematic, so re-sending them would be dead weight on every load.
 */
import { UPSTREAM } from "@/lib/bts";

const TIMEOUT_MS = 8_000;

interface RawStations {
  lines?: { id?: number; stations?: { code?: string; is_crowded?: boolean; crowd_status?: number }[] }[];
}

export interface NetworkCrowding {
  /** Station code -> crowd level, 0 = normal. Absent codes have no reading. */
  crowding: Record<string, number>;
  fetchedAt: number;
}

export async function GET() {
  try {
    const res = await fetch(`${UPSTREAM}/stations`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);

    const raw = (await res.json()) as RawStations;
    const crowding: Record<string, number> = {};
    for (const line of raw.lines ?? []) {
      for (const s of line.stations ?? []) {
        if (!s.code) continue;
        const level = s.crowd_status ?? (s.is_crowded ? 1 : 0);
        // Siam appears on both lines; keep the busier reading.
        crowding[s.code.toUpperCase()] = Math.max(level, crowding[s.code.toUpperCase()] ?? 0);
      }
    }

    return Response.json(
      { crowding, fetchedAt: Date.now() } satisfies NetworkCrowding,
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
    );
  } catch (err) {
    console.error("network crowding failed", err);
    // Crowding is decoration — the map is fully usable without it, so degrade
    // to empty rather than failing the request.
    return Response.json(
      { crowding: {}, fetchedAt: Date.now() } satisfies NetworkCrowding,
      { headers: { "Cache-Control": "public, s-maxage=30" } }
    );
  }
}
