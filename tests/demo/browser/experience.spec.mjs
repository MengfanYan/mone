import { test, expect } from "@playwright/test";
import { commandsAndHistory } from "../../e2e/ux-flow.mjs";
import { navigate, openOverviewDetails } from "../../e2e/ui-helpers.mjs";
test("offline multi-currency clarification, shared bilingual editor, correction and profit history", async ({
  page,
}) => {
  const errors = [],
    apiCalls = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) apiCalls.push(r.url());
  });
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin !== "http://127.0.0.1:3101" ||
    new URL(route.request().url()).pathname.startsWith("/api/")
      ? route.abort()
      : route.continue(),
  );
  await page.goto("/demo");
  await commandsAndHistory(page, true);
  await navigate(page, "Dashboard");
  expect(errors).toEqual([]);
  expect(apiCalls).toEqual([]);
  await page.screenshot({
    path: `reports/ux-dashboard-${test.info().project.name}.png`,
    fullPage: true,
  });
});

async function confirm(page) {
  const dialog = page.getByRole("dialog", {
    name: "Review & confirm",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Confirm these details", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}
async function stored(page) {
  return page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("zhizhang.product-demo.v1")),
  );
}

test("budget drill preserves scope; investment append/revision/archive keeps one current value and offline history", async ({
  page,
  context,
}) => {
  const errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      new URL(r.url()).pathname.startsWith("/api/") ||
      new URL(r.url()).origin !== "http://127.0.0.1:3101"
    )
      requests.push(r.url());
  });
  await page.goto("/demo");
  await openOverviewDetails(page);
  await expect(page.locator(".budget-relation")).toHaveCount(3);
  await context.setOffline(true);
  await page.locator(".budget-relation").filter({ hasText: "Dining" }).click();
  await expect(page.getByLabel("Analysis month", { exact: true })).toHaveValue(
    "2026-09",
  );
  await expect(
    page.getByLabel("Current currency", { exact: true }),
  ).toHaveValue("AUD");
  await expect(
    page.getByLabel("Search transactions", { exact: true }),
  ).toHaveValue("Dining");
  const rows = (await page.locator(".ledger-mobile-list").isVisible())
    ? page.locator(".ledger-mobile-record")
    : page.locator(".ledger-desktop-table tbody tr");
  await expect(rows.first()).toBeVisible();
  for (const text of await rows.allTextContents()) {
    expect(text).toContain("Dining");
    expect(text).toContain("AUD");
    expect(text).toMatch(/Confirmed/);
  }
  await page
    .getByRole("button", { name: "Back to relationships", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await navigate(page, "Portfolio");
  await page
    .getByLabel("Current currency", { exact: true })
    .selectOption("CNY");
  const entry = page.locator(
    '[data-investment="demo-investment-capital-history"]',
  );
  await expect(entry.locator(".performance-value")).toContainText("215.00");
  const before = await stored(page);
  const update = async (value, revision) => {
    await entry
      .getByRole("button", { name: "Add valuation", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Add valuation",
      exact: true,
    });
    await editor
      .getByLabel("Observation time (with timezone)", { exact: true })
      .fill("2026-09-06T06:00:00Z");
    await editor
      .getByLabel("Market value (blank if unknown)", { exact: true })
      .fill(value);
    await editor
      .getByLabel("Remaining cost (blank if unknown)", { exact: true })
      .fill("1000");
    await editor
      .getByLabel("Fees and taxes checked; leave off if unknown", {
        exact: true,
      })
      .check();
    if (revision)
      await editor
        .getByLabel("Revision at the same observation time (optional)", {
          exact: true,
        })
        .selectOption({ index: 6 });
    await editor
      .getByRole("button", { name: "Review investment changes", exact: true })
      .click();
    await confirm(page);
  };
  await update("1160", false);
  await expect(entry.locator(".performance-value")).toContainText("225.00");
  await update("1170", true);
  await expect(entry.locator(".performance-value")).toContainText("235.00");
  const after = await stored(page);
  expect(after.state.investments.length).toBe(before.state.investments.length);
  expect(after.state.transactions).toEqual(before.state.transactions);
  const points = after.valuations.filter(
    (v) => v.investment_id === "demo-investment-capital-history",
  );
  expect(points).toHaveLength(7);
  expect(new Set(points.map((p) => p.observed_at)).size).toBe(6);
  await entry.getByRole("button", { name: "Archive", exact: true }).click();
  await confirm(page);
  await expect(entry).toHaveCount(0);
  await page
    .getByLabel("Show archived investments & history", { exact: true })
    .check();
  await expect(entry).toContainText("Archived; history retained");
  await expect(entry.locator(".performance-value")).toContainText("235.00");
  await entry.screenshot({
    path: `reports/ux-investment-history-${test.info().project.name}.png`,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});
