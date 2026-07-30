import { notFound } from "next/navigation";
import { getAllData, getStationById, getExitsByStationId, getFacilityByStationId, getParkingByStationId, getPlacesByStationId, getAlertsForStation } from "@/lib/data";
import { StationDetailClient } from "@/components/station-detail-client";

interface StationPageProps {
  params: Promise<{ id: string }>;
}

export async function generateStaticParams() {
  const { stations } = await getAllData();
  return stations.map((s) => ({ id: s.id }));
}

export default async function StationPage({ params }: StationPageProps) {
  const { id } = await params;
  const data = await getAllData();
  const station = getStationById(data.stations, id);
  if (!station) return notFound();

  return (
    <StationDetailClient
      station={station}
      lines={data.lines}
      exits={getExitsByStationId(data.exits, id)}
      facility={getFacilityByStationId(data.facilities, id)}
      parking={getParkingByStationId(data.parking, id)}
      places={getPlacesByStationId(data.places, id)}
      alerts={getAlertsForStation(data.alerts, id)}
      timetables={data.timetables}
    />
  );
}
