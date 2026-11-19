import { HomeClient } from "@/components/HomeClient";
import { SeoContent } from "@/components/SeoContent";
import { renderNetworkSvg } from "@/lib/network-svg";

// A server component on purpose: the interactive map lives in <HomeClient>,
// while the crawlable text is rendered here, at build time, and passed in.
export default function Home() {
  // Inline SVG of the network, built from the same geometry the map uses.
  // It ships in the HTML so the lines are visible before any map JS runs.
  const networkSvg = renderNetworkSvg();

  return (
    <HomeClient networkSvg={networkSvg}>
      <SeoContent />
    </HomeClient>
  );
}
