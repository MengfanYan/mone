import { test, expect } from "@playwright/test";
import { commandsAndHistory } from "./ux-flow.mjs";
const origin = "http://127.0.0.1:3097",
  code = "synthetic-browser-access-code";
test("live local commands clarify, edit and atomically correct without a banking API", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const call = async (path, data, key) => {
    const res = await request.post(`/api/${path}`, {
      headers: { Origin: origin, ...(key ? { "Idempotency-Key": key } : {}) },
      data,
    });
    expect(res.status()).toBe(200);
    return (await res.json()).data;
  };
  await call("session", { access_code: code });
  let c = await call("confirmation-challenges", {
    purpose: "privacy_delete",
    resource_id: "all",
    access_code: code,
  });
  await call("privacy/delete", {
    nonce: c.nonce,
    content_hash: c.content_hash,
  });
  await call("session", { access_code: code });
  c = await call("confirmation-challenges", {
    purpose: "consents",
    resource_id: "consents",
    payload: { analysis: true, ocr: true },
  });
  await request.put("/api/consents", {
    headers: { Origin: origin },
    data: {
      nonce: c.nonce,
      content_hash: c.content_hash,
      payload: { analysis: true, ocr: true },
    },
  });
  await call("accounts", {
    name: "Synthetic AUD",
    type: "cash",
    currency: "AUD",
    opening_balance: "1000",
    opened_on: "2026-09-01",
    mock: true,
  });
  await page.goto("/");
  await page.getByLabel("Local access code", { exact: true }).fill(code);
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await commandsAndHistory(page, false);
  expect(errors).toEqual([]);
});
