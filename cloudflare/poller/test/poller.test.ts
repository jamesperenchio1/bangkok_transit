import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArrivalsDocument } from "../../../lib/arrivals-document";
import { DOCUMENT_KEY } from "../src/index";
import { BATCH, PROBE } from "../src/schedule";
import { mockUpstream, ok, status } from "./helpers";

/**
 * The real ArrivalsPoller Durable Object, run in workerd with a local R2
 * bucket. Each test uses its own object name, so state never leaks between
 * tests; the upstream API is mocked.
 */

let n = 0;
const freshPoller = () => env.POLLER.get(env.POLLER.idFromName(`test-${++n}`));

async function published(): Promise<{ doc: ArrivalsDocument; cacheControl?: string; etag: string }> {
  const object = await env.LIVE.get(DOCUMENT_KEY);
  if (!object) throw new Error("nothing published");
  return { doc: await object.json(), cacheControl: object.httpMetadata?.cacheControl, etag: object.etag };
}

/** Arms the alarm far in the future so only runDurableObjectAlarm fires it. */
async function arm(stub: DurableObjectStub): Promise<void> {
  await runInDurableObject(stub, (_instance, state) => state.storage.setAlarm(Date.now() + 3_600_000));
}

async function nextAlarmIn(stub: DurableObjectStub): Promise<number> {
  return runInDurableObject(stub, async (_instance, state) => (await state.storage.getAlarm())! - Date.now());
}

afterEach(async () => {
  vi.restoreAllMocks();
  await env.LIVE.delete(DOCUMENT_KEY);
});

describe("ArrivalsPoller", () => {
  it("polls half the stations per alarm and publishes a complete document after two", async () => {
    const calls = mockUpstream(ok);
    const stub = freshPoller();
    await arm(stub);

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(calls).toHaveLength(BATCH);
    let { doc, cacheControl } = await published();
    expect(Object.keys(doc.arrivals)).toHaveLength(BATCH);
    expect(doc.complete).toBe(false);
    expect(cacheControl).toBe("public, max-age=0, s-maxage=2");
    expect(doc.status?.state).toBe("ok");

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(new Set(calls).size).toBe(61); // the second alarm took the other half
    ({ doc, cacheControl } = await published());
    expect(Object.keys(doc.arrivals)).toHaveLength(61);
    expect(doc.complete).toBe(true);
    expect(cacheControl).toBe("public, max-age=0, s-maxage=10");
  });

  it("is started by the cron watchdog when no alarm is set", async () => {
    mockUpstream(ok);
    const stub = freshPoller();
    expect(await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())).toBeNull();
    await stub.ensureRunning();
    // The alarm is set for "now", so the first poll runs straight away.
    await vi.waitFor(() => published(), { timeout: 5_000 });
  });

  it("re-arms itself after every alarm", async () => {
    mockUpstream(ok);
    const stub = freshPoller();
    await arm(stub);
    await runDurableObjectAlarm(stub);
    const delay = await nextAlarmIn(stub);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(5 * 60_000);
  });

  it("stops sending requests in a cycle once upstream rate-limits", async () => {
    const calls = mockUpstream(status(429));
    const stub = freshPoller();
    await arm(stub);
    await runDurableObjectAlarm(stub);
    // Only the requests already in flight (one per concurrent worker) went out.
    expect(calls.length).toBeLessThanOrEqual(6);
    const { doc } = await published();
    const reasons = Object.values(doc.poll!.failed);
    expect(reasons).toContain("429");
    expect(reasons).toContain("skipped");
  });

  it("backs off to probing when the upstream is down, and recovers", async () => {
    let calls = mockUpstream(status(500));
    const stub = freshPoller();
    await arm(stub);

    await runDurableObjectAlarm(stub);
    expect((await published()).doc.status?.state).toBe("degraded");

    await runDurableObjectAlarm(stub);
    const down = await published();
    let doc = down.doc;
    const cacheControl = down.cacheControl;
    expect(doc.status?.state).toBe("down");
    expect(doc.status?.incidents[0]).toMatchObject({ end: null });
    expect(doc.complete).toBe(true); // nothing to wait for: clients stop fast-polling
    expect(cacheControl).toBe("public, max-age=0, s-maxage=30");
    expect(await nextAlarmIn(stub)).toBeGreaterThan(15_000);

    vi.restoreAllMocks();
    calls = mockUpstream(status(500));
    await runDurableObjectAlarm(stub);
    expect(calls).toHaveLength(PROBE);

    vi.restoreAllMocks();
    mockUpstream(ok);
    await runDurableObjectAlarm(stub);
    doc = (await published()).doc;
    expect(doc.status?.state).toBe("ok");
    expect(doc.status?.incidents[0].end).not.toBeNull();
    expect(doc.status?.lastSuccessAt).not.toBeNull();
  });

  it("doesn't rewrite the document when nothing changed", async () => {
    mockUpstream(status(500));
    const stub = freshPoller();
    await arm(stub);
    await runDurableObjectAlarm(stub);
    await runDurableObjectAlarm(stub); // now "down"
    const before = (await published()).etag;
    await runDurableObjectAlarm(stub); // still down, same content
    expect((await published()).etag).toBe(before);
  });

  it("keeps readings and outage state across an eviction", async () => {
    mockUpstream(ok);
    const stub = freshPoller();
    await arm(stub);
    await runDurableObjectAlarm(stub);
    const firstHalf = Object.keys((await published()).doc.arrivals);

    vi.restoreAllMocks();
    mockUpstream(status(500));
    await runDurableObjectAlarm(stub);
    await runDurableObjectAlarm(stub);
    expect((await published()).doc.status?.state).toBe("down");

    await evictDurableObject(stub);
    await runDurableObjectAlarm(stub);
    const { doc } = await published();
    expect(doc.status?.state).toBe("down"); // health came back from storage
    expect(Object.keys(doc.arrivals)).toEqual(expect.arrayContaining(firstHalf)); // readings from R2
  });
});
