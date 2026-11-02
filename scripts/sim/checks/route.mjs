// The route sheet is the screen people use while standing on a platform, so
// these checks assert what a rider needs: an honest change count, and the
// destination reachable without scrolling through every station.

// A deep link sets the route but deliberately leaves the sheet closed, so the
// map stays visible; the sheet opens from the "View route" control.
async function openSheet(page) {
  const view = page.getByRole("button", { name: /view route/i }).first();
  await view.waitFor({ timeout: 15000 });
  await view.click();
  await page.waitForSelector('[aria-hidden="false"]', { timeout: 15000 });
}

export async function checkRouteSheet(session) {
  const { page } = session;

  // N8 (Mo Chit, BTS) -> walk -> Chatuchak Park (MRT Blue). One ride, but the
  // rider still has to leave the station and board another operator's line;
  // calling that "no changes" was the bug this check locks down.
  await page.goto("/?from=N8&to=BL22", { waitUntil: "domcontentloaded" });
  await openSheet(page);
  const sheet = page.locator('[aria-hidden="false"]').first();
  const summary = (await sheet.innerText()).replace(/\s+/g, " ");

  session.check("route.summary-honest", /1 change/i.test(summary), {
    severity: "major",
    data: { summary: summary.slice(0, 200) },
  });

  // CEN -> N24 is 24 stops. Collapsed, the sheet must show the anchors and the
  // destination, not 24 rows stacked below the fold.
  await page.goto("/?from=CEN&to=N24", { waitUntil: "domcontentloaded" });
  await openSheet(page);
  const long = page.locator('[aria-hidden="false"]').first();
  const rows = await long.locator("li").count();
  const text = await long.innerText();
  session.check("route.destination-visible", rows > 0 && rows <= 8 && /get off here/i.test(text), {
    severity: "major",
    data: { rows, hasDestination: /get off here/i.test(text) },
  });

  // Expanding is one tap and must reveal the hidden middle.
  const expand = long.getByRole("button", { name: /show \d+ stop/i }).first();
  if (await expand.count()) {
    await expand.click();
    await page.waitForTimeout(200);
    const expandedRows = await long.locator("li").count();
    session.check("route.expand-stops", expandedRows > rows, {
      severity: "minor",
      data: { before: rows, after: expandedRows },
    });
  }
}
