import { getAllData } from "@/lib/data";
import { TransitMapLoader } from "@/components/transit-map-loader";

export default async function Home() {
  const data = await getAllData();
  return <TransitMapLoader initialData={data} />;
}
