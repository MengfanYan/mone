import { test, expect } from "@playwright/test";

const origin = "http://127.0.0.1:3097",
  code = "synthetic-browser-access-code";
async function call(request, method, path, data) {
  const response = await request[method]("/api/" + path, {
    headers: { Origin: origin },
    ...(data ? { data } : {}),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
test("Live notifications remain empty until API-confirmed salary, then refresh, persist and locate its record", async ({
  page,
  request,
}) => {
  await call(request, "post", "session", { access_code: code });
  let c = await call(request, "post", "confirmation-challenges", {
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
  await page.goto("/?tab=overview&period=2026-09&currency=AUD");
  await page.getByLabel("Local access code", { exact: true }).fill(code);
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(page.locator(".notification-center")).toContainText(
    "No notifications for this month",
  );
  const account = await call(request, "post", "accounts", {
    name: "Synthetic notification account",
    currency: "AUD",
    type: "cash",
    opening_balance: "0",
    opened_on: "2026-09-01",
  });
  const draft = await call(request, "post", "drafts", {
    kind: "income",
    category: "Salary",
    date: "2026-09-25",
    amount: "8200.01",
    currency: "AUD",
    merchant: "Synthetic employer",
    account_id: account.id,
  });
  await page
    .getByRole("button", { name: "Refresh notifications", exact: true })
    .click();
  await expect(page.locator(".notification-item")).toHaveCount(0);
  c = await call(request, "post", "confirmation-challenges", {
    purpose: "confirm_draft",
    resource_id: draft.id,
  });
  const result = await call(request, "post", `drafts/${draft.id}/confirm`, {
    nonce: c.nonce,
    content_hash: c.content_hash,
  });
  await page
    .getByRole("button", { name: "Refresh notifications", exact: true })
    .click();
  await expect(page.locator(".notification-item.income")).toContainText(
    "8,200.01",
  );
  await expect(
    page.locator(".notification-item.price,.notification-item.budget"),
  ).toHaveCount(0);
  await page.locator(".notification-item.income .notification-title").click();
  await expect(page.locator(".notification-detail")).toContainText(
    "does not verify receipt",
  );
  await page
    .getByRole("button", { name: "View salary record", exact: true })
    .click();
  const record = page
    .locator(`[data-resource="${result.event_id}"]`)
    .filter({ visible: true });
  await expect(record).toContainText("Synthetic employer");
  await page.getByRole("button", { name: /^Notifications, / }).click();
  await expect(
    page.getByRole("button", { name: "Notifications, 0 unread", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".notification-item.income")).toHaveClass(
    /is-read/,
  );
  const revoked = { analysis: false, ocr: false };
  c = await call(request, "post", "confirmation-challenges", {
    purpose: "consents",
    resource_id: "consents",
    payload: revoked,
  });
  await call(request, "put", "consents", {
    nonce: c.nonce,
    content_hash: c.content_hash,
    payload: revoked,
  });
  await page
    .getByRole("button", { name: "Refresh notifications", exact: true })
    .click();
  await expect(page.locator(".notification-center,.terminal-kpis")).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Notifications, 0 unread", exact: true }),
  ).toBeVisible();
});
