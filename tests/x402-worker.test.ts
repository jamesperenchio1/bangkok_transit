import type { ExecutionContext } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, readConfig, type Env } from "../worker/app";
import worker from "../worker/index";
import { LIVE_ARRIVALS_URL, PAID_ENDPOINTS } from "@/lib/paid-api";
import type { ArrivalsDocument } from "@/lib/arrivals-document";

const PAY_TO = "0x941eb61c0052da28d09e39f7ddc946a9631a5eeb";
const FACILITATOR = "https://facilitator.test";
const env: Env = { X402_PAY_TO: PAY_TO, X402_NETWORK: "eip155:84532", X402_FACILITATOR_URL: FACILITATOR };
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

interface Calls { verify: unknown[]; settle: unknown[]; arrivals: number; supported: number }
let calls: Calls;
let facilitatorMode: "ok" | "reject" | "down";
/** How /settle behaves after a payment verified fine: succeeds, is refused, or the network fails. */
let settleMode: "ok" | "refuse" | "network-error";
/** The live arrivals document never answers, or answers headers and then stalls the body. */
let arrivalsMode: "ok" | "stall-headers" | "stall-body";
/** Failures to inject into the next /supported calls (a failing, then recovering, facilitator). */
let supportedFailures = 0;
/** When set, /supported never answers until released (a facilitator that hangs). */
let stallSupported: Promise<void> | null = null;

const liveDoc = (): ArrivalsDocument => ({
  arrivals: {
    N8: {
      station: { code: "N8", name_en: "Mo Chit", name_th: "หมอชิต", line_color: "#76b729" },
      platforms: [],
      near_end_of_service: false,
      service_active: true,
      next_service: "",
      server_time: "09/11/2026 15:00",
      timestamp: new Date().toISOString().replace("Z", ""),
    },
  },
  total: 1,
  complete: true,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls = { verify: [], settle: [], arrivals: 0, supported: 0 };
  facilitatorMode = "ok";
  settleMode = "ok";
  arrivalsMode = "ok";
  supportedFailures = 0;
  stallSupported = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === LIVE_ARRIVALS_URL) {
        calls.arrivals++;
        const aborted = (reject: (e: unknown) => void) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")));
        if (arrivalsMode === "stall-headers") return new Promise<Response>((_, reject) => aborted(reject));
        if (arrivalsMode === "stall-body") {
          // Headers arrive, the body never finishes; aborting the request errors the stream, as a real fetch does.
          const body = new ReadableStream({
            start(controller) {
              aborted((e) => controller.error(e));
            },
          });
          return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
        }
        return json(liveDoc());
      }
      if (!url.startsWith(FACILITATOR)) throw new Error(`unexpected fetch ${url}`);
      if (facilitatorMode === "down") throw new TypeError("facilitator unreachable");
      const path = url.slice(FACILITATOR.length);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (path === "/supported") {
        calls.supported++;
        if (stallSupported) await stallSupported;
        if (supportedFailures > 0) {
          supportedFailures--;
          return json({ error: "boom" }, 500);
        }
        return json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }], extensions: [], signers: { "eip155:*": ["0xFac"] } });
      }
      if (path === "/verify") {
        calls.verify.push(body);
        return json(facilitatorMode === "reject" ? { isValid: false, invalidReason: "invalid_signature" } : { isValid: true, payer: "0xPayer" });
      }
      if (path === "/settle") {
        calls.settle.push(body);
        if (settleMode === "network-error") throw new TypeError("settlement connection lost");
        if (settleMode === "refuse") {
          return json({ success: false, errorReason: "insufficient_funds", transaction: "", network: "eip155:84532", payer: "0xPayer" });
        }
        return json({ success: true, transaction: "0xabc123", network: "eip155:84532", payer: "0xPayer" });
      }
      return json({ error: "not found" }, 404);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const decode = (header: string | null) => JSON.parse(Buffer.from(header ?? "", "base64").toString("utf8"));

/** What a paying agent does: read the 402, sign (here: a stand-in), retry with the signature. */
async function pay(app: ReturnType<typeof createApp>, path: string) {
  const unpaid = await app.request(path, {}, env);
  expect(unpaid.status).toBe(402);
  const required = decode(unpaid.headers.get("payment-required"));
  const header = Buffer.from(
    JSON.stringify({ x402Version: 2, resource: required.resource, accepted: required.accepts[0], payload: { signature: "0xsig", authorization: {} } }),
  ).toString("base64");
  return app.request(path, { headers: { "PAYMENT-SIGNATURE": header } }, env);
}

describe("unpaid requests", () => {
  it("get a 402 naming our address, the network, USDC and the exact price", async () => {
    const app = createApp(env);
    for (const e of PAID_ENDPOINTS) {
      const res = await app.request(e.example, {}, env);
      expect(res.status, e.id).toBe(402);
      const required = decode(res.headers.get("payment-required"));
      expect(required.x402Version, e.id).toBe(2);
      const accept = required.accepts[0];
      expect(accept.scheme).toBe("exact");
      expect(accept.network).toBe("eip155:84532");
      expect(accept.payTo.toLowerCase()).toBe(PAY_TO);
      expect(accept.asset).toBe(USDC_BASE_SEPOLIA);
      // USDC has 6 decimals: $0.002 -> 2000.
      expect(accept.amount, e.id).toBe(String(Math.round(Number(e.price.slice(1)) * 1_000_000)));
    }
    expect(calls.arrivals).toBe(0);
  });

  it("never reach a handler: every paid route on the app is behind payment", async () => {
    const app = createApp(env);
    const paidRoutes = app.routes.filter((r) => r.method === "GET" && r.path !== "/api/v1" && r.path !== "/api/v1/");
    expect(paidRoutes.length).toBe(PAID_ENDPOINTS.length);
    for (const r of paidRoutes) {
      const res = await app.request(r.path.replace(/:\w+/g, "siam-cen") + "?station=N8&from=N8&to=CEN", {}, env);
      expect(res.status, r.path).toBe(402);
    }
    expect(calls.arrivals).toBe(0);
  });

  it("are answered the same way for a browser", async () => {
    const res = await createApp(env).request("/api/v1/route?from=N8&to=CEN", { headers: { accept: "text/html" } }, env);
    expect(res.status).toBe(402);
  });
});

describe("paid requests", () => {
  it("return the data, settle exactly once, and say so in PAYMENT-RESPONSE", async () => {
    const app = createApp(env);
    for (const e of PAID_ENDPOINTS) {
      calls.verify.length = 0;
      calls.settle.length = 0;
      const res = await pay(app, e.example);
      expect(res.status, e.id).toBe(200);
      expect(calls.verify, e.id).toHaveLength(1);
      expect(calls.settle, e.id).toHaveLength(1);
      expect(decode(res.headers.get("payment-response")).success, e.id).toBe(true);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("serve live arrivals from the shared document", async () => {
    const res = await pay(createApp(env), "/api/v1/arrivals?station=N8");
    const body = (await res.json()) as { station: { code: string }; lastKnown: boolean };
    expect(body.station.code).toBe("N8");
    expect(body.lastKnown).toBe(false);
    expect(calls.arrivals).toBe(1);
  });

  it("do not charge when the call fails: unknown station, no reading, bad request", async () => {
    const app = createApp(env);
    for (const path of ["/api/v1/stations/not-a-station", "/api/v1/arrivals?station=N9", "/api/v1/route?from=N8", "/api/v1/lines/nope"]) {
      calls.settle.length = 0;
      const res = await pay(app, path);
      expect(res.status, path).toBeGreaterThanOrEqual(400);
      expect(res.status, path).toBeLessThan(500);
      expect(calls.settle, `${path} was settled`).toHaveLength(0);
    }
  });
});

describe("when something is wrong, nobody gets data for free and nobody is charged for nothing", () => {
  it("a payment the facilitator rejects gets a 402 and no data", async () => {
    facilitatorMode = "reject";
    const res = await pay(createApp(env), "/api/v1/route?from=N8&to=CEN");
    expect(res.status).toBe(402);
    expect(await res.text()).not.toContain("minutes");
    expect(calls.settle).toHaveLength(0);
  });

  // The payment verified, the handler ran and produced data - then settlement (the
  // actual transfer) fails. The data must not be handed over for a payment that did
  // not complete.
  it.each([
    ["is refused by the facilitator", "refuse"],
    ["fails on the network", "network-error"],
  ] as const)("when settlement %s after a good verification, the caller gets no data", async (_label, mode) => {
    settleMode = mode;
    const app = createApp(env);
    for (const e of PAID_ENDPOINTS) {
      calls.settle.length = 0;
      const res = await pay(app, e.example);
      const text = await res.text();
      expect(res.status, `${e.id} status`).toBeGreaterThanOrEqual(400);
      // None of the handlers' payloads (a route's minutes, a station's neighbours, a reading, a line's stations).
      for (const leaked of ["minutes", "neighbours", "terminalStations", "ageSeconds", "Mo Chit"]) {
        expect(text, `${e.id} leaked "${leaked}"`).not.toContain(leaked);
      }
      expect(calls.settle, `${e.id}: settlement was attempted`).toHaveLength(1);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it.each([
    ["never answers", "stall-headers"],
    ["answers, then stalls its body", "stall-body"],
  ] as const)("a live feed that %s gives a quick 503, nothing settled, nothing served", async (_label, mode) => {
    vi.useFakeTimers();
    try {
      arrivalsMode = mode;
      const app = createApp(env);
      // Sign and pay for the arrivals call first (the facilitator sync is not what is under test).
      await vi.advanceTimersByTimeAsync(0);
      const unpaid = await app.request("/api/v1/arrivals?station=N8", {}, env);
      const required = decode(unpaid.headers.get("payment-required"));
      const header = Buffer.from(
        JSON.stringify({ x402Version: 2, resource: required.resource, accepted: required.accepts[0], payload: { signature: "0xsig", authorization: {} } }),
      ).toString("base64");
      const pending = app.request("/api/v1/arrivals?station=N8", { headers: { "PAYMENT-SIGNATURE": header } }, env);
      await vi.advanceTimersByTimeAsync(5_001);
      const res = await pending;
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toContain("not been charged");
      expect(text).not.toContain("Mo Chit");
      expect(calls.settle, "a failed read must not settle").toHaveLength(0);
      // The deadline's timer is cleared, not left running (a pending timer keeps the request alive).
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an unreachable facilitator gives a 503 with no data and no settlement", async () => {
    facilitatorMode = "down";
    const res = await createApp(env).request("/api/v1/route?from=N8&to=CEN", {}, env);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("minutes");
    expect(calls.settle).toHaveLength(0);
  });

  it("a bad payment configuration turns every route off with a 503", async () => {
    for (const bad of [
      { ...env, X402_PAY_TO: "0x123" },
      { ...env, X402_PAY_TO: "" },
      { ...env, X402_NETWORK: "eip155:1" },
      { ...env, X402_FACILITATOR_URL: "http://insecure.example" },
    ]) {
      const app = createApp(bad);
      for (const path of ["/api/v1", "/api/v1/stations/siam-cen", "/api/v1/route?from=N8&to=CEN", "/api/v1/arrivals?station=N8"]) {
        const res = await app.request(path, {}, bad);
        expect(res.status, `${JSON.stringify(bad)} ${path}`).toBe(503);
      }
    }
    expect(readConfig({ ...env, X402_PAY_TO: "0xZZ" }).ok).toBe(false);
    expect(readConfig(env).ok).toBe(true);
  });
});

describe("the free parts", () => {
  it("the index is free, lists the prices, and says the network is a test one", async () => {
    const res = await createApp(env).request("/api/v1", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { payments: { testnet: boolean; payTo: string; notice: string }; endpoints: { price: string }[] };
    expect(body.payments.testnet).toBe(true);
    expect(body.payments.notice).toContain("TEST MODE");
    expect(body.payments.payTo).toBe(PAY_TO);
    expect(body.endpoints.map((e) => e.price)).toEqual(PAID_ENDPOINTS.map((e) => e.price));
    expect(calls.settle).toHaveLength(0);
  });

  it("answers CORS preflight and lets browsers read the payment headers", async () => {
    const app = createApp(env);
    const pre = await app.request("/api/v1/route", { method: "OPTIONS", headers: { origin: "https://agent.example", "access-control-request-method": "GET", "access-control-request-headers": "payment-signature" } }, env);
    expect(pre.status).toBeLessThan(300);
    expect(pre.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("payment-signature");
    const res = await app.request("/api/v1/route?from=N8&to=CEN", { headers: { origin: "https://agent.example" } }, env);
    expect(res.status).toBe(402);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-expose-headers")).toContain("PAYMENT-REQUIRED");
  });

  it("unknown /api paths are a JSON 404, and the Worker hands anything else to the static assets", async () => {
    const res = await createApp(env).request("/api/nope", {}, env);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("Not found");

    const assets = { fetch: vi.fn(async () => new Response("static page")) };
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const page = await worker.fetch(new Request("https://bangkok-transit.com/lines"), { ...env, ASSETS: assets }, ctx);
    expect(await page.text()).toBe("static page");
    expect(assets.fetch).toHaveBeenCalledTimes(1);
    const api = await worker.fetch(new Request("https://bangkok-transit.com/api/v1"), { ...env, ASSETS: assets }, ctx);
    expect(api.status).toBe(200);
    expect(assets.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("the facilitator sync is owned by the Worker, not by whichever request came first", () => {
  // Regression for a production-grade hang found under `wrangler dev`: the library
  // started its facilitator sync inside the first request (the free index, say);
  // Workers cancels a request's in-flight work when it ends, so the sync died and
  // every later paid request waited on it forever.
  const ctxWith = () => {
    const kept: Promise<unknown>[] = [];
    return { kept, ctx: { waitUntil: (p: Promise<unknown>) => void kept.push(p) } as unknown as ExecutionContext };
  };

  it("works when the free index is the first request, then a paid one", async () => {
    const app = createApp(env);
    expect((await app.request("/api/v1", {}, env)).status).toBe(200);
    expect(calls.supported, "the free index must not touch the facilitator").toBe(0);
    expect((await app.request("/api/v1/route?from=N8&to=CEN", {}, env)).status).toBe(402);
    expect(calls.supported).toBe(1);
  });

  it("starts the sync from the first paid request and hands it to waitUntil, so it outlives that request", async () => {
    const app = createApp(env);
    const { kept, ctx } = ctxWith();
    expect((await app.request("/api/v1/route?from=N8&to=CEN", {}, env, ctx)).status).toBe(402);
    expect(kept).toHaveLength(1);
    // Later requests reuse the finished sync: no second call, nothing more to keep alive.
    expect((await app.request("/api/v1/stations/siam-cen", {}, env, ctx)).status).toBe(402);
    expect(calls.supported).toBe(1);
    expect(kept).toHaveLength(1);
  });

  it("a burst of cold paid requests shares one sync and all get a 402", async () => {
    const app = createApp(env);
    const { ctx } = ctxWith();
    const burst = await Promise.all(Array.from({ length: 12 }, () => app.request("/api/v1/route?from=N8&to=CEN", {}, env, ctx)));
    expect(burst.map((r) => r.status)).toEqual(Array(12).fill(402));
    expect(calls.supported).toBe(1);
  });

  it("junk and unknown paths never trigger the facilitator", async () => {
    const app = createApp(env);
    for (const path of ["/api/nope", "/api/v1/nope", "/api/v1/stations", "/api"]) await app.request(path, {}, env);
    expect(calls.supported).toBe(0);
  });

  it("a failed sync is a 503 (nothing served or charged) and the next request tries again", async () => {
    const app = createApp(env);
    supportedFailures = 1;
    const first = await app.request("/api/v1/route?from=N8&to=CEN", {}, env);
    expect(first.status).toBe(503);
    expect(await first.text()).not.toContain("minutes");
    expect(calls.settle).toHaveLength(0);
    const second = await app.request("/api/v1/route?from=N8&to=CEN", {}, env);
    expect(second.status).toBe(402);
    expect(calls.supported).toBe(2);
  });

  it("a facilitator that never answers cannot hang the caller: 503 within the budget, then a later request recovers", async () => {
    vi.useFakeTimers();
    try {
      const app = createApp(env);
      let release!: () => void;
      stallSupported = new Promise<void>((r) => (release = r));
      const pending = app.request("/api/v1/route?from=N8&to=CEN", {}, env);
      await vi.advanceTimersByTimeAsync(12_001);
      const res = await pending;
      expect(res.status).toBe(503);
      expect(await res.text()).toContain("not been charged");
      // The facilitator comes back; the next paid request starts a FRESH sync (the
      // stuck one is dropped, not waited on again) and works.
      stallSupported = null;
      const before = calls.supported;
      const later = await app.request("/api/v1/route?from=N8&to=CEN", {}, env);
      expect(later.status).toBe(402);
      expect(calls.supported).toBe(before + 1);
      release();
    } finally {
      vi.useRealTimers();
    }
  });
});
