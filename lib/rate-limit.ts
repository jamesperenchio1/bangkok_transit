import { Ratelimit } from "@upstash/ratelimit";
import type { NextRequest } from "next/server";
import { redis } from "./arrivals-cache";

/**
 * Guards the arrivals API against a traffic burst fanning out into many
 * simultaneous upstream BTS API calls or Redis commands - the single-flight
 * de-dupe in lib/arrivals-service.ts only dedupes within one serverless
 * instance, so a burst spread across many instances isn't caught there.
 * Reuses the same Redis instance already configured for arrivals caching
 * (see lib/arrivals-cache.ts), so this needs no new infra.
 *
 * The window is generous enough to comfortably cover one legitimate
 * visitor's own fast-poll burst (~15 requests in the first 30s, see
 * lib/arrivals-store.ts's FAST_POLL_MS/MAX_FAST_POLLS) while still bounding
 * a script hammering the endpoint.
 *
 * Fails open when Redis isn't configured (dev has no env vars), matching
 * this app's existing fail-safe posture around optional caching.
 */
const ratelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(40, "60 s"),
      analytics: false,
      prefix: "bts:ratelimit",
    })
  : null;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the caller should wait before retrying; 0 when allowed. */
  retryAfterSeconds: number;
}

export async function checkRateLimit(identifier: string): Promise<RateLimitResult> {
  if (!ratelimit) return { allowed: true, retryAfterSeconds: 0 };
  const { success, reset } = await ratelimit.limit(identifier);
  return {
    allowed: success,
    retryAfterSeconds: success ? 0 : Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
  };
}

/** Best-effort client identifier from Vercel's forwarded-for header; falls back to a shared bucket if absent (e.g. local dev with no proxy in front). */
export function clientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  return forwardedFor ? forwardedFor.split(",")[0].trim() : "unknown";
}
