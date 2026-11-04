import { HomeClient } from "@/components/HomeClient";
import { SeoContent } from "@/components/SeoContent";

// A server component on purpose: the interactive map lives in <HomeClient>,
// while the crawlable text is rendered here, at build time, and passed in.
export default function Home() {
  return (
    <HomeClient>
      <SeoContent />
    </HomeClient>
  );
}
