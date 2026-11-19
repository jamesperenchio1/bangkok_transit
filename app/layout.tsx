import type { Metadata, Viewport } from "next";
import { preconnect, preload } from "react-dom";
import "./globals.css";
import { ARRIVALS_URL } from "@/lib/arrivals-url";
import { JsonLd } from "@/components/JsonLd";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL, siteLd } from "@/lib/seo";

// Must match TransitMap's STYLE_URL exactly, or this preload is wasted.
// (Not imported from there: that module pulls in all of MapLibre.)
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Pages that set a plain `title` get the brand appended; the home page's
  // `default` is the keyword-rich headline.
  title: { default: SITE_TAGLINE, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "Bangkok BTS map", "BTS Skytrain", "MRT Bangkok", "Bangkok metro map", "Bangkok train route planner",
    "BTS live arrivals", "Airport Rail Link", "SRT Red Line", "Bangkok to Suvarnabhumi by train",
    "แผนที่รถไฟฟ้า", "รถไฟฟ้าบีทีเอส", "รถไฟฟ้ามหานคร",
  ],
  category: "travel",
  alternates: { canonical: `${SITE_URL}/`, types: { "text/markdown": `${SITE_URL}/md/index.md` } },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: SITE_URL,
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
    locale: "en_US",
    alternateLocale: ["th_TH"],
    images: [{ url: "/og/og-default.png", width: 1200, height: 630, alt: "Bangkok Transit: BTS, MRT and rail map with live arrivals" }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
    images: ["/og/og-default.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  },
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }, { url: "/favicon.ico" }],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "BKK Transit", statusBarStyle: "default" },
};

// Page zoom stays enabled (WCAG 1.4.4): people with low vision rely on it.
// The map canvas sets `touch-action: none`, so pinching on the map zooms the
// map while pinching anywhere else zooms the page.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets env(safe-area-inset-*) report the notch / home indicator so the header and bottom controls can clear them.
  viewportFit: "cover",
  themeColor: "#76b729",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // The map can't start until its JS chunk and its style JSON have arrived.
  // Hinting the style here lets it download while the page is still
  // hydrating. crossOrigin matches how MapLibre requests it, so the
  // preloaded response is actually reused. (The line geometry is fetched by
  // app/page.tsx as soon as it loads - a preload for it went unused, because
  // the map only asks for it after its own load event, and was downloaded
  // twice.)
  preconnect("https://tiles.openfreemap.org", { crossOrigin: "anonymous" });
  preload(MAP_STYLE_URL, { as: "fetch", crossOrigin: "anonymous" });
  // Live times too: a different origin (the CDN-cached data host), so its
  // connection is opened up front. Not preloaded as a resource - the
  // client fetches it with cache: "no-store", which a preload can't satisfy.
  preconnect(new URL(ARRIVALS_URL).origin, { crossOrigin: "anonymous" });

  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme and text size before first paint, so a
            rider who chose dark on a light phone doesn't see a light flash.
            Tiny, synchronous, and wrapped in try/catch: storage can be blocked. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var s=JSON.parse(localStorage.getItem("bts:settings:v1")||"{}"),r=document.documentElement;if(s.theme==="light"||s.theme==="dark")r.setAttribute("data-theme",s.theme);if(typeof s.textSize==="number"&&s.textSize>=90&&s.textSize<=150&&s.textSize!==100)r.style.fontSize=s.textSize+"%"}catch(e){}',
          }}
        />
      </head>
      <body className="h-full flex flex-col overflow-hidden overflow-clip overscroll-none">
        {children}
        <JsonLd data={siteLd()} />
      </body>
    </html>
  );
}
