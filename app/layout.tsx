import type { Metadata, Viewport } from "next";
import { preconnect, preload } from "react-dom";
import "./globals.css";
import { ARRIVALS_URL } from "@/lib/arrivals-url";

// Must match TransitMap's STYLE_URL exactly, or this preload is wasted.
// (Not imported from there: that module pulls in all of MapLibre.)
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export const metadata: Metadata = {
  title: "Bangkok Transit",
  description: "Plan routes and see live arrivals across every BTS, MRT, and rail line in Bangkok.",
  manifest: "/manifest.json",
};

// Page-wide pinch zoom is disabled so the map component can implement its
// own scoped pinch-zoom/pan instead - otherwise the two gestures fight
// each other and zooming to tap a station also zooms the header/sheet.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
    <html lang="en" className="h-full antialiased">
      <body className="h-full flex flex-col overflow-hidden overscroll-none">{children}</body>
    </html>
  );
}
