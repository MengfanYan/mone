import { test, expect } from "@playwright/test";
import { navigate, openAgent } from "../../e2e/ui-helpers.mjs";

test.beforeEach(async ({ page }) => {
  await page.goto("/demo");
  await expect(page.locator(".app-shell")).toBeVisible();
});

test("task modes have distinct inputs, local voice fallback and an explicit draft queue step", async ({
  page,
}) => {
  const errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      new URL(r.url()).origin !== "http://127.0.0.1:3101" &&
      /^http/.test(r.url())
    )
      external.push(r.url());
  });
  await openAgent(page);
  const panel = page.locator(".floating-agent-panel");
  await expect(panel.getByLabel("Choose evidence file")).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(window, "SpeechRecognition", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: undefined,
      configurable: true,
    });
  });
  await panel
    .getByRole("button", { name: "Local dictation", exact: true })
    .click();
  await expect(panel.locator(".local-dictation")).toContainText("unavailable");
  await panel
    .getByRole("tab", { name: "Evidence & screenshots", exact: true })
    .click();
  await expect(panel.locator(".evidence-dropzone")).toBeVisible();
  await expect(
    panel.getByLabel("Local task text", { exact: true }),
  ).not.toBeVisible();
  await panel
    .getByRole("button", {
      name: "Load sample receipt / statement",
      exact: true,
    })
    .click();
  await panel
    .getByLabel("Task account", { exact: true })
    .selectOption({ label: "Everyday account · AUD" });
  await panel
    .getByRole("button", { name: "Extract candidates", exact: true })
    .click();
  await expect(panel.locator(".evidence-workbench")).toBeVisible();
  await expect(panel.locator(".command-confirmation")).toHaveCount(0);
  await expect(panel.locator(".evidence-quality").first()).toContainText(
    "Preset",
  );
  await panel
    .getByRole("button", { name: "Add to Review Queue", exact: true })
    .click();
  await expect(panel.locator(".command-results-heading")).toContainText(
    "Drafts saved",
  );
  await panel
    .getByRole("tab", { name: "Read-only analysis", exact: true })
    .click();
  await expect(panel.locator(".advisory-card")).toHaveCount(3);
  await expect(
    panel.getByLabel("Ask a follow-up", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByLabel("Task account", { exact: true })).toHaveCount(
    0,
  );
  await panel
    .getByRole("tab", { name: "Record & search", exact: true })
    .click();
  await panel
    .getByLabel("Local task text", { exact: true })
    .fill("Harbor Coffee 18.50 AUD 2026-09-30, and check dining budget");
  await panel
    .getByRole("button", { name: "Preview task", exact: true })
    .click();
  await expect(panel.locator(".command-result")).toHaveCount(1);
  await expect(panel.locator(".advisory-followup")).toContainText(
    "candidate not included",
  );
  await navigate(page, "Dashboard");
  await expect(page.locator(".terminal-kpis")).toContainText("5,311.15");
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("budget proposal requires confirmation and repayment opens a reviewable draft", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Simulate a budget rebalance", exact: true })
    .first()
    .click();
  const panel = page.locator(".floating-agent-panel");
  await panel
    .getByRole("button", { name: "Simulate budget rebalance", exact: true })
    .click();
  await panel
    .getByLabel("Move allowance from", { exact: true })
    .selectOption("Groceries");
  await panel
    .getByRole("button", { name: "Preview exact changes", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "Review & confirm",
    exact: true,
  });
  await expect(review).toBeVisible();
  await expect(review).toContainText("181.00");
  await expect(review).toContainText("679.00");
  await review
    .getByRole("button", { name: "Confirm these details", exact: true })
    .click();
  await expect(review).not.toBeVisible();
  await navigate(page, "Analysis");
  const diagnostics = page.locator(".terminal-content > .advisor-insights");
  await expect(diagnostics).toContainText(
    "No approved category is over budget",
  );
  await diagnostics
    .getByRole("button", { name: "Draft payoff transfer", exact: true })
    .click();
  await diagnostics
    .getByLabel("Cash account", { exact: true })
    .selectOption({ label: "Everyday account · 32207.65 AUD" });
  await diagnostics
    .getByLabel("Liability account", { exact: true })
    .selectOption({ index: 1 });
  await diagnostics
    .getByRole("button", { name: "Open draft editor", exact: true })
    .click();
  await expect(page.locator(".editor-dialog")).toBeVisible();
  await expect(page.locator(".editor-dialog")).toContainText("Debt principal");
});

test("manual valuation, cash-flow scenario and narrative brief remain local and responsive", async ({
  page,
}, info) => {
  await navigate(page, "Analysis");
  const lab = page.getByRole("region", {
    name: "Financial planning lab",
    exact: true,
  });
  await lab
    .getByRole("button", { name: "Unified net worth", exact: true })
    .click();
  await expect(lab.locator(".lab-result")).toContainText(
    "Missing prices or quotes",
  );
  for (const q of await lab.locator(".fx-quote").all()) {
    await q.locator("input").nth(0).fill("1");
    await q.getByLabel("Quote date", { exact: true }).fill("2026-09-30");
    await q
      .getByLabel("Source / provider", { exact: true })
      .fill("Manual acceptance fixture");
  }
  await expect(lab.locator(".lab-result")).not.toContainText(
    "Missing prices or quotes",
  );
  await lab
    .getByRole("button", { name: "Cash-flow sandbox", exact: true })
    .click();
  await lab
    .getByRole("button", { name: "Add unpaid commitment", exact: true })
    .click();
  await lab.getByLabel("Description", { exact: true }).fill("Rent");
  await lab.getByLabel("Amount", { exact: true }).fill("2450");
  await lab.getByLabel("Monthly", { exact: true }).check();
  await lab.getByLabel("What-if purchase amount", { exact: true }).fill("3000");
  await expect(lab.locator(".projection-grid article")).toHaveCount(3);
  await expect(lab.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({
    path: `reports/advisory-${info.project.name}-cash.png`,
    fullPage: true,
    animations: "disabled",
  });
  await lab.getByRole("button", { name: "Monthly brief", exact: true }).click();
  const download = page.waitForEvent("download");
  await lab
    .getByRole("button", { name: "Download Markdown brief", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe(
    "financial-brief-2026-09-AUD.md",
  );
  await expect(lab.locator(".narrative-preview")).toContainText(
    "Source events",
  );
  await navigate(page, "Dashboard");
  if (info.project.name === "desktop") {
    const cards = await page
      .locator(".terminal-kpis > .terminal-kpi")
      .evaluateAll((es) =>
        es.map((e) => ({
          top: e.getBoundingClientRect().top,
          width: e.getBoundingClientRect().width,
        })),
      );
    expect(
      Math.max(...cards.map((c) => c.top)) -
        Math.min(...cards.map((c) => c.top)),
    ).toBeLessThan(2);
    expect(
      Math.max(...cards.map((c) => c.width)) -
        Math.min(...cards.map((c) => c.width)),
    ).toBeLessThan(2);
  }
  await page.screenshot({
    path: `reports/advisory-${info.project.name}-dashboard.png`,
    fullPage: true,
    animations: "disabled",
  });
  await openAgent(page);
  await page
    .getByRole("tab", { name: "Evidence & screenshots", exact: true })
    .click();
  await page.screenshot({
    path: `reports/advisory-${info.project.name}-evidence.png`,
    animations: "disabled",
  });
});

test("on-device speech is forced local and aborts when task workspace is closed", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.speechAudit = [];
    class LocalSpeech {
      static async available(options) {
        window.speechAudit.push(options);
        return "available";
      }
      start() {
        window.speechAudit.push({
          started: true,
          processLocally: this.processLocally,
          lang: this.lang,
        });
        this.onresult({
          results: [[{ transcript: "Harbor Coffee 18.50 AUD today" }]],
        });
      }
      abort() {
        window.speechAudit.push({ aborted: true });
      }
    }
    LocalSpeech.prototype.processLocally = false;
    window.SpeechRecognition = LocalSpeech;
  });
  await openAgent(page);
  await page
    .getByRole("button", { name: "Local dictation", exact: true })
    .click();
  await expect(page.getByLabel("Local task text", { exact: true })).toHaveValue(
    "Harbor Coffee 18.50 AUD today",
  );
  await page.locator(".floating-agent-launcher").click();
  const audit = await page.evaluate(() => window.speechAudit);
  expect(audit[0]).toEqual({ langs: ["en-US"], processLocally: true });
  expect(audit[1]).toEqual({
    started: true,
    processLocally: true,
    lang: "en-US",
  });
  expect(audit.at(-1)).toEqual({ aborted: true });
});
