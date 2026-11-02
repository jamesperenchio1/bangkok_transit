// Layout and touch ergonomics, measured on the real page.
//
// These are the checks a designer would run by hand: does anything push the
// page sideways, does the header eat the map, is every control big enough to
// hit with a thumb. Each records a finding whether it passes or fails.

const HEADER_BUDGET_PX = 64;
const MIN_TARGET_PX = 44;

async function measureLayout(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    header: document.querySelector("header")?.getBoundingClientRect().height ?? 0,
  }));
}

export async function checkLayout(session, widths = [390]) {
  const { page, reporter, persona } = session;
  const measured = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(150);
    const m = await measureLayout(page);
    measured.push({ width, ...m });
    session.check("layout.no-overflow", m.scrollWidth <= m.innerWidth + 1, {
      severity: "major",
      data: { width, scrollWidth: m.scrollWidth, innerWidth: m.innerWidth },
    });
  }
  const last = measured[measured.length - 1];
  session.check("layout.header-height", last.header <= HEADER_BUDGET_PX, {
    severity: "major",
    data: { header: Math.round(last.header), budget: HEADER_BUDGET_PX },
  });
  reporter.say(persona, "layout", { measured });
  await page.setViewportSize({ width: 390, height: 844 });
}

export async function checkTapTargets(session) {
  const small = await session.page.evaluate((min) => {
    // Plain inline links are exempt (WCAG 2.5.8 exception); map controls are
    // MapLibre's own chrome, not ours.
    const selector = 'button, [role="button"], [role="switch"], [role="option"], summary';
    const out = [];
    for (const el of document.querySelectorAll(selector)) {
      if (el.closest(".maplibregl-ctrl")) continue;
      if (el.getAttribute("aria-hidden") === "true") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      if (r.width < min || r.height < min) {
        out.push({
          label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    return out;
  }, MIN_TARGET_PX);

  session.check("tap.targets-44", small.length === 0, {
    severity: "major",
    data: { count: small.length, sample: small.slice(0, 6) },
  });
}
