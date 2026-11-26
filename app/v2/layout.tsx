import type { Metadata } from "next";
import { PreviewBadge } from "@/components/v2/PreviewBadge";

// A design preview, not a page people should land on from search: noindex
// here and no sitemap entry (app/sitemap.ts lists routes explicitly).
export const metadata: Metadata = {
  title: "Station sheet preview",
  description: "Preview of the native bottom-sheet station card. Not part of the public app.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/v2" },
};

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <PreviewBadge />
    </>
  );
}
