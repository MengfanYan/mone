import { expect } from "@playwright/test";
export async function navigate(page, name) {
  await expect(page.locator(".app-shell")).toBeVisible();
  const minimize = page.locator(".floating-agent-launcher[aria-expanded=true]");
  if (await minimize.isVisible()) await minimize.click();
  const target = page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true });
  if (!(await target.isVisible()))
    await page
      .getByRole("button", { name: /^(More modules|更多模块)$/, exact: true })
      .click();
  await target.click();
}
export async function openTools(page) {
  const tools = page.locator(".ledger-tools");
  if (!(await tools.evaluate((e) => e.open)))
    await tools.locator("summary").click();
}
export async function openPlanning(page) {
  await page
    .getByRole("button", {
      name: /^(Adjust budgets & goals|调整预算与目标)$/,
      exact: true,
    })
    .first()
    .click();
}
export async function openAnalysis(page) {
  const details = page.locator(".analysis-method");
  if (!(await details.evaluate((e) => e.open)))
    await details.locator(":scope > summary").click();
}
export async function resetDemo(page) {
  const button = page.getByRole("button", {
    name: /^(Reset demo|重置演示)$/,
    exact: true,
  });
  if (!(await button.isVisible()))
    await page.locator(".demo-banner > summary").click();
  await button.click();
}

export async function openAgent(page) {
  await expect(page.locator(".app-shell")).toBeVisible();
  const launcher = page.locator(".floating-agent-launcher");
  if ((await launcher.getAttribute("aria-expanded")) !== "true")
    await launcher.click();
  await expect(page.locator(".floating-agent-panel")).toBeVisible();
}

// Test fixtures are API-created only; Live has no synthetic seed control.
export async function seedLiveScenario(page, zh = false) {
  const period = await page
    .getByLabel(zh ? "分析月份" : "Analysis month", { exact: true })
    .inputValue();
  const previous = new Date(`${period}-01T12:00:00Z`);
  previous.setUTCDate(0);
  const send = async (path, data) => {
    const response = await page.request.post(`/api/${path}`, {
      headers: { Origin: "http://127.0.0.1:3097" },
      data,
    });
    expect(response.status()).toBe(200);
    return (await response.json()).data;
  };
  const cash = await send("accounts", {
    name: zh ? "演示 · 银行" : "Demo · Bank",
    type: "cash",
    currency: "CNY",
    opening_balance: "30000.00",
    opened_on: previous.toISOString().slice(0, 10),
    mock: true,
  });
  const debt = await send("accounts", {
    name: zh ? "演示 · 贷款" : "Demo · Loan",
    type: "liability",
    currency: "CNY",
    opening_balance: "10000.00",
    opened_on: previous.toISOString().slice(0, 10),
    mock: true,
  });
  await send("imports", {
    mock: true,
    csv: `date,amount,currency,merchant,category,kind,account_id,counterparty_id,external_id
${period}-03,12000.00,CNY,${zh ? "合成工资" : "Synthetic salary"},Income,income,${cash.id},,sample-salary
${period}-05,7000.00,CNY,${zh ? "合成生活支出" : "Synthetic living expenses"},Living,expense,${cash.id},,sample-living
${period}-06,500.00,CNY,${zh ? "合成债务利息" : "Synthetic debt interest"},Interest,interest,${cash.id},,sample-interest
${period}-07,1000.00,CNY,${zh ? "合成本金还款" : "Synthetic principal payment"},Principal,debt_principal,${cash.id},${debt.id},sample-principal`,
  });
  await page.reload();
  await navigate(page, zh ? "账本与导入" : "Transactions");
}

export async function openScenario(page) {
  const details = page.locator(".long-term-scenario");
  if (!(await details.evaluate((e) => e.open)))
    await details.locator(":scope > summary").click();
}
export async function openAdvancedModel(page) {
  const details = page.locator(".advanced-settings");
  if (!(await details.evaluate((e) => e.open)))
    await details.locator(":scope > summary").click();
}
export async function openOverviewDetails(page) {
  const details = page.locator(".overview-details");
  if (!(await details.evaluate((e) => e.open)))
    await details.locator(":scope > summary").click();
}
export async function acknowledgeDuplicates(container) {
  for (const checkbox of await container
    .locator(".duplicate-review input[type=checkbox]")
    .all())
    await checkbox.check();
  for (const field of await container
    .locator(".duplicate-review textarea")
    .all())
    await field.fill(
      "Synthetic test: a distinct purchase verified against both records.",
    );
}
