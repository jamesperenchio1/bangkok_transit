import { NextResponse } from "next/server";
import { getManyArrivals } from "@/lib/arrivals-service";
import { liveStations } from "@/data/stations";

/**
 * Bulk arrivals for every station that has a live API, so the client can
 * paint times instantly for any station without a per-station round trip.
 * Response shape: `{ arrivals: { [code]: Arrivals }, stale: { [code]: bool } }`.
 */
export async function GET() {
  try {
    const results = await getManyArrivals(liveStations.map((s) => s.code));

    const arrivals: Record<string, unknown> = {};
    const stale: Record<string, boolean> = {};
    for (const [code, result] of Object.entries(results)) {
      arrivals[code] = result.data;
      if (result.stale) stale[code] = true;
    }

    return NextResponse.json(
      { arrivals, stale },
      // Shared at the edge for 45s so every client sees the same payload
      // without each one re-fetching all 61 stations. 45+45 = 90s, the same
      // window the data is considered fresh for, so nothing served is ever
      // past its useful life.
      {
        headers: {
          "Cache-Control": "public, s-maxage=45, stale-while-revalidate=45",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not reach the arrivals service." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
