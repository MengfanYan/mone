import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { navigate, openAgent, openAdvancedModel } from "./ui-helpers.mjs";

const origin = "http://127.0.0.1:3097",
  code = "synthetic-browser-access-code";
async function call(request, method, path, data) {
  const response = await request[method](`/api/${path}`, {
    headers: { Origin: origin },
    ...(data ? { data } : {}),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
test.beforeEach(async ({ page, request }) => {
  await call(request, "post", "session", { access_code: code });
  const confirmation = await call(request, "post", "confirmation-challenges", {
    purpose: "privacy_delete",
    resource_id: "all",
    access_code: code,
  });
  await call(request, "post", "privacy/delete", {
    nonce: confirmation.nonce,
    content_hash: confirmation.content_hash,
  });
  await call(request, "post", "session", { access_code: code });
  const payload = { analysis: true, ocr: true },
    c = await call(request, "post", "confirmation-challenges", {
      purpose: "consents",
      resource_id: "consents",
      payload,
    });
  await call(request, "put", "consents", {
    nonce: c.nonce,
    content_hash: c.content_hash,
    payload,
  });
  await call(request, "post", "accounts", {
    name: "Synthetic terminal account",
    currency: "AUD",
    type: "cash",
    opening_balance: "1000",
    opened_on: "2026-09-01",
    mock: true,
  });
  await page.goto("/");
  await page.getByLabel("Local access code", { exact: true }).fill(code);
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(page.locator(".app-shell")).toBeVisible();
});

test("live settings and local evidence search persist in the private store and audit correctly", async ({
  page,
}) => {
  await navigate(page, "Settings");
  await openAdvancedModel(page);
  await expect(page.locator(".terminal-settings-grid")).toContainText(
    "NOT CONFIGURED",
  );
  await page.getByLabel("Maximum output tokens", { exact: true }).fill("800");
  await page
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Configuration saved");
  await page.locator(".terminal-settings-grid input[type=file]").setInputFiles({
    name: "synthetic-evidence.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "UniqueLocalSource reserve policy uses six months of essential spending.",
    ),
  });
  await expect(page.locator(".knowledge-documents")).toContainText(
    "synthetic-evidence.txt",
  );
  await page
    .getByLabel("Try a question", { exact: true })
    .fill("UniqueLocalSource reserve");
  await page
    .getByRole("button", { name: "Search locally", exact: true })
    .click();
  await expect(page.locator(".knowledge-results")).toContainText(
    "synthetic-evidence.txt",
  );
  await expect(
    page.getByRole("button", { name: "Review cloud payload", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await navigate(page, "Settings");
  await openAdvancedModel(page);
  await expect(
    page.getByLabel("Maximum output tokens", { exact: true }),
  ).toHaveValue("800");
  await navigate(page, "Privacy & consent");
  await expect(page.locator(".terminal-audit")).toContainText(
    "knowledge.import",
  );
  await expect(page.locator(".terminal-settings-grid")).toContainText(
    "Chain verified",
  );
});

test("scanned single-page PDF renders to local OCR and exposes aligned source boxes", async ({
  page,
}) => {
  const document = await PDFDocument.create(),
    image = await document.embedPng(
      await readFile("tests/fixtures/evidence/receipt.png"),
    ),
    sheet = document.addPage([image.width, image.height]);
  sheet.drawImage(image, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  });
  await openAgent(page);
  await page.getByLabel("Analysis month", { exact: true }).fill("2026-09");
  await page
    .getByLabel("Task account", { exact: true })
    .selectOption({ label: "Synthetic terminal account · AUD" });
  await page
    .getByRole("tab", { name: "Evidence & screenshots", exact: true })
    .click();
  await page.locator(".command-composer input[type=file]").setInputFiles({
    name: "synthetic-scanned-receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await document.save()),
  });
  await expect(page.locator(".composer-attachment")).toContainText(
    "synthetic-scanned-receipt.pdf",
  );
  await page
    .getByRole("button", { name: "Extract candidates", exact: true })
    .click();
  await expect(page.locator(".evidence-workbench")).toBeVisible();
  await expect(page.locator(".evidence-workbench")).toContainText(
    "tesseract-local",
  );
  await expect(page.locator(".command-result-value")).toContainText("7.00");
  expect(await page.locator(".source-box").count()).toBeGreaterThan(5);
  await page.getByRole("button", { name: "Locate", exact: true }).click();
  await expect(page.locator(".source-box.active").first()).toBeVisible();
});
