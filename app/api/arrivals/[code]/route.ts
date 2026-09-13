import { NextRequest, NextResponse } from "next/server";
import { getArrivals } from "@/lib/arrivals-service";
import { stationsByCode } from "@/data/stations";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const station = stationsByCode.get(code);

  if (!station || !station.hasLiveArrivals) {
    return NextResponse.json(
      { error: "Live arrivals are only available for BTS stations." },
      { status: 404 },
    );
  }

  try {
    const { data, stale } = await getArrivals(code);
    return NextResponse.json(
      { ...data, stale },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not reach the arrivals service." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
