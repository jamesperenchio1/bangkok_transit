import { getAllData } from "@/lib/data";
import { RoutePlannerClient } from "@/components/route-planner-client";

interface RoutePageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

export default async function RoutePage({ searchParams }: RoutePageProps) {
  const data = await getAllData();
  const { from, to } = await searchParams;
  return <RoutePlannerClient initialData={data} initialFrom={from || ""} initialTo={to || ""} />;
}
