import { getAllData } from "@/lib/data";
import { DashboardClient } from "@/components/dashboard-client";

export default async function Home() {
  const data = await getAllData();
  return <DashboardClient initialData={data} />;
}
