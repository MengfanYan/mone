import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/demo");
  await expect(page.locator(".notification-center")).toBeVisible();
});

test("home notifications expose budget, salary and price evidence with exact module drilldowns", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".notification-item.budget")).toContainText(
    "21.00",
  );
  await expect(page.locator(".notification-item.price")).toContainText("6.44%");
  await expect(page.locator(".notification-item.income").first()).toContainText(
    "Salary recorded",
  );
  await page.getByRole("button", { name: /^Notifications, / }).click();
  await expect(page.locator(".notification-center")).toBeFocused();
  await page.locator(".notification-item.budget .notification-title").click();
  const detail = page.locator(".notification-detail");
  await expect(detail).toContainText("Confirmed ledger records");
  await expect(detail).toContainText("budget");
  await detail
    .getByRole("button", { name: "Review related spending", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Search transactions", { exact: true }),
  ).toHaveValue("Dining");
  await page.getByRole("button", { name: /^Notifications, / }).click();
  await page.locator(".notification-item.price .notification-title").click();
  await expect(page.locator(".notification-detail")).toContainText(
    "Corporate actions",
  );
  await page
    .getByRole("button", { name: "View investment history", exact: true })
    .click();
  await expect(
    page.locator(".investment-card.resource-highlight"),
  ).toContainText("Harbor Technology");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /^Notifications, / }).click();
  await page
    .locator(".notification-item.income .notification-title")
    .first()
    .click();
  const salary = await page
    .locator(".notification-detail > p")
    .first()
    .textContent();
  await expect(page.locator(".notification-detail")).toContainText(
    "does not verify receipt",
  );
  await page
    .getByRole("button", { name: "View salary record", exact: true })
    .click();
  const records =
    page.viewportSize().width < 700
      ? page.locator(".ledger-mobile-record")
      : page.locator(".ledger-desktop-table tbody tr");
  await expect(records).toHaveCount(1);
  await expect(records.first()).toContainText(salary.split(" · ")[0]);
  expect(errors).toEqual([]);
});

test("read controls persist, masking removes notification details and bilingual layouts fit", async ({
  page,
}, info) => {
  await page
    .getByRole("button", { name: "Mark all read", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Notifications, 0 unread", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unread", exact: true }).click();
  await expect(page.locator(".notification-center")).toContainText(
    "You're all caught up",
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Notifications, 0 unread", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "中文", exact: true }).click();
  await expect(page.locator(".notification-center h2")).toContainText("通知");
  await expect(page.locator(".notification-item.budget")).toContainText(
    "预算超额",
  );
  await page.getByRole("button", { name: "隐藏财务内容", exact: true }).click();
  await expect(
    page.locator(".notification-center,.notification-detail"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "通知，0条未读", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "显示财务内容", exact: true }).click();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.setViewportSize({
    width: info.project.name === "desktop" ? 1440 : 320,
    height: 1000,
  });
  await expect(page.locator(".notification-center")).toBeVisible();
  await page.screenshot({
    path: `reports/notifications-${info.project.name}.png`,
    fullPage: false,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize().width);
});

test("notification month changes keep their scope while module navigation remains available offline", async ({
  page,
  context,
}) => {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await context.setOffline(true);
  await page.getByLabel("Analysis month", { exact: true }).fill("2026-08");
  await expect(page.locator(".notification-center")).not.toContainText(
    "Updating this month's notifications",
  );
  for (const date of await page.locator(".notification-item time").all())
    expect(await date.getAttribute("datetime")).toMatch(/^2026-08/);
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", {
    name: "Command center",
    exact: true,
  });
  await palette.getByLabel("Search modules", { exact: true }).fill("Settings");
  await palette.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".terminal-settings-grid").first()).toBeVisible();
  await page.getByRole("button", { name: /^Notifications, / }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Analysis month", { exact: true })).toHaveValue(
    "2026-08",
  );
});
