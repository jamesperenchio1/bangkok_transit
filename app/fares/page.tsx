import { getAllData } from "@/lib/data";
import { FareCalculatorClient } from "@/components/fare-calculator-client";

export default async function FaresPage() {
  const data = await getAllData();
  return <FareCalculatorClient initialData={data} />;
}
