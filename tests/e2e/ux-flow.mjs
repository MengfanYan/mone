import { expect } from "@playwright/test";
import { navigate, openAgent } from "./ui-helpers.mjs";

export async function task(page, text) {
  await openAgent(page);
  await page.getByRole("tab", { name: "Record & search", exact: true }).click();
  await page.getByLabel("Local task text", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Preview task", exact: true }).click();
  await expect(page.locator(".composer-submit")).toBeEnabled();
}
export async function submitTask(page) {
  await page
    .getByRole("button", { name: "Review selected operations", exact: true })
    .click();
  await expect(page.locator(".command-confirmation")).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm local changes", exact: true })
    .click();
  await expect(page.locator(".command-results-heading")).toContainText(
    "Operation completed",
  );
}
export async function commandsAndHistory(page, demo) {
  await task(page, "add Customer wallet account 0 CNY");
  await submitTask(page);
  await page.getByLabel("Analysis month", { exact: true }).fill("2026-09");
  await task(page, "2026-09-10 我今天买咖啡花了7dollars，兼职赚了200元。");
  await expect(page.locator(".command-result")).toHaveCount(2);
  await page
    .getByLabel("Candidate o1 currency", { exact: true })
    .selectOption("AUD");
  await page
    .getByLabel("Candidate o1 account", { exact: true })
    .selectOption({ index: 1 });
  await page
    .getByLabel("Candidate o2 currency", { exact: true })
    .selectOption("CNY");
  await page
    .getByLabel("Candidate o2 account", { exact: true })
    .selectOption({ label: "Customer wallet" });
  const coffee = page.locator(".command-result").first();
  await coffee.getByRole("button", { name: "Edit", exact: true }).click();
  let editor = page.getByRole("dialog", {
    name: "Edit task candidate",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await editor.getByLabel("Amount · AUD", { exact: true }).fill("6.50");
  await editor.getByRole("button", { name: "中文", exact: true }).click();
  editor = page.getByRole("dialog", { name: "编辑任务候选", exact: true });
  await expect(editor.getByLabel("金额 · AUD", { exact: true })).toHaveValue(
    "6.50",
  );
  await editor.getByRole("button", { name: "EN", exact: true }).click();
  editor = page.getByRole("dialog", {
    name: "Edit task candidate",
    exact: true,
  });
  await editor
    .getByRole("button", { name: "Keep candidate changes", exact: true })
    .click();
  await submitTask(page);
  await expect(page.locator(".command-result").first()).toContainText("6.50");
  await page
    .locator(".command-result")
    .first()
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  editor = page.locator("dialog[open]");
  await expect(editor.getByLabel("Amount · AUD", { exact: true })).toHaveValue(
    "6.50",
  );
  await editor.getByLabel("Amount · AUD", { exact: true }).fill("6.25");
  await editor
    .getByRole("button", { name: "Review correction", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Review & confirm",
    exact: true,
  });
  await expect(confirmation).toContainText("6.25");
  await confirmation
    .getByRole("button", { name: "Confirm these details", exact: true })
    .click();
  await expect(confirmation).not.toBeVisible();
  await navigate(page, "Analysis");
  await task(page, "change just 咖啡 to 6.00");
  await expect(page.locator(".command-result")).toBeVisible();
  // Recent resource context remains stable across tab/locale changes.
  await page
    .getByRole("button", { name: "Cancel this task", exact: true })
    .click();
  await expect(page.locator(".command-results-heading")).toContainText(
    "cancelled",
  );
  await navigate(page, "Portfolio");
  await page
    .getByLabel("Current currency", { exact: true })
    .selectOption("CNY");
  if (demo) {
    const entry = page.locator(
      '[data-investment="demo-investment-capital-history"]',
    );
    await expect(entry.locator(".performance-value")).toContainText("215.00");
    await entry
      .getByLabel("Performance basis", { exact: true })
      .selectOption("UNREALIZED");
    await entry
      .getByLabel("Display unit", { exact: true })
      .selectOption("PERCENT");
    await expect(entry.locator(".performance-value")).toContainText("15.0000%");
  }
  await expect(page.locator(".editor-dialog")).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize().width);
}
