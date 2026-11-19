"use client";

import { useState } from "react";
import { LINE_COLORS, LINE_NAMES, LINE_ORDER } from "@/lib/line-colors";

export function MapLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute bottom-2 left-2 z-[900] rounded-lg border border-neutral-200 bg-white/90 text-xs shadow-md backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/90">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 px-2.5 py-1.5 font-medium text-neutral-700 dark:text-neutral-200"
      >
        <span className="h-2.5 w-2.5 rounded-full bg-neutral-400" aria-hidden="true" />
        {open ? "Hide legend" : "Legend"}
      </button>
      {open && (
        <ul className="max-h-64 overflow-y-auto border-t border-neutral-200 px-2.5 py-2 dark:border-neutral-700">
          {LINE_ORDER.map((line) => (
            <li key={line} className="flex items-center gap-2 py-0.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: LINE_COLORS[line] }} aria-hidden="true" />
              <span>{LINE_NAMES[line]}</span>
            </li>
          ))}
          <li className="mt-1 flex items-center gap-2 border-t border-neutral-200 pt-1 text-neutral-500 dark:border-neutral-700">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
            <span>Live BTS (when available)</span>
          </li>
        </ul>
      )}
    </div>
  );
}