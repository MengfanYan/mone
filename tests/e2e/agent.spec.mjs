import { test, expect } from "@playwright/test";
import { navigate, openAgent, openScenario } from "./ui-helpers.mjs";
import { task, submitTask } from "./ux-flow.mjs";

const code = "synthetic-browser-access-code",
  origin = "http://127.0.0.1:3097";
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
  const remove = await call(request, "post", "confirmation-challenges", {
    purpose: "privacy_delete",
    resource_id: "all",
    access_code: code,
  });
  await call(request, "post", "privacy/delete", {
    nonce: remove.nonce,
    content_hash: remove.content_hash,
  });
  await call(request, "post", "session", { access_code: code });
  const payload = { analysis: true, ocr: false };
  const c = await call(request, "post", "confirmation-challenges", {
    purpose: "consents",
    resource_id: "consents",
    payload,
  });
  await call(request, "put", "consents", {
    nonce: c.nonce,
    content_hash: c.content_hash,
    payload,
  });
  await page.goto("/");
  await page.getByLabel("Local access code", { exact: true }).fill(code);
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(page.locator(".app-shell")).toBeVisible();
});

test("fresh Live uses English and API-backed empty states in every module", async ({
  page,
  request,
}) => {
  const unexpected = [];
  page.on("request", (req) => {
    if (
      /terminal\/simulation|model-explanation|market\/refresh|demo\/reset/.test(
        req.url(),
      )
    )
      unexpected.push(req.url());
  });
  await expect(page.locator(".floating-agent-launcher")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page.locator(".agent-console")).toHaveCount(0);
  await expect(page.locator(".command-area")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Try the demo", exact: true }),
  ).toHaveCount(0);
  for (const name of [
    "Dashboard",
    "Transactions",
    "Budgets & goals",
    "Portfolio",
    "Statements",
    "Analysis",
    "Privacy & consent",
    "Settings",
  ]) {
    await navigate(page, name);
    const strings = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter(
          (e) =>
            e.getClientRects().length &&
            window.getComputedStyle(e).visibility !== "hidden",
        )
        .flatMap((e) =>
          [...e.childNodes]
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent)
            .concat([
              e.getAttribute("placeholder") || "",
              e.getAttribute("aria-label") || "",
            ]),
        )
        .join(" ")
        .replaceAll("中文", ""),
    );
    expect(strings, name).not.toMatch(/[\u3400-\u9fff]/);
    if (name === "Budgets & goals") {
      await openScenario(page);
      for (const input of await page
        .locator(".scenario-controls input[type=number]")
        .all())
        await expect(input).toHaveValue("");
      await expect(page.locator(".scenario-metrics")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Run simulation", exact: true }),
      ).toBeDisabled();
    }
  }
  const state = await call(request, "get", "state");
  expect(state.accounts).toEqual([]);
  expect(state.transactions).toEqual([]);
  expect(state.investments).toEqual([]);
  expect(state.mock).toBe(false);
  expect(state.planning.budgets || []).toEqual([]);
  expect(unexpected).toEqual([]);
});

test("Live projections require a successful explicit API calculation and never fall back to presets", async ({
  page,
}) => {
  await navigate(page, "Budgets & goals");
  await openScenario(page);
  const values = {
    age: 35,
    retirementAge: 36,
    initial: 100,
    monthly: 10,
    goal: 200,
    annualReturn: 0,
    inflation: 0,
    volatility: 0,
  };
  for (const [key, value] of Object.entries(values))
    await page.locator(`#scenario-${key}`).fill(String(value));
  const response = page.waitForResponse((r) =>
    r.url().includes("/api/terminal/simulation"),
  );
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  expect((await (await response).json()).data.source).toBe("LOCAL_API");
  await expect(page.locator(".scenario-metrics")).toContainText("220.00");
  await page.locator("#scenario-monthly").fill("20");
  await expect(page.locator(".scenario-metrics")).toHaveCount(0);
  await page.route("**/api/terminal/simulation", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "UNAVAILABLE",
          message: "Synthetic calculation service unavailable",
        },
      }),
    }),
  );
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  await expect(page.locator(".scenario-empty")).toContainText(
    "Synthetic calculation service unavailable",
  );
  await expect(page.locator(".scenario-metrics")).toHaveCount(0);
});

test("floating Agent reviews real tasks, refreshes modules, offers API analysis and fits small screens", async ({
  page,
  request,
}, info) => {
  await task(page, "add Agent test wallet account 100 AUD");
  expect((await call(request, "get", "state")).accounts).toHaveLength(0);
  await submitTask(page);
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  expect((await call(request, "get", "state")).accounts).toHaveLength(1);
  await page
    .getByLabel("Task account", { exact: true })
    .selectOption({ index: 1 });
  await task(page, "2026-09-10 Coffee 7 AUD");
  await submitTask(page);
  await expect(page.locator(".ledger-records")).toContainText("Coffee");
  await task(page, "analyze spending risk");
  await expect(page.locator(".agent-analysis-reply")).toContainText(
    "Analysis results",
  );
  expect(
    (await page.locator(".agent-analysis-reply").innerText()).replaceAll(
      "中文",
      "",
    ),
  ).not.toMatch(/[\u3400-\u9fff]/);
  for (const width of [320, 375, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    const box = await page.locator(".floating-agent-panel").boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y).toBeGreaterThanOrEqual(64);
    const fit = await page
      .locator(".floating-agent-body")
      .evaluate((e) => ({ scroll: e.scrollWidth, width: e.clientWidth }));
    expect(fit.scroll).toBeLessThanOrEqual(fit.width + 1);
  }
  await page.setViewportSize(
    info.project.name === "mobile"
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
  );
  await page.screenshot({
    path: `reports/agent-live-popup-${info.project.name}.png`,
  });
  await page.locator("#local-command-input").press("Escape");
  await expect(page.locator(".floating-agent-panel")).not.toBeVisible();
  await expect(page.locator(".floating-agent-launcher")).toBeFocused();
  await openAgent(page);
  await expect(page.locator(".agent-analysis-reply")).toBeVisible();
  await page
    .getByRole("button", { name: "View full analysis", exact: true })
    .click();
  await expect(page.locator(".floating-agent-panel")).not.toBeVisible();
  await expect(page.locator(".answer")).toBeVisible();
  await openAgent(page);
  await page
    .getByRole("tab", { name: "Evidence & screenshots", exact: true })
    .click();
  await page
    .getByLabel("Choose evidence file", { exact: true })
    .setInputFiles({
      name: "test.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "date,amount,currency,merchant\n2026-09-01,7,AUD,Coffee",
      ),
    });
  await expect(page.locator(".floating-agent-panel")).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ledger-tools")).toHaveAttribute("open", "");
  await openAgent(page);
  await page
    .getByRole("button", { name: "Hide financial content", exact: true })
    .click();
  await expect(page.locator(".floating-agent")).toHaveCount(0);
});
