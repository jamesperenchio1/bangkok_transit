import type { ReportContext } from "./report-context";

/**
 * Optional one-tap delivery for the report sheet.
 *
 * The app is static, so this posts to a small Worker (cloudflare/report)
 * that stores the report in R2. Unset (the default) keeps the sheet exactly
 * as it was: copy / email / save locally. Nothing is ever sent silently.
 */
export function reportEndpoint(): string {
  return (process.env.NEXT_PUBLIC_REPORT_URL ?? "").replace(/\/+$/, "");
}

export function reportDeliveryEnabled(): boolean {
  return reportEndpoint() !== "";
}

/** Returns true only when the Worker accepted the report. */
export async function sendReport(ctx: ReportContext): Promise<boolean> {
  const endpoint = reportEndpoint();
  if (!endpoint) return false;
  try {
    const response = await fetch(`${endpoint}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // No credentials and no cookies: the report is the whole payload.
      body: JSON.stringify(ctx),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
