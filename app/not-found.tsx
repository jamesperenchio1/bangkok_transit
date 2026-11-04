import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl flex-1 overflow-y-auto px-4 py-16">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="mt-3">That page doesn&apos;t exist. Try the map, or browse the lines and stations.</p>
      <ul className="mt-4 list-disc pl-5">
        <li><Link href="/" className="underline underline-offset-2">Bangkok Transit map and route planner</Link></li>
        <li><Link href="/lines" className="underline underline-offset-2">All lines</Link></li>
        <li><Link href="/stations" className="underline underline-offset-2">All stations</Link></li>
        <li><Link href="/routes" className="underline underline-offset-2">Popular routes</Link></li>
      </ul>
    </main>
  );
}
