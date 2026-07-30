import { getAllData, getLineById } from "@/lib/data";
import { AlertsClient } from "@/components/alerts-client";
import type { Line } from "@/data/schemas";

export default async function AlertsPage() {
  const data = await getAllData();
  const alertsWithLines = data.alerts.map((alert) => ({
    alert,
    lines: alert.lineIds
      .map((id) => getLineById(data.lines, id))
      .filter((line): line is Line => line !== undefined),
  }));
  return <AlertsClient alertsWithLines={alertsWithLines} />;
}
