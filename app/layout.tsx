import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col overflow-hidden overscroll-none">{children}</body>
    </html>
  );
}
