// Cross-cutting checks, run once per persona after its own scenario finishes.
//
// Adding a check means adding a function here — no edits to the runner. Heavy
// checks (fresh navigation, axe, service worker) are limited to a couple of
// personas so the suite stays inside the per-scenario time budget.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkLayout, checkTapTargets } from "./layout.mjs";
import { checkRouteSheet } from "./route.mjs";
import { checkPerf } from "./perf.mjs";
import { checkA11y, checkDark } from "./a11y.mjs";
import { checkNetwork, checkOffline, checkServiceWorker } from "./resilience.mjs";

const HEAVY = new Set(["maya"]);
const WIDE_LAYOUT = new Set(["maya", "guide"]);
const DARK = new Set(["guide"]);
const OFFLINE = new Set(["lena"]);

async function checkVisual(session, budgets) {
  const file = path.join(budgets.baselines ?? "scripts/sim/baselines", "home.png");
  const shot = await session.page.screenshot({ fullPage: false });
  const hash = createHash("sha256").update(shot).digest("hex");

  let baseline = null;
  try {
    baseline = createHash("sha256").update(await readFile(file)).digest("hex");
  } catch {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, shot);
  }

  const mode = budgets.mode ?? "report";
  const same = baseline === null || baseline === hash;
  session.check("visual.home", mode === "gate" ? same : true, {
    severity: "minor",
    data: { mode, baseline: baseline ? baseline.slice(0, 12) : "created", current: hash.slice(0, 12) },
  });
}

export async function runCoverage(session, budgets = {}) {
  const id = session.persona.id;

  await session.step("layout", () => checkLayout(session, WIDE_LAYOUT.has(id) ? [390, 320, 430, 768] : [390]), 30000);
  await session.step("tap-targets", () => checkTapTargets(session), 15000);
  await session.step("route-sheet", () => checkRouteSheet(session), 60000);

  const pageErrors = session.errors.filter((e) => e.startsWith("pageerror:"));
  session.check("console.clean", pageErrors.length === 0, {
    severity: "major",
    data: { pageErrors: pageErrors.slice(0, 5) },
  });

  if (HEAVY.has(id)) {
    await session.step("perf", () => checkPerf(session, budgets.perf), 45000);
    await session.step("a11y", () => checkA11y(session, budgets.a11y), 60000);
    await session.step("network", () => checkNetwork(session), 45000);
    await session.step("visual", () => checkVisual(session, budgets.visual ?? {}), 30000);
  }
  if (DARK.has(id)) await session.step("dark", () => checkDark(session), 60000);
  if (OFFLINE.has(id)) {
    await session.step("service-worker", () => checkServiceWorker(session), 60000);
    await session.step("offline", () => checkOffline(session), 60000);
  }
}
