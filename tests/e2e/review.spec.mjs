import { test, expect } from "@playwright/test";
import { scopeAndNavigation, duplicateConfirmation } from "./review-flow.mjs";
const code = "synthetic-browser-access-code",
  origin = "http://127.0.0.1:3097";
async function call(request, method, path, data) {
  const r = await request[method](`/api/${path}`, {
    headers: { Origin: origin },
    ...(data && { data }),
  });
  expect(r.status()).toBe(200);
  return (await r.json()).data;
}
test.beforeEach(async ({ page, request }) => {
  await call(request, "post", "session", { access_code: code });
  const c = await call(request, "post", "confirmation-challenges", {
    purpose: "privacy_delete",
    resource_id: "all",
    access_code: code,
  });
  await call(request, "post", "privacy/delete", {
    nonce: c.nonce,
    content_hash: c.content_hash,
  });
  await call(request, "post", "session", { access_code: code });
  const payload = { analysis: true, ocr: false };
  const consent = await call(request, "post", "confirmation-challenges", {
    purpose: "consents",
    resource_id: "consents",
    payload,
  });
  await call(request, "put", "consents", {
    nonce: consent.nonce,
    content_hash: consent.content_hash,
    payload,
  });
  for (const currency of ["AUD", "USD"]) {
    const account = await call(request, "post", "accounts", {
      name: `Synthetic ${currency}`,
      currency,
      type: "cash",
      opening_balance: "1000",
      opened_on: "2026-09-01",
      mock: true,
    });
    for (let i = 0; i < 2; i++) {
      const d = await call(request, "post", "drafts", {
        amount: "7",
        currency,
        date: "2026-09-10",
        merchant: "Synthetic Coffee",
        category: "Dining",
        kind: "expense",
        account_id: account.id,
        mock: true,
      });
      if (!i) {
        const preview = await call(request, "post", "confirmation-challenges", {
          purpose: "confirm_draft",
          resource_id: d.id,
        });
        await call(request, "post", `drafts/${d.id}/confirm`, {
          nonce: preview.nonce,
          content_hash: preview.content_hash,
        });
      }
    }
  }
  await page.goto("/?tab=overview&period=2026-09&currency=AUD");
  await page.getByLabel("Local access code", { exact: true }).fill(code);
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(page.locator(".app-shell")).toBeVisible();
});
test("review: Live scoped education, evidence, refresh/back navigation and editor error isolation", async ({
  page,
}) => {
  await scopeAndNavigation(page);
});
test("review: Live duplicate gate survives final confirmation and records the reason", async ({
  page,
  request,
}) => {
  const before = await call(request, "get", "state?period=2026-09");
  await duplicateConfirmation(page, "Synthetic Coffee");
  const after = await call(request, "get", "state?period=2026-09");
  expect(after.transactions.length).toBe(before.transactions.length + 1);
  expect(
    after.transactions.some((e) =>
      e.evidence?.duplicate_override?.reason.includes("distinct purchase"),
    ),
  ).toBe(true);
});
test("review: delayed old-currency analysis cannot replace a newly scoped result", async ({
  page,
}) => {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Analysis", exact: true })
    .click();
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const seen = new Promise((resolve) => {
    page.route("**/api/analyses", async (route) => {
      const data = route.request().postDataJSON();
      if (data.currency === "AUD") {
        const response = await route.fetch();
        resolve();
        await waiting;
        await route.fulfill({ response });
      } else await route.continue();
    });
  });
  await page
    .getByLabel("Financial analysis question", { exact: true })
    .fill("Analyze spending");
  await page.locator(".analysis-query .primary").click();
  await seen;
  await page
    .getByLabel("Current currency", { exact: true })
    .selectOption("USD");
  release();
  await expect(page.locator(".analysis-query .primary")).toBeEnabled();
  await expect(page.locator(".answer")).toHaveCount(0);
  await page.locator(".analysis-query .primary").click();
  await expect(page.locator(".answer .answer-metrics")).toContainText("USD");
  await expect(page.locator(".answer .answer-metrics")).not.toContainText(
    "AUD",
  );
});
