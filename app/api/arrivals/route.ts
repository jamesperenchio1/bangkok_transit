import { NextResponse } from "next/server";
import { isValidArrivals, type Arrivals } from "@/lib/bts";
import { readCachedMany } from "@/lib/arrivals-cache";
import { liveStations } from "@/data/stations";

/**
 * Bulk snapshot of every live-arrivals station's Redis-cached data in one
 * round trip, so the client can prime its cache before any station is ever
 * tapped instead of paying a network wait on first popup open. Never falls
 * back to the slow upstream API on a miss - a station simply absent from
 * the response falls back to the existing per-station route unchanged.
 */
export async function GET() {
  try {
    const codes = liveStations.map((s) => s.code);
    const raw = await readCachedMany(codes);
    const out: Record<string, Arrivals> = {};
    for (const [code, data] of Object.entries(raw)) {
      if (isValidArrivals(data)) out[code] = data;
    }
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({}, { headers: { "Cache-Control": "no-store" } });
  }
}
