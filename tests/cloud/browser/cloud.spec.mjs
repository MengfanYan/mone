// UI contract tests use mocked identity/storage responses. The separate Python
// suite exercises real PostgreSQL RLS and signed JWTs. Neither claims live SSO.
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createDemoClient } from "../../../lib/demo/client.mjs";
import { navigate } from "../../e2e/ui-helpers.mjs";

async function fixture(page, { mfa = false } = {}) {
  const catalog = JSON.parse(await readFile("locales/catalog.json", "utf8"));
  const map = new Map(),
    storage = {
      getItem: (key) => map.get(key),
      setItem: (key, value) => map.set(key, value),
    };
  let authenticated = false,
    pending = false,
    language = "en";
  const adapter = createDemoClient({
    storage,
    translate: (s) => (language === "en" ? catalog[s] || s : s),
    locale: () => language,
  });
  const rules = [],
    files = [],
    calls = [],
    outside = [];
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (
      /^https?:$/.test(url.protocol) &&
      url.origin !== "http://127.0.0.1:3107"
    ) {
      outside.push(url.origin);
      return route.abort();
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname.slice(5),
      method = request.method();
    language = request.headers()["accept-language"]?.startsWith("zh")
      ? "zh"
      : "en";
    const body = request.postDataJSON();
    calls.push({ path, method });
    const send = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(
          status === 200
            ? { data }
            : {
                error: {
                  code: status === 401 ? "UNAUTHENTICATED" : "TEST_BOUNDARY",
                  message: data,
                },
              },
        ),
      });
    if (path === "session" && method === "POST") {
      if (
        body.email !== "synthetic@example.test" ||
        body.password !== "synthetic-browser-password"
      )
        return send("Invalid synthetic login", 401);
      if (mfa) {
        pending = true;
        return send({
          needs_mfa: true,
          authenticated: false,
          factors: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              name: "Synthetic authenticator",
            },
          ],
        });
      }
      authenticated = true;
      return send({ authenticated: true });
    }
    if (path === "auth/mfa/verify" && (pending || authenticated)) {
      authenticated = true;
      pending = false;
      return send({ verified: true });
    }
    if (path === "auth/sign-up")
      return send(
        "Public registration is not open; use an invited account or the synthetic Demo",
        403,
      );
    if (!authenticated) return send("Sign in to your cloud account", 401);
    if (path === "account")
      return send({
        sessions: [
          {
            id: "synthetic-session",
            current: true,
            revoked: false,
            created_at: "2026-10-15T01:00:00Z",
          },
        ],
        rules,
        billing_enabled: false,
      });
    if (path === "documents" && method === "GET") return send(files);
    if (path === "documents" && method === "POST") {
      const d = {
        id: "22222222-2222-4222-8222-222222222222",
        mime_type: body.mime_type,
        size_bytes: 30,
        status: "quarantined",
      };
      files.push(d);
      return send(d);
    }
    if (path.startsWith("documents/") && method === "DELETE") {
      files[0].status = "deleted";
      return send({ status: "deleted" });
    }
    if (path === "personal-rules" && method === "POST") {
      rules.push({
        ...body,
        id: "33333333-3333-4333-8333-333333333333",
        version: 1,
        active: true,
      });
      return send(rules.at(-1));
    }
    if (path.startsWith("personal-rules/") && method === "DELETE") {
      rules[0].active = false;
      return send({ active: false });
    }
    if (path === "feedback") return send({ training_consent: false });
    if (path === "auth/mfa/list")
      return send({ factors: [], assurance: "aal1" });
    if (path === "auth/mfa/enroll")
      return send({
        id: "11111111-1111-4111-8111-111111111111",
        secret: "SYNTHETICTOTPSECRET",
      });
    if (path.startsWith("account/sessions/revoke")) {
      authenticated = false;
      return send({ revoked: true, current: true });
    }
    if (path === "migration/preview")
      return send({
        nonce: "synthetic-migration-nonce",
        content_hash: "synthetic-hash",
        manifest: { counts: { accounts: 1, events: 2 } },
        expires_in: 120,
      });
    try {
      const result = await adapter(
        path + url.search,
        method,
        body,
        request.headers()["idempotency-key"],
      );
      if (path === "state") {
        result.mode = "CLOUD_PERSONAL_WORKSPACE";
        result.limitations = [
          "Synthetic UI contract fixture; no live identity or storage provider is connected.",
        ];
        result.capabilities = {
          ...result.capabilities,
          ocr: false,
          cloud_model: false,
        };
      }
      return send(result);
    } catch (error) {
      return send(error.message, 400);
    }
  });
  return {
    calls,
    outside,
    expire: () => {
      authenticated = false;
    },
  };
}
async function signin(page) {
  await page.goto("/");
  await expect(
    page.getByLabel("Local access code", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Email", { exact: true })
    .fill("synthetic@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("cloud login requires MFA when enrolled and signup/billing remain closed", async ({
  page,
}) => {
  const boundary = await fixture(page, { mfa: true });
  await signin(page);
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await page
    .getByLabel("Six-digit authenticator code", { exact: true })
    .fill("123456");
  await page
    .getByRole("button", { name: "Verify and sign in", exact: true })
    .click();
  await navigate(page, "Settings");
  await expect(page.locator(".cloud-account-grid")).toContainText(
    "Billing is off",
  );
  await expect(
    page.getByRole("button", {
      name: "Paid plans are not available",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.locator(".sidebar-bottom")).toContainText(
    "Cloud workspace",
  );
  await page.screenshot({
    path: `reports/cloud-settings-${test.info().project.name}.png`,
  });
  expect(boundary.outside).toEqual([]);
});
test("private rules, feedback, quarantine and archive preview expose explicit controls", async ({
  page,
}) => {
  const boundary = await fixture(page);
  await signin(page);
  await navigate(page, "Settings");
  await page
    .getByLabel("Exact merchant name", { exact: true })
    .fill("Synthetic Coffee");
  await page
    .getByLabel("Suggested category", { exact: true })
    .fill("Work meals");
  const save = page.getByRole("button", {
    name: "Save personal rule",
    exact: true,
  });
  await expect(save).toBeDisabled();
  await page
    .getByLabel("Save for my future drafts only", { exact: true })
    .check();
  await save.click();
  await expect(
    page.locator(".cloud-device-row").filter({ hasText: "Synthetic Coffee" }),
  ).toContainText("Work meals");
  await page
    .getByLabel("Describe the error", { exact: true })
    .fill("Synthetic classification correction");
  await page
    .getByRole("button", { name: "Save feedback", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Feedback recorded privately",
  );
  await page
    .getByText("Private files & local archive import", { exact: true })
    .click();
  await page
    .getByLabel("Upload a private file", { exact: true })
    .setInputFiles({
      name: "synthetic.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic private receipt text"),
    });
  await expect(
    page.locator(".cloud-device-row").filter({ hasText: "text/plain" }),
  ).toContainText("Quarantined");
  await page.getByRole("button", { name: "Remove file", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm file removal", exact: true })
    .click();
  await expect(
    page.locator(".cloud-device-row").filter({ hasText: "text/plain" }),
  ).toContainText("Deleted");
  await page.getByLabel("Local export archive", { exact: true }).setInputFiles({
    name: "synthetic-export.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        schema_version: "2",
        data: { accounts: [], events: [] },
      }),
    ),
  });
  await page
    .getByRole("button", { name: "Review archive import", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Confirm import into my workspace",
      exact: true,
    }),
  ).toBeDisabled();
  expect(boundary.calls.some((c) => c.path === "migration/commit")).toBe(false);
  expect(boundary.outside).toEqual([]);
});
test("cloud settings and recovery reflow at 320, 768 and 1440 pixels in both languages", async ({
  page,
}) => {
  await fixture(page);
  await signin(page);
  await navigate(page, "Settings");
  await page.getByText("Authenticator protection", { exact: true }).click();
  await page
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  await expect(
    page.getByLabel("Add this secret to your authenticator", { exact: true }),
  ).toBeVisible();
  await page
    .getByText("Private files & local archive import", { exact: true })
    .click();
  for (const language of ["en", "zh"]) {
    if (language === "zh")
      await page.getByRole("button", { name: "中文", exact: true }).click();
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width + 1);
      const bad = await page
        .locator(
          ".cloud-account-grid input,.cloud-account-grid select,.cloud-account-grid textarea,.cloud-account-grid button",
        )
        .evaluateAll((items) =>
          items
            .filter((e) => e.getClientRects().length)
            .filter((e) => {
              const r = e.getBoundingClientRect();
              return r.left < 0 || r.right > window.innerWidth + 1;
            })
            .map((e) => e.outerHTML.slice(0, 80)),
        );
      expect(bad).toEqual([]);
    }
  }
  await page.goto("/account/recovery");
  await expect(
    page.getByRole("heading", { name: "重置密码", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize().width + 1);
});

test("expired sessions clear advanced-module private DOM on the next request", async ({
  page,
}) => {
  const boundary = await fixture(page);
  await signin(page);
  await navigate(page, "Settings");
  await page
    .getByLabel("Describe the error", { exact: true })
    .fill("Synthetic feedback after expiry");
  boundary.expire();
  await page
    .getByRole("button", { name: "Save feedback", exact: true })
    .click();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
});
