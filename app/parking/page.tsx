import { getAllData, getStationById } from "@/lib/data";
import { ParkingClient } from "@/components/parking-client";

export default async function ParkingPage() {
  const data = await getAllData();
  const parkingWithStations = data.parking
    .map((p) => ({ parking: p, station: getStationById(data.stations, p.stationId)! }))
    .filter((x) => x.station);
  return <ParkingClient parkingWithStations={parkingWithStations} lines={data.lines} />;
}
