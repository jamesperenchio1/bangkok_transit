import { HomeClient } from "@/components/HomeClient";
import { renderNetworkSvg } from "@/lib/network-svg";

// The v2 preview: the same app with the station sheet variant switched on.
// Server component for the same reason as the home page - the build-time
// network SVG is rendered here, and there is no SEO block because /v2 is
// noindex (see layout.tsx).
export default function PreviewPage() {
  const networkSvg = renderNetworkSvg();

  return <HomeClient networkSvg={networkSvg} variant="v2" />;
}
