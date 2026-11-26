import type { Metadata } from "next";

/**
 * The offline fallback exists for one failed navigation (app/sw.ts) and has no
 * content of its own, so it must never be a search result. The directive lives
 * in this layout because page.tsx is a client component (its copy follows the
 * rider's language) and a route cannot export `metadata` from one.
 */
export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false, follow: false },
};

export default function OfflineLayout({ children }: { children: React.ReactNode }) {
  return children;
}
