#!/usr/bin/env node
/**
 * Boots the real poller under `wrangler dev` (workerd, local R2), fires the
 * cron, and checks a valid arrivals.json lands in the bucket - catching what
 * unit tests can't: a Worker that workerd refuses to load (e.g. a non-handler
 * named export from the entry module), a broken binding, a bundling problem.
 *
 * It calls the real upstream API (one batch), but only asserts that a
 * well-formed document with an upstream status was published, so it passes
 * whether the upstream is up or down.
 *
 *   npm run smoke
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = 8790 + Math.floor(Math.random() * 100);
const persist = mkdtempSync(path.join(tmpdir(), "poller-smoke-"));
const cwd = path.join(import.meta.dirname, "..");

const dev = spawn("npx", ["wrangler", "dev", "--test-scheduled", "--port", String(PORT), "--persist-to", persist], {
  cwd,
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
dev.stdout.on("data", (d) => (log += d));
dev.stderr.on("data", (d) => (log += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function finish(code, message) {
  dev.kill("SIGINT");
  rmSync(persist, { recursive: true, force: true });
  if (code !== 0) console.error(`${message}\n\n--- wrangler output ---\n${log}`);
  else console.log(message);
  process.exit(code);
}

async function waitFor(check, timeoutMs, what) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (/Uncaught|✘ \[ERROR\]/.test(log)) finish(1, "✗ the Worker failed to start or threw");
    const result = await check();
    if (result) return result;
    await sleep(500);
  }
  finish(1, `✗ timed out waiting for ${what}`);
}

await waitFor(() => log.includes("Ready on"), 90_000, "wrangler dev to start");
await waitFor(
  async () => {
    try {
      return (await fetch(`http://localhost:${PORT}/__scheduled?cron=*+*+*+*+*`)).ok;
    } catch {
      return false;
    }
  },
  20_000,
  "the cron trigger",
);

const doc = await waitFor(
  () => {
    try {
      const out = execFileSync(
        "npx",
        ["wrangler", "r2", "object", "get", "bts-live/arrivals.json", "--local", "--persist-to", persist, "--pipe"],
        { cwd, stdio: ["ignore", "pipe", "ignore"] },
      ).toString();
      return JSON.parse(out);
    } catch {
      return null;
    }
  },
  40_000,
  "arrivals.json to be published",
);

if (doc.total !== 61 || typeof doc.complete !== "boolean" || !doc.status?.state || !doc.poll) {
  finish(1, `✗ malformed document: ${JSON.stringify(doc).slice(0, 300)}`);
}
finish(
  0,
  `✓ poller published arrivals.json: ${Object.keys(doc.arrivals).length}/${doc.total} stations, upstream ${doc.status.state}, last poll ${doc.poll.ok}/${doc.poll.polled} ok`,
);
