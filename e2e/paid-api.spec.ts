import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { expect, test } from "./fixtures";

/** A port nothing is listening on. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

/**
 * The paid x402 API (worker/) runs only for /api/*, under the real `wrangler dev`
 * Worker runtime: the one place that proves workerd accepts the bundle and that
 * the website itself is still plain static assets. Payments cannot be made here
 * (that needs a wallet and a facilitator); worker/app.ts is covered with a fake
 * facilitator in tests/x402-worker.test.ts.
 */
test.describe("paid API", () => {
  test("the index is free, lists prices, and says it is test money", async ({ request }) => {
    const res = await request.get("/api/v1");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    expect(res.headers()["cache-control"]).toBe("private, no-store");
    const body = await res.json();
    expect(body.payments).toMatchObject({ protocol: "x402", network: "eip155:84532", testnet: true });
    expect(body.payments.notice).toContain("TEST MODE");
    expect(body.payments.payTo).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(body.endpoints.map((e: { path: string }) => e.path)).toEqual([
      "/api/v1/arrivals", "/api/v1/route", "/api/v1/stations/{slug}", "/api/v1/lines/{slug}",
    ]);
  });

  test("a call without payment gets a 402 that says how to pay, and no data", async ({ request }) => {
    const res = await request.get("/api/v1/route?from=N8&to=CEN");
    expect(res.status()).toBe(402);
    const required = JSON.parse(Buffer.from(res.headers()["payment-required"], "base64").toString("utf8"));
    expect(required.x402Version).toBe(2);
    expect(required.accepts[0]).toMatchObject({ scheme: "exact", network: "eip155:84532", amount: "5000" });
    expect(required.accepts[0].payTo).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(await res.text()).not.toContain("minutes");
    expect(res.headers()["access-control-expose-headers"]).toContain("PAYMENT-REQUIRED");
  });

  test("cold start: the free index first, then a burst of paid requests, none hangs", async ({ request }) => {
    // Regression: the facilitator sync used to start inside whichever request came
    // first and die with it, so every later paid request hung forever. That only
    // shows on a Worker that has never served a request, and the shared test server
    // (parallel tests, a second project, a reused local server) cannot promise one.
    // So this test starts its own fresh Worker, requests the free index first, and
    // only then sends the burst.
    test.setTimeout(120_000);
    const port = await freePort();
    const worker: ChildProcess = spawn(
      "npx",
      ["wrangler", "dev", "--config", "e2e/wrangler.cold.jsonc", "--port", String(port)],
      { stdio: "ignore", detached: true },
    );
    try {
      const base = `http://localhost:${port}`;
      await expect
        .poll(async () => (await request.get(`${base}/lines`, { timeout: 5_000 }).catch(() => null))?.status(), {
          timeout: 90_000,
          message: "the fresh Worker starts",
        })
        .toBe(200);
      // Now, and only now, the first API request this Worker has ever had: the free index.
      expect((await request.get(`${base}/api/v1`)).status()).toBe(200);
      const burst = await Promise.all(
        Array.from({ length: 10 }, () => request.get(`${base}/api/v1/route?from=N8&to=CEN`, { timeout: 20_000 })),
      );
      expect(burst.map((r) => r.status())).toEqual(Array(10).fill(402));
    } finally {
      if (worker.pid) {
        try {
          process.kill(-worker.pid, "SIGKILL"); // the whole process group: npx, wrangler and workerd
        } catch {
          // already gone
        }
      }
    }
  });

  test("every paid endpoint wants payment, and an unknown /api path is a JSON 404", async ({ request }) => {
    for (const path of ["/api/v1/arrivals?station=N8", "/api/v1/stations/siam-cen", "/api/v1/lines/bts-sukhumvit-line"]) {
      expect((await request.get(path)).status(), path).toBe(402);
    }
    const nope = await request.get("/api/nope");
    expect(nope.status()).toBe(404);
    expect((await nope.json()).error).toBe("Not found");
  });

  test("the website is still plain static assets: pages and data files are not behind the Worker", async ({ request }) => {
    for (const path of ["/", "/lines", "/line-geometry.json", "/llms.txt", "/md/index.md"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      // Only the Worker adds this; static assets never get it.
      expect(res.headers()["cache-control"], path).not.toBe("private, no-store");
    }
  });
});
