import type { MetadataRoute } from "next";
import { CONTENT_SIGNAL, SITE_URL } from "@/lib/seo";

export const dynamic = "force-static";

// Everything is public static content, so everything is crawlable - including
// the AI search/answer crawlers, which is how the site gets cited when someone
// asks an assistant how to get around Bangkok by train.
const AI_CRAWLERS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot",
  "Perplexity-User", "Google-Extended", "Applebot-Extended", "Bingbot", "CCBot", "Amazonbot", "meta-externalagent",
  "DuckAssistBot", "cohere-ai", "YouBot", "Bytespider",
];

// Each group repeats the Content-Signal line: a crawler that matches a named
// group ignores the `*` one, so the preference has to be stated in every group.
// It says what the content may be used for (see CONTENT_SIGNAL); access itself
// is still governed by the Allow lines.
const other = { "Content-Signal": CONTENT_SIGNAL };

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", other },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/", other })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
