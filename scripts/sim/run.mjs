// CLI for the real-user simulation harness.
//
//   npm run sim
//   npm run sim -- --soak=3m --concurrent=4
//   npm run sim -- --personas=maya,jin --headful --base-url=http://localhost:3000
//
// Flags:
//   --base-url=URL        target an already-running server (default: serve ./out)
//   --port=N              port for the built-in static server (default: random)
//   --concurrent=N        personas in flight at once (default 3)
//   --soak=90s|5m         soak duration for the PWA persona (default 90s)
//   --personas=a,b,c      run only these persona ids
//   --headful             show the browsers
//   --out=DIR             artifacts dir (default sim-artifacts/<timestamp>)
//   --base-sha=SHA        git sha findings are attributed to (default: current HEAD)
//   --seed=STRING         deterministic seed for persona choices (default: none)
//   --fail-on=blocker|major|any|none  minimum severity that fails the run (default major)
//   --no-fail-on-findings skip the findings exit gate entirely
//   --repro=PATH          recorded in the run log only; Phase 1 does not act on it
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./harness.mjs";
import { parseFailOn } from "./findings.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    flags[m[1]] = m[2] === undefined ? true : m[2];
  }
  return flags;
}

function parseDuration(v) {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(String(v));
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const unit = m[2] || "s";
  const mult = { ms: 1, s: 1000, m: 60000, h: 3600000 }[unit];
  return Math.round(n * mult);
}

const flags = parseArgs(process.argv.slice(2));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactsDir = flags.out
  ? path.resolve(process.cwd(), flags.out)
  : path.join(REPO, "sim-artifacts", stamp);

const repro = typeof flags.repro === "string" ? path.resolve(process.cwd(), flags.repro) : null;
const baseSha = typeof flags["base-sha"] === "string" ? flags["base-sha"] : gitHead();
const seed = typeof flags.seed === "string" ? flags.seed : null;
const buildId = process.env.SIM_BUILD_ID ?? null;
const failOn = flags["no-fail-on-findings"] ? null : parseFailOn(flags["fail-on"] ?? "major");

if (repro) console.log(`[sim] repro mode: ${repro}`);

const result = await run({
  baseURL: typeof flags["base-url"] === "string" ? flags["base-url"] : undefined,
  port: flags.port ? Number(flags.port) : 0,
  concurrency: flags.concurrent ? Number(flags.concurrent) : 3,
  soakMs: parseDuration(flags.soak) ?? 90000,
  only: typeof flags.personas === "string" ? flags.personas.split(",").map((s) => s.trim()) : null,
  headful: Boolean(flags.headful),
  artifactsDir,
  baseSha,
  seed,
  buildId,
  failOn,
});

process.exit(result.failures.length || result.findingsFailed ? 1 : 0);
