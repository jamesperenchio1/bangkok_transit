/**
 * Report intake for bangkok-transit.com.
 *
 * Deliberately tiny and static-friendly: the site itself has no server, so
 * this Worker is the only place a rider's report touches. It stores the JSON
 * in R2 and does no processing; the endpoint is optional (the app hides the
 * Send button unless NEXT_PUBLIC_REPORT_URL is set).
 *
 * Abuse: the body is size-capped and validated. Put a Cloudflare Rate Limiting
 * rule (or WAF) in front of /report before enabling the button in production.
 * Turnstile can be added later without changing the client payload.
 */

interface Env {
  REPORTS: R2Bucket;
}

const MAX_BODY_BYTES = 8 * 1024;
const ALLOWED_ORIGINS = new Set([
  "https://bangkok-transit.com",
  "https://www.bangkok-transit.com",
]);

function cors(origin: string | null): Headers {
  const headers = new Headers();
  headers.set("access-control-allow-origin", origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://bangkok-transit.com");
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("vary", "origin");
  return headers;
}

function json(body: unknown, status: number, origin: string | null): Response {
  const headers = cors(origin);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin");
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (url.pathname === "/health") {
      return json({ ok: true }, 200, origin);
    }
    if (url.pathname !== "/report" || request.method !== "POST") {
      return json({ error: "not found" }, 404, origin);
    }

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return json({ error: "too large" }, 413, origin);

    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return json({ error: "too large" }, 413, origin);
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return json({ error: "invalid json" }, 400, origin);
    }

    const str = (key: string, max: number) =>
      typeof body[key] === "string" ? (body[key] as string).slice(0, max) : "";
    const category = str("category", 32);
    const details = str("details", 1000);
    if (!category && !details) return json({ error: "empty report" }, 400, origin);

    // Store only the fields the sheet already builds, normalised. No IP,
    // cookies or headers are kept.
    const report = {
      category,
      details,
      pageUrl: str("pageUrl", 500),
      timestamp: str("timestamp", 40) || new Date().toISOString(),
      lang: body.lang === "th" ? "th" : "en",
      mapProvider: body.mapProvider === "google" ? "google" : body.mapProvider === "standard" ? "standard" : null,
      startCode: str("startCode", 16) || null,
      destinationCode: str("destinationCode", 16) || null,
      focusStationCode: str("focusStationCode", 16) || null,
      routeMinutes: typeof body.routeMinutes === "number" ? body.routeMinutes : null,
      routeChanges: typeof body.routeChanges === "number" ? body.routeChanges : null,
      arrivalsAgeMs: typeof body.arrivalsAgeMs === "number" ? body.arrivalsAgeMs : null,
      online: body.online === true,
      userAgent: str("userAgent", 300) || null,
      appVersion: str("appVersion", 40),
      receivedAt: new Date().toISOString(),
    };

    const day = report.receivedAt.slice(0, 10);
    const key = `reports/${day}/${Date.now()}-${crypto.randomUUID()}.json`;
    await env.REPORTS.put(key, JSON.stringify(report), {
      httpMetadata: { contentType: "application/json" },
    });

    return json({ ok: true }, 202, origin);
  },
};

export default worker;
