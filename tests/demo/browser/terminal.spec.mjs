import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  navigate,
  openAgent,
  openScenario,
  openAdvancedModel,
} from "../../e2e/ui-helpers.mjs";
import { inspectEncryptedBackup } from "../../../lib/terminal/vault.mjs";

test.beforeEach(async ({ page }) => {
  await page.goto("/demo");
  await expect(page.locator(".app-shell")).toBeVisible();
});

test("planning paths update reproducibly and allocation worksheets export without ledger changes", async ({
  page,
}) => {
  await navigate(page, "Budgets & goals");
  await openScenario(page);
  const initial = await page.locator(".scenario-metrics").textContent();
  await page.getByLabel("Monthly contribution", { exact: true }).fill("5000");
  await expect(page.locator(".scenario-metrics")).not.toHaveText(initial);
  await page
    .getByRole("button", {
      name: "Try the model's 90% contribution",
      exact: true,
    })
    .click();
  const rate = await page
    .locator(".scenario-metrics strong")
    .first()
    .innerText();
  expect(parseFloat(rate)).toBeGreaterThanOrEqual(90);
  await page
    .getByRole("button", { name: "Reset assumptions", exact: true })
    .click();
  await expect(page.locator(".scenario-metrics")).toHaveText(initial);
  await navigate(page, "Portfolio");
  await page
    .getByRole("button", { name: "Allocation worksheet", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Review your target weights",
    exact: true,
  });
  await expect(modal).toBeVisible();
  const waiting = page.waitForEvent("download");
  await modal
    .getByRole("button", { name: "Export reviewed worksheet", exact: true })
    .click();
  const download = await waiting;
  const csv = await readFile(await download.path(), "utf8");
  expect(csv).toContain("ILLUSTRATION_NOT_ORDER");
  expect(csv).toContain("AUD");
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Use synthetic price sample", exact: true })
    .click();
  await expect(page.locator(".risk-metrics")).toBeVisible();
  await expect(page.locator(".risk-metrics strong").first()).toHaveText(
    /^\d+\.\d{2}%$/,
  );
  await page
    .getByLabel("Unit-price CSV", { exact: true })
    .fill("observed_at,unit_price\n2026-09-01,100");
  await expect(page.locator(".risk-lab .terminal-empty")).toContainText(
    "Insufficient",
  );
  await expect(page.locator(".command-results")).toHaveCount(0);
});

test("ledger filters, exact sorting and selected CSV export use only visible scoped records", async ({
  page,
}) => {
  await navigate(page, "Transactions");
  await page
    .getByLabel("Transaction type", { exact: true })
    .selectOption("expense");
  await page.getByLabel("From date", { exact: true }).fill("2026-09-20");
  await page.getByLabel("To date", { exact: true }).fill("2026-09-30");
  await page
    .getByLabel("Sort records", { exact: true })
    .selectOption("amount-desc");
  await page
    .getByRole("checkbox", { name: /^Select record / })
    .first()
    .check();
  const waiting = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export 1 selected", exact: true })
    .click();
  const download = await waiting;
  const csv = await readFile(await download.path(), "utf8");
  expect(csv.trim().split("\r\n")).toHaveLength(2);
  expect(csv).toContain('"expense"');
  expect(csv).toContain('"AUD"');
  expect(csv).not.toContain("Opening balance");
});

test("settings persist, local sources produce citations, and demo model stays offline", async ({
  page,
}) => {
  await navigate(page, "Settings");
  await openAdvancedModel(page);
  await expect(
    page.getByLabel("Model identifier", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Maximum output tokens", { exact: true }).fill("750");
  await page
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Configuration saved");
  await page.reload();
  await navigate(page, "Settings");
  await openAdvancedModel(page);
  await expect(
    page.getByLabel("Maximum output tokens", { exact: true }),
  ).toHaveValue("750");
  await page.locator(".terminal-settings-grid input[type=file]").setInputFiles({
    name: "synthetic-terminal.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "UniqueExample savings policy. Keep an emergency reserve of six months.",
    ),
  });
  await expect(page.locator(".knowledge-documents")).toContainText(
    "synthetic-terminal.txt",
  );
  await page
    .getByLabel("Try a question", { exact: true })
    .fill("UniqueExample savings");
  await page
    .getByRole("button", { name: "Search locally", exact: true })
    .click();
  await expect(page.locator(".knowledge-results")).toContainText(
    "synthetic-terminal.txt",
  );
  await page
    .getByRole("button", { name: "Preview demo explanation", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Review offline demo payload",
    exact: true,
  });
  await expect(dialog).toContainText("NO NETWORK");
  await dialog
    .getByRole("button", { name: "Show preset explanation", exact: true })
    .click();
  await expect(page.locator(".terminal-insight")).toContainText(
    "HAND_WRITTEN_DEMO_PRESET",
  );
});

test("screen privacy removes financial DOM and encrypted export authenticates in WebCrypto", async ({
  page,
}) => {
  await expect(page.locator("main")).toContainText("Everyday account");
  await page
    .getByRole("button", { name: "Hide financial content", exact: true })
    .click();
  await expect(page.locator(".masked-panel")).toBeVisible();
  expect(await page.locator("main").textContent()).not.toContain(
    "Everyday account",
  );
  expect(await page.locator("main").textContent()).not.toContain("62,096");
  await page.reload();
  await expect(page.locator(".masked-panel")).toBeVisible();
  await page
    .getByRole("button", { name: "Reveal financial content", exact: true })
    .click();
  await expect(page.locator("main")).toContainText("Everyday account");
  await navigate(page, "Privacy & consent");
  await page
    .getByLabel("Backup password (12–200 characters)", { exact: true })
    .fill("synthetic-browser-backup-password");
  await page
    .getByRole("button", { name: "Review encrypted export", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Review & confirm",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const waiting = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Confirm these details", exact: true })
    .click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe("wallet-encrypted-backup.json");
  const raw = await readFile(await download.path(), "utf8");
  expect(raw).not.toContain("Everyday account");
  const contents = await inspectEncryptedBackup(
    JSON.parse(raw),
    "synthetic-browser-backup-password",
  );
  expect(contents.mock).toBe(true);
});

test("text PDF evidence is rendered locally and produces inspectable source candidates", async ({
  page,
}) => {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica),
    sheet = pdf.addPage([420, 280]);
  [
    "Merchant: Synthetic Harbor Coffee",
    "2026-09-20",
    "AUD 18.50",
    "Total: 18.50",
  ].forEach((line, i) =>
    sheet.drawText(line, { x: 30, y: 240 - i * 40, font, size: 16 }),
  );
  await openAgent(page);
  await page
    .getByRole("tab", { name: "Evidence & screenshots", exact: true })
    .click();
  await page.locator(".command-composer input[type=file]").setInputFiles({
    name: "synthetic-receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.locator(".composer-attachment")).toContainText(
    "synthetic-receipt.pdf",
  );
  await expect(
    page.getByLabel("Local task text", { exact: true }),
  ).toContainText("Synthetic Harbor Coffee");
  await page
    .getByRole("button", { name: "Extract candidates", exact: true })
    .click();
  await expect(page.locator(".evidence-workbench")).toBeVisible();
  await expect(
    page.locator(".evidence-workbench .source-preview img"),
  ).toBeVisible();
  await expect(page.locator(".evidence-result-card")).toHaveCount(1);
});
