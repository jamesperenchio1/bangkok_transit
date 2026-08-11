import { getAllData } from "@/lib/data";
import { TransitMapLoader } from "@/components/transit-map-loader";

/**
 * The geographic map: every operator (MRT, ARL, SRT, BRT, boats, buses), drawn
 * on real coordinates. It used to be the home page; the BTS route map took that
 * slot, so this keeps it reachable rather than orphaning it.
 *
 * Deliberately not the landing page: it pulls in Leaflet and the full canonical
 * dataset, which is exactly the weight the route map exists to avoid.
 */
export default async function GeographicMapPage() {
  const data = await getAllData();
  return <TransitMapLoader initialData={data} />;
}
