// One place for every quality gate the swarm enforces.
//
// Iterating on the app should not mean editing checks: change a number here,
// or flip a mode to "report" while a new budget settles. `npm run sim:baseline`
// regenerates the visual goldens in one command.
export const budgets = {
  // Byte-hash comparison of app chrome (never map imagery — the harness stubs
  // tiles). Report-only by default so a font-rendering difference is a warning,
  // not a blocked merge; `--gate-visual` (or mode: "gate") makes it blocking.
  visual: { mode: "report", baselines: "scripts/sim/baselines" },
  perf: { mode: "gate", lcpMs: 2500, cls: 0.1, jsKb: 1800 },
  a11y: { mode: "gate" },
};

export default budgets;
