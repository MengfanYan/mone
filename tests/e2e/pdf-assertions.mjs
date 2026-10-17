import { expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";

export async function expectPdfReady(page) {
  await expect(page.locator(".report-preview")).toHaveAttribute(
    "data-ready",
    "true",
  );
  expect(
    await page.locator(".report-preview canvas").evaluate((c) => c.width),
  ).toBeGreaterThan(100);
  await expect(page.locator(".report-preview pre")).toHaveCount(0);
}

export async function expectPdfDownload(download, snapshot) {
  expect(download.suggestedFilename()).toMatch(/^wallet-.*\.pdf$/);
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
  if (snapshot) expect(doc.getSubject()).toContain(snapshot);
  return doc;
}
