/**
 * The one shared arrivals document, published by the poller Durable Object
 * (cloudflare/poller) to R2 and served from Cloudflare's CDN cache. Every
 * client reads this same file; no request ever reaches a server per user.
 * Overridable for local testing against a copy.
 */
export const ARRIVALS_URL =
  process.env.NEXT_PUBLIC_ARRIVALS_URL ?? "https://live.bangkok-transit.com/arrivals.json";
