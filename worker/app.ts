// The paid x402 API for AI agents: the Hono app (worker/index.ts is the Worker
// entry and may export nothing else - see AGENTS.md).
//
// wrangler.jsonc sends only `/api/*` here (`assets.run_worker_first`); every
// other request is a static asset served by Cloudflare without running any
// code, so the website keeps its "requests are free and unlimited" property.
// Each request here is either free (the index), a 402 asking for payment, or a
// paid call - so what it costs to run is paid for by the callers who make it.
//
// Money flow (x402 v2): an unpaid call gets 402 + a PAYMENT-REQUIRED header
// naming the price and our address; the agent signs a USDC transfer and retries
// with PAYMENT-SIGNATURE; the middleware has the facilitator verify it, runs the
// handler, and settles only if the handler succeeded (status < 400). So a
// failed call (unknown station, no current reading) is never charged.
//
// Safety rule: if the payment config is wrong, every paid route answers 503.
// Data is never served for free by accident.
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { paymentMiddlewareFromHTTPServer, x402HTTPResourceServer, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { ArrivalsDocument } from "@/lib/arrivals-document";
import {
  API_BASE, LIVE_ARRIVALS_URL, PAID_ENDPOINTS, apiIndex, arrivalsFacts, lineFacts, routeFacts, stationFacts,
} from "@/lib/paid-api";

export interface Env {
  /** Where payments go: an EVM address (public). */
  X402_PAY_TO: string;
  /** CAIP-2 network: eip155:84532 (Base Sepolia, test) or eip155:8453 (Base mainnet). */
  X402_NETWORK: string;
  /** The facilitator that verifies and settles payments. */
  X402_FACILITATOR_URL: string;
  /** Static assets, for any request that is not /api (defensive: wrangler only routes /api here). */
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

/** Everything under /api belongs to this Worker (wrangler.jsonc `run_worker_first`). */
export const API_PREFIX = "/api";

const NETWORKS: Record<string, { testnet: boolean }> = {
  "eip155:84532": { testnet: true },
  "eip155:8453": { testnet: false },
};

export interface PaymentConfig {
  payTo: string;
  network: string;
  facilitator: string;
  testnet: boolean;
}

export function readConfig(env: Partial<Env>): { ok: true; config: PaymentConfig } | { ok: false; reason: string } {
  const payTo = env.X402_PAY_TO ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) return { ok: false, reason: "X402_PAY_TO is not an EVM address" };
  const network = env.X402_NETWORK ?? "";
  if (!(network in NETWORKS)) return { ok: false, reason: `X402_NETWORK must be one of ${Object.keys(NETWORKS).join(", ")}` };
  const facilitator = env.X402_FACILITATOR_URL ?? "";
  if (!/^https:\/\/[^\s]+$/.test(facilitator)) return { ok: false, reason: "X402_FACILITATOR_URL must be an https URL" };
  return { ok: true, config: { payTo, network, facilitator: facilitator.replace(/\/+$/, ""), testnet: NETWORKS[network].testnet } };
}

const UNAVAILABLE = "Payments are temporarily unavailable. You have not been charged.";

/** A facilitator that does not answer in this long fails the call (uncharged) instead of hanging it. */
const FACILITATOR_TIMEOUT_MS = 10_000;
/** The first paid request waits at most this long for the facilitator sync before answering 503. */
const SYNC_BUDGET_MS = 12_000;

/** Rejects if `promise` has not settled in `ms`; the timer is always cleared. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Builds the app. Exported for tests; the Worker below caches one per configuration. */
export function createApp(env: Partial<Env>): Hono {
  const app = new Hono();
  const parsed = readConfig(env);

  // Agents may call from a browser, so CORS is open and the payment headers are readable.
  app.use(
    `${API_PREFIX}/*`,
    cors({
      origin: "*",
      allowMethods: ["GET", "OPTIONS"],
      allowHeaders: ["Content-Type", "PAYMENT-SIGNATURE", "X-PAYMENT"],
      exposeHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"],
      maxAge: 86400,
    }),
  );
  app.use(`${API_PREFIX}/*`, async (c, next) => {
    await next();
    // The payment middleware answers a facilitator it cannot reach with its own
    // 500 rather than throwing. Nothing was served or settled, and "retry later,
    // you were not charged" is what the caller needs, so say that as a 503.
    if (c.res.status === 500) c.res = c.json({ error: UNAVAILABLE }, 503);
    // A paid response must never be stored and handed to someone who did not pay.
    c.res.headers.set("Cache-Control", "private, no-store");
  });

  app.onError((err, c) => {
    // The facilitator being down or slow lands here: tell the caller, charge nothing.
    console.error("api error", err instanceof Error ? err.message : err);
    return c.json({ error: UNAVAILABLE }, 503);
  });
  app.notFound((c) => c.json({ error: "Not found", index: `${API_BASE}` }, 404));

  if (!parsed.ok) {
    console.error("payments misconfigured:", parsed.reason);
    app.all(`${API_BASE}/*`, (c) => c.json({ error: "Payments are not configured. Nothing has been charged." }, 503));
    app.all(API_BASE, (c) => c.json({ error: "Payments are not configured. Nothing has been charged." }, 503));
    return app;
  }
  const { config } = parsed;

  const server = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: config.facilitator, timeoutMs: FACILITATOR_TIMEOUT_MS }),
  ).register(config.network as `${string}:${string}`, new ExactEvmScheme());

  const routes = Object.fromEntries(
    PAID_ENDPOINTS.map((e) => [
      e.route,
      {
        accepts: { scheme: "exact", price: e.price, network: config.network as `${string}:${string}`, payTo: config.payTo },
        description: e.summary,
        mimeType: "application/json",
      },
    ]),
  );

  const index = (c: Context) =>
    c.json(apiIndex({ network: config.network, payTo: config.payTo, facilitator: config.facilitator, testnet: config.testnet }));
  app.get(API_BASE, index);
  app.get(`${API_BASE}/`, index);

  // The library must sync with the facilitator once (what it supports, who verifies
  // and settles) before it can build a 402. By default it starts that sync as a
  // side effect of creating the middleware, i.e. inside whichever request happened
  // to arrive first - and on Workers a request's in-flight work is cancelled when
  // that request ends. If the first request was the free index, the sync died with
  // it and every later paid request waited on it forever (reproduced under
  // `wrangler dev`). So the Worker owns the sync instead: it starts it from the
  // first PAID request, keeps it alive past that request with `waitUntil`, shares
  // one attempt between concurrent requests, bounds the wait, and lets the next
  // request try again if it failed.
  const httpServer = new x402HTTPResourceServer(server, routes);
  let syncing: Promise<void> | null = null;
  let synced = false;

  function ensureSynced(c: Context): Promise<void> {
    if (synced) return Promise.resolve();
    if (!syncing) {
      const attempt = httpServer.initialize().then(
        () => {
          synced = true;
        },
        (err: unknown) => {
          syncing = null; // the next paid request starts a fresh attempt
          throw err;
        },
      );
      syncing = attempt;
      try {
        c.executionCtx.waitUntil(attempt.catch(() => {}));
      } catch {
        // No ExecutionContext (unit tests call the app directly).
      }
    }
    return syncing;
  }

  const gate: MiddlewareHandler = async (c, next) => {
    try {
      await within(ensureSynced(c), SYNC_BUDGET_MS, "facilitator sync");
    } catch (err) {
      console.error("facilitator sync failed:", err instanceof Error ? err.message : err);
      // Whatever went wrong (rejected, or still pending past the budget), do not
      // keep waiting on this attempt: the next paid request starts a fresh one.
      syncing = null;
      return c.json({ error: UNAVAILABLE }, 503);
    }
    await next();
  };
  // Only the paid routes need the facilitator: the index and unknown paths never trigger it.
  for (const e of PAID_ENDPOINTS) app.use(e.openapiPath.replace(/\{(\w+)\}/g, ":$1"), gate);

  app.use(`${API_BASE}/*`, paymentMiddlewareFromHTTPServer(httpServer, undefined, undefined, false));

  app.get(`${API_BASE}/arrivals`, async (c) => {
    const res = await fetch(LIVE_ARRIVALS_URL, { cf: { cacheTtl: 5, cacheEverything: true } } as RequestInit);
    if (!res.ok) return c.json({ error: "Live arrivals are unavailable right now. You have not been charged." }, 503);
    const result = arrivalsFacts((await res.json()) as ArrivalsDocument, c.req.query("station"));
    return result.ok ? c.json(result.body) : c.json({ error: result.error }, result.status);
  });

  app.get(`${API_BASE}/route`, (c) => {
    const result = routeFacts(c.req.query("from"), c.req.query("to"));
    return result.ok ? c.json(result.body) : c.json({ error: result.error }, result.status);
  });

  app.get(`${API_BASE}/stations/:slug`, (c) => {
    const body = stationFacts(c.req.param("slug"));
    return body ? c.json(body) : c.json({ error: "Unknown station." }, 404);
  });

  app.get(`${API_BASE}/lines/:slug`, (c) => {
    const body = lineFacts(c.req.param("slug"));
    return body ? c.json(body) : c.json({ error: "Unknown line." }, 404);
  });

  return app;
}
