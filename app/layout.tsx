import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Thai, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { LanguageProvider } from "@/components/language-provider";
import { NavBar } from "@/components/nav-bar";

// One family across both scripts. The UI is fully bilingual and Thai sits inline
// with Latin throughout (station names, directions), so a Latin-only face would
// fall back to a mismatched system Thai font at different metrics on every label.
const sans = IBM_Plex_Sans_Thai({
  variable: "--font-plex-sans",
  subsets: ["latin", "thai"],
  // Only the weights actually used. Each extra weight ships a full Thai glyph
  // set, and fonts were the single heaviest asset on the page before trimming.
  weight: ["400", "500", "600"],
  display: "swap",
});

// Used for arrival countdowns, which re-render every second. Tabular figures keep
// the digits from shifting width as they tick down.
const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  // Latin only — this face renders digits and station codes, never Thai.
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Bangkok Transit",
  description:
    "The BTS Skytrain route map with live train arrivals, station accessibility, facilities, and exits.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Bangkok Transit",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col overflow-x-hidden bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <LanguageProvider>
            <NavBar />
            <main className="flex-1 flex flex-col">{children}</main>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
