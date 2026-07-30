import { getAllData, getStationById } from "@/lib/data";
import { TouristClient } from "@/components/tourist-client";

export default async function TouristPage() {
  const data = await getAllData();
  const touristPlaces = data.places
    .filter((p) => ["tourist_attraction", "shopping", "park"].includes(p.category))
    .map((p) => ({
      place: p,
      station: p.nearbyStationIds.length > 0 ? getStationById(data.stations, p.nearbyStationIds[0]) : undefined,
    }));
  return <TouristClient places={touristPlaces} lines={data.lines} />;
}
