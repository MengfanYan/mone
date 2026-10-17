import { expect } from "@playwright/test";
import { navigate, acknowledgeDuplicates } from "./ui-helpers.mjs";

export async function scopeAndNavigation(page) {
  await navigate(page, "Analysis");
  const question = page.getByLabel("Financial analysis question", {
    exact: true,
  });
  await expect(question).toBeVisible();
  await expect(page.locator(".analysis-method")).not.toHaveAttribute(
    "open",
    "",
  );
  await question.fill(
    "Explain why an internal transfer is not an expense. Do not execute anything.",
  );
  await page
    .locator(".analysis-query")
    .getByRole("button", { name: "Analyze", exact: true })
    .click();
  await expect(page.locator(".answer")).toContainText(
    "An internal transfer moves cash",
  );
  for (const currency of ["AUD", "CNY", "USD"]) {
    await page
      .getByLabel("Current currency", { exact: true })
      .selectOption(currency);
    await question.fill("Analyze monthly spending risk");
    await page
      .locator(".analysis-query")
      .getByRole("button", { name: "Analyze", exact: true })
      .click();
    await expect(page.locator(".answer")).toBeVisible();
    const units = await page
      .locator(".answer .answer-metrics > div > strong")
      .allTextContents();
    if (currency !== "CNY") expect(units.length).toBeGreaterThan(0);
    expect(
      units.every(
        (s) => !/\b(?:AUD|CNY|USD)\b/.test(s) || s.includes(currency),
      ),
    ).toBe(true);
    await page
      .locator(".analysis-query")
      .getByRole("button", { name: "View basis", exact: true })
      .click();
    await expect(page.locator(".analysis-method")).toHaveAttribute("open", "");
    await expect(page.locator(".analysis-basis")).toContainText(currency);
    await expect(page).toHaveURL(new RegExp(`currency=${currency}`));
  }
  await page.getByLabel("Analysis month", { exact: true }).fill("2026-08");
  await expect(page).toHaveURL(/period=2026-08/);
  await navigate(page, "Portfolio");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Portfolio", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Analysis month", { exact: true })).toHaveValue(
    "2026-08",
  );
  await expect(
    page.getByLabel("Current currency", { exact: true }),
  ).toHaveValue("USD");
  await navigate(page, "Transactions");
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Portfolio", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ledger-task-bar .primary")).toBeVisible();
  await expect(page.locator(".ledger-analytics")).not.toHaveAttribute(
    "open",
    "",
  );
  await page.locator(".ledger-task-bar .primary").click();
  const editor = page.locator("dialog[open]");
  await editor.getByLabel(/^Amount ·/).fill("-12");
  await editor
    .getByLabel("Merchant / description", { exact: true })
    .fill("Synthetic invalid amount");
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("greater than zero");
  await editor
    .getByRole("button", { name: "Cancel edit", exact: true })
    .click();
  await navigate(page, "Portfolio");
  await expect(
    page.getByText("The amount must be greater than zero.", { exact: true }),
  ).toHaveCount(0);
}

export async function duplicateConfirmation(page, cardText) {
  await navigate(page, "Transactions");
  await page
    .locator(".draft-card")
    .filter({ hasText: cardText })
    .first()
    .getByRole("button", { name: "Review & confirm", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Review & confirm",
    exact: true,
  });
  await expect(dialog.locator(".duplicate-review")).toContainText(
    "Possible duplicate",
  );
  const confirm = dialog.getByRole("button", {
    name: "Confirm these details",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await dialog.locator(".duplicate-review input[type=checkbox]").check();
  await expect(confirm).toBeDisabled();
  await acknowledgeDuplicates(dialog);
  await expect(confirm).toBeEnabled();
  await dialog.screenshot({
    path: `reports/review-duplicate-${page.viewportSize().width}.png`,
  });
  await confirm.click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".ledger-records")).toContainText(cardText);
}
