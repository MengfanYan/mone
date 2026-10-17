import { seedLiveScenario } from "./ui-helpers.mjs";
import { expectPdfReady, expectPdfDownload } from "./pdf-assertions.mjs";
import {
  navigate,
  openPlanning,
  openAnalysis,
  openOverviewDetails,
} from "./ui-helpers.mjs";
import { test, expect } from "@playwright/test";

const code = "synthetic-browser-access-code";
const origin = "http://127.0.0.1:3097";
const tabs = [
  "Dashboard",
  "Transactions",
  "Budgets & goals",
  "Portfolio",
  "Statements",
  "Analysis",
  "Privacy & consent",
];

test.beforeEach(async ({ request }) => {
  await request.post("/api/session", {
    headers: { Origin: origin },
    data: { access_code: code },
  });
  const response = await request.post("/api/confirmation-challenges", {
    headers: { Origin: origin },
    data: { purpose: "privacy_delete", resource_id: "all", access_code: code },
  });
  const challenge = (await response.json()).data;
  const deleted = await request.post("/api/privacy/delete", {
    headers: { Origin: origin },
    data: { nonce: challenge.nonce, content_hash: challenge.content_hash },
  });
  expect(deleted.status()).toBe(200);
});

test("English default, bilingual navigation, persistent locale and unsaved forms", async ({
  page,
  context,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { name: "Welcome to your workspace" }),
  ).toBeVisible();
  await page
    .getByLabel("Local access code", { exact: true })
    .fill("incorrect-access-code");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.locator(".login-card").getByRole("alert")).toContainText(
    "The access code is incorrect.",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    animations: "disabled",
    path: `reports/ui-login-en-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByLabel("Local access code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Open workspace" }).click();
  for (const tab of tabs) {
    await navigate(page, tab);
    await expect(
      page.getByRole("heading", { name: tab, exact: true }),
    ).toBeVisible();
    expect(
      (await page.locator("body").innerText()).replaceAll("中文", ""),
    ).not.toMatch(/[\u3400-\u9fff]/);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `${tab} must fit the mobile viewport`,
    ).toBeLessThanOrEqual(page.viewportSize().width);
    if (test.info().project.name === "desktop") {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        animations: "disabled",
        path: `reports/ui-page-${tab.toLowerCase().replace(/\W+/g, "-")}.png`,
        fullPage: true,
      });
    }
  }
  await navigate(page, "Budgets & goals");
  await openPlanning(page);
  await page
    .getByLabel("Stable monthly income · AUD", { exact: true })
    .fill("1234.56");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "中文", exact: true })
    .click();
  await expect(
    page.getByLabel("稳定月收入 · AUD", { exact: true }),
  ).toHaveValue("1234.56");
  await expect(
    page.getByRole("heading", { name: "预算与目标", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭编辑器", exact: true })
    .click();
  const documentResponse = await context.request.get("/");
  expect(await documentResponse.text()).toContain('<html lang="zh-CN"');
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("heading", { name: "预算与目标", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(errors).toEqual([]);
});

test("language changes preserve confirmation, ledger values and frozen statement", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Local access code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await navigate(page, "Privacy & consent");
  await page.getByRole("switch", { name: "Local analysis consent" }).click();
  let dialog = page.getByRole("dialog", { name: "Review & confirm" });
  await dialog.getByRole("button", { name: "Confirm these details" }).click();
  await expect(dialog).not.toBeVisible();
  await navigate(page, "Dashboard");
  await seedLiveScenario(page);
  await expect(page.locator(".draft-card")).toHaveCount(4);
  const salary = page
    .locator(".draft-card")
    .filter({ hasText: "Synthetic salary" });
  await salary.getByRole("button", { name: "Review & confirm" }).click();
  dialog = page.getByRole("dialog", { name: "Review & confirm" });
  await dialog.getByRole("button", { name: "中文", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "核对并确认" });
  await expect(dialog).toContainText("Synthetic salary");
  await dialog.getByRole("button", { name: "内容无误，确认" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  for (let i = 0; i < 3; i++) {
    await page
      .locator(".draft-card")
      .first()
      .getByRole("button", { name: "Review & confirm" })
      .click();
    dialog = page.getByRole("dialog", { name: "Review & confirm" });
    await dialog.getByRole("button", { name: "Confirm these details" }).click();
    await expect(dialog).not.toBeVisible();
  }
  await navigate(page, "Budgets & goals");
  await openPlanning(page);
  await page
    .getByLabel("Planning currency", { exact: true })
    .selectOption("CNY");
  for (const [label, value] of [
    ["Stable monthly income", "12000"],
    ["Monthly essentials", "7000"],
    ["Required monthly debt payments", "1500"],
  ]) {
    await page.getByLabel(`${label} · CNY`, { exact: true }).fill(value);
  }
  for (const [category, value] of [
    ["Living", "8000"],
    ["Interest", "800"],
    ["Groceries", "1500"],
  ]) {
    await page.getByRole("button", { name: "Add budget", exact: true }).click();
    await page.getByLabel("Category", { exact: true }).last().fill(category);
    await page
      .getByLabel("Monthly budget · CNY", { exact: true })
      .last()
      .fill(value);
  }
  await page.getByRole("button", { name: "Review & save plan" }).click();
  dialog = page.getByRole("dialog", { name: "Review & confirm" });
  await dialog.getByRole("button", { name: "Confirm these details" }).click();
  await expect(dialog).not.toBeVisible();
  await navigate(page, "Dashboard");
  await page
    .getByLabel("Current currency", { exact: true })
    .selectOption("CNY");
  await openOverviewDetails(page);
  await expect(page.locator(".overview-metrics")).toContainText("33,500.00");
  await expect(page.locator(".overview-metrics")).toContainText("7,500.00");
  await expect(page.locator(".budget-tile")).toHaveCount(3);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(0, 0);
  await page.screenshot({
    animations: "disabled",
    path: `reports/ui-en-${test.info().project.name}-viewport.png`,
  });
  await page.screenshot({
    animations: "disabled",
    path: `reports/ui-en-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize().width);
  await navigate(page, "Transactions");
  await expect(page.locator(".table-wrap")).toContainText("Synthetic salary");
  await navigate(page, "Analysis");
  await openAnalysis(page);
  await page
    .getByLabel("Financial analysis question")
    .fill("Analyze this month's cash flow");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.locator(".answer")).toContainText("7500.00");
  expect(await page.locator(".answer").innerText()).not.toMatch(
    /[\u3400-\u9fff]/,
  );
  await navigate(page, "Statements");
  await page.getByRole("button", { name: /Generate .* statement/ }).click();
  await expectPdfReady(page);
  await expect(page.locator(".report-preview")).toContainText(
    "Personal Financial Statement",
  );
  await expect(page.locator(".report-preview")).toContainText("33,500.00");
  const english = await page.locator(".report-preview").innerText();
  const snapshot = await page
    .locator(".pdf-panel")
    .getAttribute("data-snapshot");
  await page.getByRole("button", { name: "中文", exact: true }).click();
  await expectPdfReady(page);
  await expect(page.locator(".pdf-panel")).toHaveAttribute(
    "data-snapshot",
    snapshot,
  );
  await expect(page.locator(".report-preview")).toContainText(
    "个人分析月度账单",
  );
  await expect(page.locator(".report-preview")).toContainText("33,500.00");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expectPdfReady(page);
  await expect(page.locator(".report-preview")).toHaveText(english, {
    useInnerText: true,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download PDF" }).click();
  await expectPdfDownload(await download, snapshot);
  expect(errors).toEqual([]);
});
