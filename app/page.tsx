import { RouteMapClient } from "@/components/route-map-client";
import { getStationInfoByCode } from "@/lib/station-info";

// Static station facts only; live arrivals are fetched client-side per station.
export const revalidate = false;

export default async function RouteMapPage() {
  const stationInfo = await getStationInfoByCode();
  return <RouteMapClient stationInfo={stationInfo} />;
}
