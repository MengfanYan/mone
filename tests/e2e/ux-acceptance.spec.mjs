import { test, expect } from "@playwright/test";
import { navigate, openAgent } from "./ui-helpers.mjs";
import { task, submitTask } from "./ux-flow.mjs";
const origin = "http://127.0.0.1:3097",
  code = "synthetic-browser-access-code";
async function json(request, method, path, data) {
  const res = await request[method](`/api/${path}`, {
    headers: { Origin: origin },
    ...(data ? { data } : {}),
  });
  expect(res.status()).toBe(200);
  return (await res.json()).data;
}
async function reset(request) {
  await json(request, "post", "session", { access_code: code });
  const c = await json(request, "post", "confirmation-challenges", {
    purpose: "privacy_delete",
    resource_id: "all",
    access_code: code,
  });
  await json(request, "post", "privacy/delete", {
    nonce: c.nonce,
    content_hash: c.content_hash,
  });
  await json(request, "post", "session", { access_code: code });
}
async function consent(request, values) {
  const c = await json(request, "post", "confirmation-challenges", {
    purpose: "consents",
    resource_id: "consents",
    payload: values,
  });
  await json(request, "put", "consents", {
    nonce: c.nonce,
    content_hash: c.content_hash,
    payload: values,
  });
}
async function login(page) {
  await page.goto("/");
  await page.getByLabel("Local access code", { exact: true }).fill(code);
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(page.locator(".app-shell")).toBeVisible();
}
test.beforeEach(async ({ request }) => reset(request));

test("an in-flight authorized snapshot cannot reopen or repopulate a locked workspace", async ({
  page,
  request,
}) => {
  await json(request, "post", "accounts", {
    name: "Private delayed snapshot",
    type: "cash",
    currency: "AUD",
    opening_balance: "0",
    opened_on: "2026-01-01",
    mock: true,
  });
  await login(page);
  let release, captured;
  const waiting = new Promise((resolve) => {
    captured = resolve;
  });
  await page.route("**/api/state?period=2026-08", async (route) => {
    const response = await route.fetch();
    const held = new Promise((resolve) => {
      release = resolve;
    });
    captured();
    await held;
    await route.fulfill({ response });
  });
  await page.getByLabel("Analysis month", { exact: true }).fill("2026-08");
  await waiting;
  await page
    .getByRole("button", { name: "Lock workspace", exact: true })
    .click();
  await expect(
    page.getByLabel("Local access code", { exact: true }),
  ).toBeVisible();
  const delivered = page.waitForResponse((r) =>
    r.url().endsWith("/api/state?period=2026-08"),
  );
  release();
  await delivered;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        window.requestAnimationFrame(() =>
          window.requestAnimationFrame(resolve),
        ),
      ),
  );
  await expect(page.locator(".app-shell")).not.toBeVisible();
  await expect(
    page.getByLabel("Local access code", { exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/state")).status()).toBe(401);
});

test("browser security headers, inert imported markup, private session cookie and lock leave no financial browser storage", async ({
  page,
  request,
  context,
}) => {
  const merchant = '<img src=x onerror="window.__walletInjected=1">';
  const a = await json(request, "post", "accounts", {
    name: "Private synthetic account",
    type: "cash",
    currency: "AUD",
    opening_balance: "0",
    opened_on: "2026-09-01",
    mock: true,
  });
  await json(request, "post", "drafts", {
    amount: "7",
    currency: "AUD",
    date: "2026-09-10",
    merchant,
    kind: "expense",
    category: "Dining",
    account_id: a.id,
    mock: true,
  });
  // Simulate markup arriving in the HTML response. DevTools evaluate is a
  // privileged execution context, so it is not a reliable CSP attack test.
  await page.route(`${origin}/`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        "</body>",
        "<script>window.__walletInjected=1</script></body>",
      ),
    });
  });
  const response = await page.goto("/");
  const h = response.headers();
  expect(h["content-security-policy"]).toContain("connect-src 'self'");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).not.toContain("'unsafe-eval'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect(h["permissions-policy"]).toContain("camera=()");
  const nonce = await page
    .locator("script[nonce]")
    .first()
    .evaluate((e) => e.nonce);
  expect(nonce.length).toBeGreaterThanOrEqual(24);
  expect(h["content-security-policy"]).toContain(`'nonce-${nonce}'`);
  const refreshed = await page.reload();
  expect(refreshed.headers()["content-security-policy"]).not.toContain(
    `'nonce-${nonce}'`,
  );
  await page.getByLabel("Local access code", { exact: true }).fill(code);
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await navigate(page, "Transactions");
  await expect(page.locator(".draft-card")).toContainText(merchant);
  expect(await page.locator('.draft-card img[src="x"]').count()).toBe(0);
  expect(await page.evaluate(() => window.__walletInjected)).toBeUndefined();
  const session = (await context.cookies()).find(
    (c) => c.name === "wallet_session",
  );
  expect(session.httpOnly).toBe(true);
  expect(session.sameSite).toBe("Strict");
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "wallet_session",
  );
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...window.localStorage },
        session: { ...window.sessionStorage },
      }),
    ),
  ).not.toContain("Private synthetic account");
  expect(await page.evaluate(() => Object.keys(window.localStorage))).toEqual(
    [],
  );
  await page
    .getByRole("button", { name: "Lock workspace", exact: true })
    .click();
  await expect(page.locator(".app-shell")).not.toBeVisible();
  const locked = await page.request.get("/api/state");
  expect(locked.status()).toBe(401);
  await page.reload();
  await expect(
    page.getByLabel("Local access code", { exact: true }),
  ).toBeVisible();
});

test("Chinese receipt/bank/fund PNGs upload, clarify and confirm with traceable fields and no fund cash income", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await consent(request, { analysis: true, ocr: true });
  const a = await json(request, "post", "accounts", {
    name: "Synthetic evidence AUD",
    type: "cash",
    currency: "AUD",
    opening_balance: "1000",
    opened_on: "2026-09-01",
    mock: true,
  });
  await login(page);
  await page.getByLabel("Analysis month", { exact: true }).fill("2026-09");
  await openAgent(page);
  await page.getByLabel("Task account", { exact: true }).selectOption(a.id);
  const upload = async (type) => {
    await page
      .getByRole("tab", { name: "Evidence & screenshots", exact: true })
      .click();
    await page
      .getByLabel("Choose evidence file", { exact: true })
      .setInputFiles(`tests/fixtures/evidence/${type}.png`);
    await page
      .getByRole("group", { name: "Evidence type", exact: true })
      .getByRole("button", {
        name: {
          receipt: "Receipt",
          bank: "Bank statement",
          investment: "Investment value & performance",
        }[type],
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("img", {
        name: "Original image awaiting recognition",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".composer-attachment")).toContainText(
      `${type}.png`,
    );
    const extract = page.getByRole("button", {
      name: "Extract candidates",
      exact: true,
    });
    await extract.click();
    await expect(extract).toBeEnabled();
  };
  await upload("receipt");
  await expect(page.locator(".command-result")).toContainText("咖啡生活馆");
  await expect(page.locator(".command-result-value")).toContainText("7.00");
  await submitTask(page);
  await upload("bank");
  await expect(page.locator(".command-result")).toHaveCount(3);
  await expect(page.locator(".command-result").nth(2)).toContainText(
    "Counterparty",
  );
  await expect(
    page.locator(".command-result").nth(2).getByRole("checkbox"),
  ).not.toBeChecked();
  await submitTask(page);
  const before = await json(page.request, "get", "state?period=2026-09");
  expect(before.summary.find((s) => s.currency === "AUD").income).toBe(
    "200.00",
  );
  expect(before.summary.find((s) => s.currency === "AUD").expenses).toBe(
    "14.00",
  );
  await upload("investment");
  await expect(page.locator(".command-result")).toContainText("中文基金");
  await page
    .getByLabel("Candidate o1 target", { exact: true })
    .selectOption("new");
  await page.locator(".command-result").getByRole("checkbox").check();
  await page
    .locator(".command-result")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Edit task candidate",
    exact: true,
  });
  await expect(
    editor.getByLabel("Daily gain (not cumulative)", { exact: true }),
  ).toHaveValue("60.00");
  await expect(
    editor.getByLabel("Source-reported cumulative gain", { exact: true }),
  ).toHaveValue("500.00");
  await editor
    .getByRole("button", { name: "Keep candidate changes", exact: true })
    .click();
  await submitTask(page);
  const after = await json(page.request, "get", "state?period=2026-09");
  expect(after.transactions).toEqual(before.transactions);
  expect(after.investments).toHaveLength(1);
  expect(after.investments[0].latest.market_value).toBe("20500.00");
  await page
    .locator(".command-result")
    .getByRole("button", { name: "View record", exact: true })
    .click();
  const entry = page.locator(`[data-investment="${after.investments[0].id}"]`);
  await expect(entry.locator(".performance-value")).toContainText("500.00");
  await expect(entry).toContainText("Only one point");
  expect(errors).toEqual([]);
});

test("empty workspace candidate, local account setup, keyboard editor, drafts/deep link, and disabled purposes", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await task(page, "Coffee 7 AUD");
  await expect(page.locator(".command-result")).toHaveCount(1);
  await expect(page.locator(".command-result")).toContainText("Account");
  await expect(page.locator(".command-confirmation")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add local account", exact: true })
    .click();
  const account = page.getByRole("dialog", {
    name: "Add account",
    exact: true,
  });
  await account
    .getByLabel("Account name", { exact: true })
    .fill("Synthetic keyboard cash");
  await account.getByLabel("Opening cash balance", { exact: true }).fill("100");
  await account
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(account).not.toBeVisible();
  await page
    .getByLabel("Candidate o1 account", { exact: true })
    .selectOption({ label: "Synthetic keyboard cash" });
  await page
    .locator(".command-result")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  let editor = page.getByRole("dialog", {
    name: "Edit task candidate",
    exact: true,
  });
  await expect(editor.getByLabel("Account", { exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(editor).toBeVisible();
  expect(
    await page.evaluate(() => !!document.activeElement.closest("dialog")),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(editor).not.toBeVisible();
  await expect(
    page
      .locator(".command-result")
      .getByRole("button", { name: "Edit", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Add to Review Queue", exact: true })
    .click();
  await expect(page.locator(".command-results-heading")).toContainText(
    "Drafts saved",
  );
  const state = await json(page.request, "get", "state");
  expect(state.summary).toBeNull();
  const id = state.drafts[0].id;
  await page.goto(`/?tab=ledger&draft_id=${id}&edit=1`);
  editor = page.locator("dialog[open]");
  await expect(editor.getByLabel("Amount · AUD", { exact: true })).toHaveValue(
    "7.00",
  );
  await editor.getByLabel("Amount · AUD", { exact: true }).fill("6.50");
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(editor).not.toBeVisible();
  const changed = await json(page.request, "get", "state");
  expect(changed.drafts[0].id).toBe(id);
  expect(changed.drafts[0].version).toBe(2);
  await navigate(page, "Analysis");
  await task(page, "find Coffee");
  await expect(page.locator(".command-result")).toContainText("6.50");
  expect(await page.locator(".query-summaries").count()).toBe(0);
  await page
    .getByRole("tab", { name: "Evidence & screenshots", exact: true })
    .click();
  await page.locator(".raw-evidence-entry summary").click();
  await page
    .getByLabel("Local task text", { exact: true })
    .fill("Synthetic receipt\n2026-09-10\nTotal 7 AUD");
  await page
    .getByRole("button", { name: "Extract candidates", exact: true })
    .click();
  await expect(page.locator(".command-composer [role=alert]")).toContainText(
    /consent/i,
  );
  expect(errors).toEqual([]);
});
