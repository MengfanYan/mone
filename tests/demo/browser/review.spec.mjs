import { test, expect } from "@playwright/test";
import { navigate, openAdvancedModel } from "../../e2e/ui-helpers.mjs";
import {
  scopeAndNavigation,
  duplicateConfirmation,
  correctionScrollLifecycle,
} from "../../e2e/review-flow.mjs";

test.beforeEach(async ({ page }) => {
  await page.goto("/demo");
  await expect(page.locator(".app-shell")).toBeVisible();
});

test("review: scoped education, evidence, refresh/back navigation and editor error isolation", async ({
  page,
}) => {
  await scopeAndNavigation(page);
});
test("review: duplicate preview requires a separate-transaction decision and reason", async ({
  page,
}) => {
  const before = await page.evaluate(
    () =>
      JSON.parse(window.localStorage.getItem("zhizhang.product-demo.v1")).state
        .transactions.length,
  );
  await duplicateConfirmation(page, "Harbor Coffee");
  const after = await page.evaluate(
    () =>
      JSON.parse(window.localStorage.getItem("zhizhang.product-demo.v1")).state
        .transactions,
  );
  expect(after).toHaveLength(before + 1);
  expect(after.at(-1).evidence.duplicate_override.reason).toContain(
    "distinct purchase",
  );
});
test("review: correction dialog handoff restores page scrolling after cancel, confirm and Escape", async ({
  page,
}) => {
  await correctionScrollLifecycle(page);
});
test("review: unchanged weights, compact single-point history, weekday/holiday/crypto risk and ordinary settings", async ({
  page,
}) => {
  await navigate(page, "Portfolio");
  const single = page
    .locator("[data-investment]")
    .filter({ hasText: "Broad Market ETF" });
  await expect(single.locator(".single-observation-note")).toBeVisible();
  await expect(single.locator(".gain-curve")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Allocation worksheet", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Review your target weights",
    exact: true,
  });
  for (const cell of await dialog.locator("tbody tr td:last-child").all())
    await expect(cell).toContainText("0.00");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const dates = Array.from(
    { length: 30 },
    (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`,
  );
  const sessions = dates.filter(
    (d) => ![0, 6].includes(new Date(d).getUTCDay()),
  );
  const csv = (days) =>
    "observed_at,unit_price\n" +
    days.map((d, i) => `${d},${100 + i}`).join("\n");
  await page.getByLabel("Unit-price CSV", { exact: true }).fill(csv(sessions));
  await expect(page.locator(".risk-metrics")).toBeVisible();
  await page
    .getByLabel("Unit-price CSV", { exact: true })
    .fill(csv(sessions.filter((d) => d !== "2026-09-07")));
  await expect(page.locator(".risk-lab .terminal-empty")).toContainText(
    "2026-09-07",
  );
  await page
    .getByLabel("Exchange closure dates (YYYY-MM-DD)", { exact: true })
    .fill("2026-09-07");
  await expect(page.locator(".risk-metrics")).toBeVisible();
  await page
    .getByLabel("Observation frequency", { exact: true })
    .selectOption("calendar_days");
  await page.getByLabel("Unit-price CSV", { exact: true }).fill(csv(dates));
  await expect(page.locator(".risk-metrics")).toBeVisible();
  await page.screenshot({
    path: `reports/review-risk-${page.viewportSize().width}.png`,
  });
  await navigate(page, "Settings");
  await expect(
    page.getByLabel("Model identifier", { exact: true }),
  ).not.toBeVisible();
  await openAdvancedModel(page);
  await expect(
    page.getByLabel("Model identifier", { exact: true }),
  ).toBeVisible();
});
test("review: visible mobile navigation names match accessibility names and Analysis title contrasts", async ({
  page,
}) => {
  await expect(page.locator(".terminal-kpis").first()).toContainText(
    "Monthly surplus",
  );
  const dates = await page
    .locator(".recent-panel tbody tr td:nth-child(2)")
    .allTextContents();
  expect(dates).toEqual([...dates].sort().reverse());
  await expect(page.locator(".overview-details")).not.toHaveAttribute(
    "open",
    "",
  );
  await page.setViewportSize({ width: 320, height: 740 });
  for (const button of await page
    .locator(".mobile-navigation button[aria-label]")
    .all()) {
    expect(await button.getAttribute("aria-label")).toContain(
      await button.innerText(),
    );
    const label = button.locator("span");
    expect(
      await label.evaluate((node) => {
        const style = window.getComputedStyle(node),
          rect = node.getBoundingClientRect();
        return (
          rect.height <= parseFloat(style.fontSize) * 1.6 &&
          node.scrollWidth <= node.clientWidth + 1
        );
      }),
      "Mobile labels must fit on a single readable line",
    ).toBe(true);
  }
  await navigate(page, "Transactions");
  const action = page.locator(".ledger-task-bar .primary");
  expect((await action.boundingBox()).y).toBeLessThan(650);
  await navigate(page, "Analysis");
  expect(
    (
      await page
        .getByLabel("Financial analysis question", { exact: true })
        .boundingBox()
    ).y,
  ).toBeLessThan(650);
  await page.getByRole("button", { name: "View basis", exact: true }).click();
  await expect(page.locator(".assistant-intro h2")).toHaveCSS(
    "color",
    "rgb(199, 210, 254)",
  );
  await page.screenshot({ path: "reports/review-analysis-320.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "reports/review-analysis-desktop.png" });
});
