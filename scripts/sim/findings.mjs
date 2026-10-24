// Deterministic findings primitives for the simulation swarm.
//
// A finding is a *claim* made by a deterministic check. Nothing here decides
// whether a claim is true - the check already did, by returning ok/false. This
// module only gives every claim a stable identity (so the same bug reported by
// many personas collapses into one cluster) and a stable shape.
//
// Identity is deliberately independent of time, viewport, seed and artifact
// paths: the same (persona, op, check) triple always produces the same id, so
// re-runs are comparable and dedupe works across runs.

import path from "node:path";

export const SEVERITIES = ["blocker", "major", "minor", "cosmetic"];

/** Lower is worse. Used for "at least this severe" gating. */
export const SEVERITY_RANK = {
  blocker: 0,
  major: 1,
  minor: 2,
  cosmetic: 3,
};

/**
 * FNV-1a, 32-bit. Chosen over crypto hashes because it is synchronous, has zero
 * dependencies, and is trivially reproducible in any language if artifacts are
 * ever read by another tool.
 */
export function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Stable id for a finding. Check name leads so ids sort by check, which makes
 * raw findings.jsonl readable without a viewer.
 */
export function findingId({ persona, op, check }) {
  return `${check}-${fnv1a(`${persona}|${op}|${check}`)}`;
}

/** True when `severity` is at least as severe as `threshold`. */
export function severityAtLeast(severity, threshold) {
  const a = SEVERITY_RANK[severity];
  const b = SEVERITY_RANK[threshold];
  if (a === undefined || b === undefined) return false;
  return a <= b;
}

/** Normalise an artifact path so findings never leak absolute machine paths. */
export function artifactPath(filePath, artifactsDir) {
  if (!filePath) return null;
  if (!artifactsDir) return String(filePath);
  const rel = path.relative(artifactsDir, filePath);
  // path.relative can return "" for the dir itself; never emit that.
  return rel && !rel.startsWith("..") ? rel.split(path.sep).join("/") : null;
}

/**
 * Build the finding record.
 *
 * `session` supplies the per-persona evidence collected while the check ran.
 * Everything optional degrades to an empty array rather than throwing: a
 * finding must always be writable, otherwise the evidence itself is lost.
 */
export function makeFinding({
  persona,
  op,
  check,
  severity,
  ok,
  data = null,
  steps = null,
  session = null,
  baseSha = null,
  seed = null,
  buildId = null,
  artifactsDir = null,
}) {
  if (!SEVERITIES.includes(severity)) {
    throw new Error(`unknown severity "${severity}" for check "${check}"`);
  }

  // `shot()` records paths relative to the artifacts dir, but artifactPath()
  // relativises against that dir - so anchor them first, or every screenshot
  // is dropped as "outside the dir" and the finding loses its evidence.
  const shots = (session?.shots ?? [])
    .map((p) => artifactPath(path.isAbsolute(p) ? p : path.join(artifactsDir ?? "", p), artifactsDir))
    .filter(Boolean);

  return {
    id: findingId({ persona, op, check }),
    check,
    persona,
    op,
    severity,
    ok: Boolean(ok),
    detectedAt: new Date().toISOString(),
    baseSha,
    seed,
    buildId,
    data,
    steps: steps ?? [],
    consoleErrors: (session?.errors ?? []).slice(0, 25),
    networkFailures: (session?.networkFailures ?? []).slice(0, 25),
    screenshots: shots,
    repro: {
      persona,
      op,
      check,
      baseSha,
      seed,
      command: `npm run sim -- --personas=${persona} --seed=${seed ?? "<seed>"}`,
    },
  };
}

/**
 * Parse a `--fail-on=<level>` value. Accepts a severity or "any"/"none".
 * Returns the threshold severity, or null when findings must never fail a run.
 */
export function parseFailOn(value) {
  if (value === false || value === "none" || value === "off") return null;
  if (value === true || value === "any") return "cosmetic";
  if (typeof value === "string" && SEVERITIES.includes(value)) return value;
  throw new Error(
    `--fail-on must be one of ${SEVERITIES.join("|")}|any|none, got "${value}"`,
  );
}
