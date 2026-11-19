"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Copy, Mail, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  buildReportContext,
  formatReport,
  reportMailto,
  type ReportContext,
  type ReportContextInput,
} from "@/lib/report-context";

const CATEGORIES = [
  { key: "route", labelKey: "reportCatRoute" as const },
  { key: "station", labelKey: "reportCatStation" as const },
  { key: "live", labelKey: "reportCatLive" as const },
  { key: "map", labelKey: "reportCatMap" as const },
  { key: "search", labelKey: "reportCatSearch" as const },
  { key: "other", labelKey: "reportCatOther" as const },
];

const SAVED_KEY = "bts:report:saved:v1";

interface Props {
  context?: Omit<ReportContextInput, "category" | "details" | "includeDevice">;
  trigger?: "floating" | "link" | "header" | "none";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialCategory?: string;
  className?: string;
  label?: string;
}

interface SheetProps {
  context: Omit<ReportContextInput, "category" | "details" | "includeDevice">;
  initialCategory: string;
  onClose: () => void;
}

function ReportSheet({ context, initialCategory, onClose }: SheetProps) {
  const { t } = useT();
  const [category, setCategory] = useState(initialCategory);
  const [details, setDetails] = useState("");
  const [includeDevice, setIncludeDevice] = useState(true);
  const [showContext, setShowContext] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const ctx: ReportContext = buildReportContext({
    ...context,
    category,
    details,
    includeDevice,
  });

  const text = formatReport(ctx);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  const handleSave = () => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(ctx));
      setSaved(true);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={t.reportTitle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-neutral-900 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-white">{t.reportTitle}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <p className="mb-2 text-xs font-semibold text-neutral-700 dark:text-neutral-300">{t.reportCategories}</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                className={`min-h-11 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  category === c.key
                    ? "border-green-600 bg-green-50 text-green-800 dark:border-green-500 dark:bg-green-950 dark:text-green-300"
                    : "border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {t[c.labelKey]}
              </button>
            ))}
          </div>

          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300" htmlFor="report-details">
            {t.reportDetails}
          </label>
          <textarea
            id="report-details"
            ref={textareaRef}
            value={details}
            onChange={(e) => setDetails(e.target.value.slice(0, 500))}
            placeholder={t.reportDetailsPlaceholder}
            rows={3}
            className="mb-4 w-full resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-green-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-white"
          />

          <div className="mb-3 rounded-lg border border-neutral-200 dark:border-neutral-800">
            <button
              type="button"
              onClick={() => setShowContext((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
            >
              <span>{t.reportContext}</span>
              {showContext ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showContext && (
              <div className="border-t border-neutral-200 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
                <pre className="whitespace-pre-wrap break-words font-mono">{text}</pre>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={includeDevice}
              onChange={(e) => setIncludeDevice(e.target.checked)}
              className="h-4 w-4"
            />
            {t.reportIncludeDevice}
          </label>
        </div>

        <div
          className="border-t border-neutral-200 px-4 py-3 dark:border-neutral-800"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-800"
            >
              <Copy size={16} aria-hidden="true" />
              {copied ? t.reportCopied : t.reportCopy}
            </button>
            <a
              href={reportMailto(ctx)}
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <Mail size={16} aria-hidden="true" />
              {t.reportEmail}
            </a>
            <button
              type="button"
              onClick={handleSave}
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              {saved ? t.reportSaved : t.reportSave}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ReportIssue({
  context = {},
  trigger = "link",
  open: openProp,
  onOpenChange,
  initialCategory = "other",
  className,
  label,
}: Props) {
  const { t } = useT();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else setInternalOpen(v);
  };

  const triggerButton =
    trigger === "floating" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.reportIssue}
        className={`fixed z-40 flex h-11 min-w-11 items-center gap-1.5 rounded-full border border-neutral-300 bg-white/90 px-3 text-xs font-semibold text-neutral-700 shadow-md backdrop-blur hover:bg-white dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-200 ${className ?? ""}`}
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)", right: "12px" }}
      >
        <AlertTriangle size={16} aria-hidden="true" />
        <span className="hidden sm:inline">{t.report}</span>
      </button>
    ) : trigger === "header" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.reportIssue}
        className={`inline-flex h-11 items-center gap-1.5 rounded-full border border-neutral-300 px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800 ${className ?? ""}`}
      >
        <AlertTriangle size={14} aria-hidden="true" />
        <span>{t.report}</span>
      </button>
    ) : trigger === "link" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 ${className ?? ""}`}
      >
        <AlertTriangle size={12} aria-hidden="true" />
        {label ?? t.report}
      </button>
    ) : null;

  return (
    <>
      {trigger !== "none" && triggerButton}
      {open && (
        <ReportSheet
          context={context}
          initialCategory={initialCategory}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
