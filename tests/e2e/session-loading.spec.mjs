import { test, expect } from "@playwright/test";

test("a delayed initial session check cannot erase a newly entered access code", async ({
  page,
}) => {
  let release,
    seen,
    first = true;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const requested = new Promise((resolve) => {
    seen = resolve;
  });
  await page.route("**/api/state**", async (route) => {
    if (!first) return route.continue();
    first = false;
    seen();
    await held;
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "UNAUTHENTICATED", message: "Sign in again" },
      }),
    });
  });
  try {
    await page.goto("/");
    await requested;
    const input = page.getByLabel("Local access code", { exact: true });
    await expect(input).toBeDisabled();
    await expect(
      page.getByRole("button", {
        name: "Connecting to local service…",
        exact: true,
      }),
    ).toBeDisabled();
    release();
    await expect(input).toBeEnabled();
    await input.fill("synthetic-browser-access-code");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(page.locator(".app-shell")).toBeVisible();
  } finally {
    release();
  }
});
