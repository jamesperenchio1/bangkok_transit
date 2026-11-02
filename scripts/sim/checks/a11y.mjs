// Accessibility gate, reusing the axe-core that already ships with
// @axe-core/playwright (no new dependency).

import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AXE_PATH = path.join(path.dirname(require.resolve("axe-core/package.json")), "axe.min.js");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function runAxe(page) {
  if (!(await page.evaluate(() => Boolean(window.axe)))) {
    await page.addScriptTag({ path: AXE_PATH });
  }
  const result = await page.evaluate(async (tags) => {
    return await window.axe.run(document, {
      runOnly: { type: "tag", values: tags },
      // MapLibre's canvas and its attribution chrome are third-party UI.
      rules: {},
    });
  }, TAGS);
  return result.violations.filter(
    (v) => !v.nodes.every((n) => n.target.some((t) => String(t).includes("maplibregl"))),
  );
}

function record(session, checkName, violations) {
  session.check(checkName, violations.length === 0, {
    severity: "major",
    data: {
      violations: violations.slice(0, 8).map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        target: v.nodes[0]?.target?.join(" "),
      })),
    },
  });
}

export async function checkA11y(session, budgets = {}) {
  const mode = budgets.mode ?? "gate";
  const page = session.page;

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("h1", { timeout: 15000 });
  await page.waitForTimeout(600);
  const home = await runAxe(page);
  if (mode === "gate") record(session, "a11y.axe", home);

  await page.goto("/?from=W1&to=E1", { waitUntil: "domcontentloaded" });
  // A deep link leaves the sheet closed; open it the way a rider does.
  await page.getByRole("button", { name: /view route/i }).first().click();
  await page.waitForSelector('[aria-hidden="false"]', { timeout: 15000 });
  await page.waitForTimeout(600);
  const sheet = await runAxe(page);
  if (mode === "gate") record(session, "a11y.axe-sheet", sheet);
}

export async function checkDark(session) {
  const page = session.page;
  await page.emulateMedia({ colorScheme: "dark" });
  try {
    await page.goto("/?from=W1&to=E1", { waitUntil: "domcontentloaded" });
    // A deep link leaves the sheet closed; open it the way a rider does.
  await page.getByRole("button", { name: /view route/i }).first().click();
  await page.waitForSelector('[aria-hidden="false"]', { timeout: 15000 });
    await page.waitForTimeout(400);
    const violations = await runAxe(page);
    const contrast = violations.filter((v) => v.id === "color-contrast");
    session.check("theme.dark", contrast.length === 0, {
      severity: "major",
      data: { contrast: contrast.length, others: violations.length - contrast.length },
    });
  } finally {
    await page.emulateMedia({ colorScheme: null });
  }
}
