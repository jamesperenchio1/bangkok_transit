import type { MetadataRoute } from "next";
import { stations } from "@/data/stations";
import { LINES, absoluteUrl, linePath, routePairs, stationPath } from "@/lib/seo";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  // One build timestamp: the data only changes with a deploy, and a honest
  // lastmod is better than none (Google ignores a lastmod that never changes).
  const lastModified = new Date();
  const entry = (path: string, priority: number, changeFrequency: "weekly" | "monthly" = "monthly") => ({
    url: absoluteUrl(path === "/" ? "/" : path),
    lastModified,
    changeFrequency,
    priority,
  });
  return [
    entry("/", 1, "weekly"),
    entry("/lines", 0.8),
    entry("/stations", 0.8),
    entry("/routes", 0.8),
    ...LINES.map((l) => entry(linePath(l), 0.9)),
    ...stations.map((s) => entry(stationPath(s), 0.6)),
    ...routePairs.map((p) => entry(`/routes/${p.slug}`, 0.7)),
  ];
}
