// Phase 1 acceptance checks for the swarm harness.
//
//   node scripts/sim/acceptance.mjs
//
// Runs the real sim binary end to end - twice with the same seed (for the
// determinism check) and once against a deliberately broken build (for the
// exit-code gate) - and asserts the five properties the pipeline depends on.
// Exits 1 if any check fails.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEVERITIES, findingId, makeFinding } from "./findings.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const ARTIFACTS = path.join(REPO, "sim-artifacts", "acceptance");
const SEED = "acceptance-1";
const PERSONA = "maya";
const SOAK = "5s";

const results = [];

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}${detail ? ` - ${detail}` : ""}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name} - ${e.message}`);
  }
}

/** Run the sim exactly as `npm run sim` would, and report its exit code. */
function runSim(args) {
  const r = spawnSync(process.execPath, [path.join(__dirname, "run.mjs"), ...args], {
    cwd: REPO,
    encoding: "utf8",
  });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function readFindings(dir) {
  const file = path.join(dir, "findings.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

rmSync(ARTIFACTS, { recursive: true, force: true });
const dirA = path.join(ARTIFACTS, "seed-a");
const dirB = path.join(ARTIFACTS, "seed-b");
const runA = runSim([`--personas=${PERSONA}`, `--seed=${SEED}`, `--soak=${SOAK}`, `--out=${dirA}`]);
const runB = runSim([`--personas=${PERSONA}`, `--seed=${SEED}`, `--soak=${SOAK}`, `--out=${dirB}`]);

await check("same seed gives identical finding ids", () => {
  assert(runA.code === 0, `the first run exited ${runA.code}, expected 0`);
  assert(runB.code === 0, `the second run exited ${runB.code}, expected 0`);
  const idsA = readFindings(dirA).map((f) => f.id);
  const idsB = readFindings(dirB).map((f) => f.id);
  assert(idsA.length > 0, "no findings were produced, so there is nothing to compare");
  assert(
    JSON.stringify(idsA) === JSON.stringify(idsB),
    `ids differ: [${idsA.join(", ")}] vs [${idsB.join(", ")}]`,
  );
  return `${idsA.length} finding(s), identical ids across two runs`;
});

await check("report.json matches the documented schema", () => {
  const report = readJson(path.join(dirA, "report.json"));
  const types = {
    startedAt: "string",
    durationMs: "number",
    baseURL: "string",
    personas: "object",
    failures: "object",
    entries: "object",
    findings: "object",
    findingsFailed: "boolean",
  };
  for (const [key, type] of Object.entries(types)) {
    assert(key in report, `report.json is missing "${key}"`);
    assert(typeof report[key] === type, `"${key}" is ${typeof report[key]}, expected ${type}`);
  }
  assert(!Number.isNaN(Date.parse(report.startedAt)), "startedAt is not a parseable date");
  assert(report.personas.every((p) => typeof p === "string"), "personas must be strings");
  for (const f of report.findings) {
    for (const key of [
      "id",
      "check",
      "persona",
      "op",
      "severity",
      "ok",
      "detectedAt",
      "baseSha",
      "seed",
      "buildId",
      "data",
      "steps",
      "consoleErrors",
      "networkFailures",
      "screenshots",
      "repro",
    ]) {
      assert(key in f, `finding is missing "${key}"`);
    }
    assert(SEVERITIES.includes(f.severity), `finding severity "${f.severity}" is not a known severity`);
    assert(
      f.id === findingId({ persona: f.persona, op: f.op, check: f.check }),
      `finding id "${f.id}" does not match its persona/op/check`,
    );
    assert(Array.isArray(f.screenshots), "finding.screenshots must be an array");
    assert(typeof f.repro?.command === "string", "finding.repro.command must be a string");
  }
  return `${report.findings.length} finding(s) validated`;
});

await check("a blocker finding exits 1 with no flag", () => {
  assert(runA.code === 0, `the healthy run exited ${runA.code}, expected 0`);

  // Break the build the way a half-finished deploy would: drop one asset the
  // page still references. The harness' boot precondition must notice and
  // fail the run - with no --fail-on flag anywhere.
  const indexHtml = readFileSync(path.join(REPO, "out", "index.html"), "utf8");
  const refs = [
    ...new Set([...indexHtml.matchAll(/_next\/static\/[^"'\\\s)]+/g)].map((m) => m[0])),
  ].sort();
  const ref = refs.find((r) => r.endsWith(".css")) ?? refs[0];
  assert(ref, "out/index.html references no build assets");
  const target = path.join(REPO, "out", ref);
  const backup = `${target}.acceptance-bak`;
  renameSync(target, backup);
  let run;
  try {
    run = runSim([
      `--personas=${PERSONA}`,
      `--seed=${SEED}`,
      `--soak=${SOAK}`,
      `--out=${path.join(ARTIFACTS, "broken")}`,
    ]);
  } finally {
    renameSync(backup, target);
  }
  assert(existsSync(target), "the build asset was not restored");
  assert(run.code === 1, `the broken-build run exited ${run.code}, expected 1`);
  const report = readJson(path.join(ARTIFACTS, "broken", "report.json"));
  assert(report.findingsFailed === true, "findingsFailed was not set on the broken run");
  const blocker = report.findings.find((f) => f.check === "build.asset-hash" && !f.ok);
  assert(blocker, "the broken build produced no failing build.asset-hash finding");
  assert(blocker.severity === "blocker", `the finding was ${blocker.severity}, expected blocker`);
  return `exit ${run.code} via ${blocker.check} (${blocker.id})`;
});

await check("screenshots referenced by findings exist on disk", () => {
  const report = readJson(path.join(dirA, "report.json"));
  for (const f of report.findings) {
    for (const shot of f.screenshots) {
      assert(!path.isAbsolute(shot), `finding ${f.id} references an absolute path ${shot}`);
      assert(existsSync(path.join(dirA, shot)), `finding ${f.id} references a missing file ${shot}`);
    }
  }
  // A finding only carries the shots taken before it ran, so build one the
  // way the harness does, with the screenshots this run really took.
  const shotDir = path.join(dirA, "screenshots");
  assert(existsSync(shotDir), "the run took no screenshots");
  const taken = readdirSync(shotDir).filter((f) => f.endsWith(".png"));
  assert(taken.length > 0, "the run took no screenshots");
  const finding = makeFinding({
    persona: PERSONA,
    op: "scenarioFirstTimer",
    check: "acceptance.screenshot",
    severity: "major",
    ok: false,
    data: null,
    steps: [],
    session: { shots: taken.map((f) => `screenshots/${f}`), errors: [], networkFailures: [] },
    baseSha: null,
    seed: SEED,
    buildId: null,
    artifactsDir: dirA,
  });
  assert(
    finding.screenshots.length === taken.length,
    `the finding kept ${finding.screenshots.length} of ${taken.length} screenshots`,
  );
  for (const shot of finding.screenshots) {
    const file = path.join(dirA, shot);
    assert(existsSync(file), `referenced screenshot ${shot} does not exist`);
    assert(statSync(file).size > 0, `referenced screenshot ${shot} is empty`);
  }
  return `${finding.screenshots.length} screenshot(s) referenced and present`;
});

await check("the swarm workflow parses", async () => {
  const file = path.join(REPO, ".github", "workflows", "swarm.yml");
  assert(existsSync(file), "there is no .github/workflows/swarm.yml");
  const text = readFileSync(file, "utf8");

  let load = null;
  try {
    const yaml = await import("js-yaml");
    load = yaml.load ?? yaml.default?.load ?? null;
  } catch (e) {
    if (e.code !== "MODULE_NOT_FOUND") throw e;
  }
  if (!load) {
    // js-yaml is only a transitive dependency; fall back to a structural read.
    for (const needle of ["on:", "schedule:", "workflow_dispatch:", "jobs:", "npm run sim"]) {
      assert(text.includes(needle), `the workflow is missing "${needle}"`);
    }
    return "read structurally (js-yaml unavailable)";
  }

  const doc = load(text);
  assert(doc, "the workflow parsed to nothing");
  const on = doc.on ?? doc[true];
  assert(on, "the workflow has no `on` trigger");
  assert(on.schedule, "the workflow has no schedule trigger");
  assert(on.workflow_dispatch, "the workflow has no workflow_dispatch trigger");
  const sweep = doc.jobs?.sweep;
  assert(sweep, "the workflow has no `sweep` job");
  const steps = sweep.steps ?? [];
  const runs = steps.map((s) => String(s.run ?? ""));
  assert(runs.some((r) => r.includes("npm run build")), "the job never builds the site");
  assert(runs.some((r) => r.includes("npm run sim")), "the job never runs the sim");
  const upload = steps.find((s) => String(s.uses ?? "").startsWith("actions/upload-artifact"));
  assert(upload, "the job never uploads the artifacts");
  assert(String(upload.with?.path ?? "") === "sim-artifacts/", "the artifacts are uploaded from the wrong path");
  return "schedule + workflow_dispatch, build -> sim -> upload";
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} acceptance checks passed`);
process.exit(failed.length ? 1 : 0);
