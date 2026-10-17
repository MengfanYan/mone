import {
  expectPdfReady,
  expectPdfDownload,
} from "../../e2e/pdf-assertions.mjs";
import {
  navigate as nav,
  openTools,
  openPlanning,
  openAnalysis,
  resetDemo,
  acknowledgeDuplicates,
} from "../../e2e/ui-helpers.mjs";
import { test, expect } from "@playwright/test";
const tabs = [
  "Dashboard",
  "Transactions",
  "Budgets & goals",
  "Portfolio",
  "Statements",
  "Analysis",
  "Privacy & consent",
  "Settings",
];
async function confirm(page) {
  const dialog = page.getByRole("dialog", {
    name: "Review & confirm",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await acknowledgeDuplicates(dialog);
  await dialog
    .getByRole("button", { name: "Confirm these details", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}
async function boundary(page) {
  const apiRequests = [],
    externalRequests = [],
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) apiRequests.push(url.pathname);
    if (
      /^https?:$/.test(url.protocol) &&
      url.origin !== "http://127.0.0.1:3101"
    )
      externalRequests.push(url.href);
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname.startsWith("/api/") ||
      (/^https?:$/.test(url.protocol) && url.origin !== "http://127.0.0.1:3101")
    )
      return route.abort();
    return route.continue();
  });
  return () => {
    expect(errors).toEqual([]);
    expect(apiRequests).toEqual([]);
    expect(externalRequests).toEqual([]);
  };
}

test("every module is populated and bilingual without any API or external request", async ({
  page,
}) => {
  const check = await boundary(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("About demo mode")).toContainText(
    "September 2026 preset",
  );
  for (const tab of tabs) {
    await nav(page, tab);
    await expect(
      page.getByRole("heading", { name: tab, exact: true }),
    ).toBeVisible();
    expect(
      (await page.locator("body").innerText()).replaceAll("中文", ""),
    ).not.toMatch(/[\u3400-\u9fff]/);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `${tab} should fit viewport`,
    ).toBeLessThanOrEqual(page.viewportSize().width);
    if (tab === "Transactions")
      await expect(page.locator(".draft-card")).toHaveCount(3);
    if (tab === "Portfolio") {
      await expect(page.locator(".investment-card-grid")).toContainText(
        "Broad Market ETF",
      );
      await page
        .getByLabel("Current currency", { exact: true })
        .selectOption("USD");
      await expect(page.locator(".investment-card-grid")).toContainText(
        "Global Bond Fund",
      );
      await page
        .getByLabel("Current currency", { exact: true })
        .selectOption("AUD");
    }
    if (tab === "Statements") await expectPdfReady(page);
    if (tab === "Statements")
      await page.locator(".pdf-panel").screenshot({
        path: `reports/ux-pdf-panel-${test.info().project.name}.png`,
        animations: "disabled",
      });
    if (tab === "Budgets & goals")
      await page
        .locator(".relation-grid")
        .first()
        .screenshot({
          path: `reports/ux-budget-relations-${test.info().project.name}.png`,
          animations: "disabled",
        });
    if (tab === "Statements")
      await expect(page.locator(".report-preview")).toContainText(
        "Personal Financial Statement",
      );
    if (tab === "Analysis")
      await expect(page.locator(".answer")).toContainText(
        "No AI model is called",
      );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(0, 0);
    await page.screenshot({
      animations: "disabled",
      path: `reports/ui-demo-${tab.toLowerCase().replace(/\W+/g, "-")}-${test.info().project.name}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "中文", exact: true }).click();
  for (const name of [
    "财务概览",
    "账本与导入",
    "预算与目标",
    "投资记录",
    "月度账单",
    "分析助手",
    "隐私与授权",
    "系统设置",
  ]) {
    await nav(page, name);
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      name,
    ).toBeLessThanOrEqual(page.viewportSize().width);
  }
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("heading", { name: "系统设置", exact: true }),
  ).toBeVisible();
  check();
});

test("offline interactions: drafts, CSV, receipt, budgets, reports, analysis, export, deletion and reset", async ({
  page,
  context,
}) => {
  const check = await boundary(page);
  await page.goto("/demo");
  await expect(page.locator(".overview-metrics")).toContainText("9,050.00");
  const initialMetrics = await page.locator(".overview-metrics").textContent();
  await nav(page, "Transactions");
  const receiptDraft = page
    .locator(".draft-card")
    .filter({ hasText: "Fresh Market · receipt candidate" });
  await receiptDraft
    .getByRole("button", { name: "Review & confirm", exact: true })
    .click();
  await confirm(page);
  await expect(page.locator(".draft-card")).toHaveCount(2);
  await page.reload();
  await nav(page, "Transactions");
  await expect(page.locator(".draft-card")).toHaveCount(2);
  await context.setOffline(true);
  await openTools(page);
  await page
    .locator(".ledger-tools")
    .getByRole("button", { name: "Import CSV", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Fill sample CSV", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import as drafts", exact: true })
    .click();
  await expect(page.locator(".draft-card")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Receipt recognition", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Fill sample receipt", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extract draft", exact: true })
    .click();
  await expect(page.locator(".draft-card")).toHaveCount(5);
  await nav(page, "Budgets & goals");
  await openPlanning(page);
  await page.getByLabel("Earmarked funds · AUD", { exact: true }).fill("8000");
  await page
    .getByRole("button", { name: "Review & save plan", exact: true })
    .click();
  await confirm(page);
  await nav(page, "Statements");
  await expect(page.locator(".report-preview")).toContainText(
    "Personal Financial Statement",
  );
  await expectPdfReady(page);
  const original = await page.locator(".report-preview").innerText();
  const oldSnapshot = await page
    .locator(".pdf-panel")
    .getAttribute("data-snapshot");
  await page.getByRole("button", { name: /Generate .* statement/ }).click();
  await expect(page.locator(".pdf-panel")).not.toHaveAttribute(
    "data-snapshot",
    oldSnapshot,
  );
  await expectPdfReady(page);
  await expect(page.locator(".report-preview")).not.toHaveText(original);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expectPdfReady(page);
  await expect(page.locator(".report-preview")).toContainText("USD");
  await page
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await expectPdfReady(page);
  await page.getByLabel("PDF zoom", { exact: true }).selectOption("1.5");
  await expectPdfReady(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize().width);
  await page.getByLabel("PDF zoom", { exact: true }).selectOption("fit");
  await expectPdfReady(page);
  const file = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download PDF" }).click();
  const exported = await file;
  const snapshot = await page
    .locator(".pdf-panel")
    .getAttribute("data-snapshot");
  await expectPdfDownload(exported, snapshot);
  await exported.saveAs(
    `tmp/pdfs/statement-demo-${test.info().project.name}.pdf`,
  );
  await nav(page, "Analysis");
  await openAnalysis(page);
  await page
    .getByLabel("Financial analysis question")
    .fill("Review market context");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.locator(".answer")).toContainText(
    "Preset market index (fictional)",
  );
  await page
    .getByRole("button", { name: "Load market presets", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "No external request was made",
  );
  await page.getByLabel("Financial analysis question").fill("buy stocks");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.locator(".answer")).toContainText(
    "The demo performs no money operations",
  );
  await nav(page, "Privacy & consent");
  const json = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Review full data export", exact: true })
    .click();
  await confirm(page);
  expect((await json).suggestedFilename()).toBe("wallet-demo-export.json");
  await page
    .getByRole("button", { name: "Review full data deletion", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Review & confirm",
    exact: true,
  });
  await expect(dialog).toContainText("live version is unaffected");
  await dialog
    .getByRole("button", {
      name: "Delete all local data",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Explore the product demo",
      exact: true,
    }),
  ).toBeVisible();
  await resetDemo(page);
  await expect(page.locator(".overview-metrics")).toHaveText(initialMetrics);
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator(".overview-metrics")).toHaveText(initialMetrics);
  check();
});

test("demo server refuses live API paths without a backend", async ({
  request,
}) => {
  for (const path of ["health", "state", "session", "market/refresh"]) {
    const response = await request.get(`/api/${path}`, {
      headers: { "Accept-Language": "en" },
    });
    expect(response.status()).toBe(503);
    expect((await response.json()).error.code).toBe("DEMO_API_DISABLED");
    expect(response.headers()["content-language"]).toBe("en");
  }
});
