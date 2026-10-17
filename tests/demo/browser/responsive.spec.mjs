import { test, expect } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
import { navigate, openPlanning } from "../../e2e/ui-helpers.mjs";
import { expectPdfReady } from "../../e2e/pdf-assertions.mjs";

const modules = [
  ["Dashboard", "财务概览"],
  ["Transactions", "账本与导入"],
  ["Budgets & goals", "预算与目标"],
  ["Portfolio", "投资记录"],
  ["Statements", "月度账单"],
  ["Analysis", "分析助手"],
  ["Privacy & consent", "隐私与授权"],
  ["Settings", "系统设置"],
];

async function geometry(page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const offenders = [];
    for (const e of document.querySelectorAll(
      ".topbar .language-switch, .topbar .mobile-lock, .topbar .breadcrumb, main .panel, .page-summary, .command-composer, main input, main select, main textarea, main button, dialog[open] input, dialog[open] select, dialog[open] button",
    )) {
      const r = e.getBoundingClientRect();
      const s = window.getComputedStyle(e);
      if (
        !r.width ||
        !r.height ||
        s.visibility === "hidden" ||
        !e.getClientRects().length
      )
        continue;
      if (r.left < -1 || r.right > width + 1)
        offenders.push({
          tag: e.tagName,
          text: (
            e.getAttribute("aria-label") ||
            e.textContent ||
            e.className
          ).slice(0, 100),
          left: r.left,
          right: r.right,
        });
    }
    const overlaps = [];
    const splitAmounts = [];
    for (const money of document.querySelectorAll("main .money")) {
      const major = money.querySelector(".amount-major"),
        minor = money.querySelector(".amount-minor");
      if (
        !major ||
        !minor ||
        !major.getClientRects().length ||
        !minor.getClientRects().length
      )
        continue;
      const a = major.getBoundingClientRect(),
        b = minor.getBoundingClientRect();
      // Chromium may fragment punctuation and digits on the same baseline.
      // Only distinct vertical positions indicate a broken number line.
      const wraps = (element) => {
        const rects = [...element.getClientRects()].filter((r) => r.width > 0);
        return rects.some((r) => Math.abs(r.top - rects[0].top) > 2);
      };
      if (b.top >= a.bottom - 1 || wraps(major) || wraps(minor))
        splitAmounts.push(money.textContent);
    }
    for (const grid of document.querySelectorAll(".form-grid")) {
      const fields = [...grid.children]
        .filter((e) => e.getClientRects().length)
        .map((e) => e.getBoundingClientRect());
      for (let i = 0; i < fields.length; i++)
        for (let j = i + 1; j < fields.length; j++) {
          const a = fields[i],
            b = fields[j];
          if (
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
          )
            overlaps.push([i, j]);
        }
    }
    return {
      width,
      monthControlWidth:
        document
          .querySelector(".heading-controls .workspace-month")
          ?.getBoundingClientRect().width ?? 160,
      pageWidth: document.documentElement.scrollWidth,
      offenders,
      overlaps,
      splitAmounts,
    };
  });
}
async function check(page, label) {
  const result = await geometry(page);
  expect(result.pageWidth, label).toBeLessThanOrEqual(result.width + 1);
  expect(
    result.monthControlWidth,
    `${label}: selected month stays readable`,
  ).toBeGreaterThanOrEqual(150);
  expect(result.offenders, label).toEqual([]);
  expect(result.overlaps, label).toEqual([]);
  expect(
    result.splitAmounts,
    `${label}: decimal portions stay with whole amounts`,
  ).toEqual([]);
  const modalOpen = await page.locator("dialog[open]").count();
  const controlSelector = modalOpen
    ? "dialog[open] .primary:not([disabled])"
    : ".page-summary .text-button, .command-composer .primary:not([disabled]), .page-heading .primary:not([disabled])";
  for (const control of await page.locator(controlSelector).all()) {
    if (!(await control.isVisible())) continue;
    const reachable = await control.evaluate((e) => {
      e.scrollIntoView({ block: "center", behavior: "instant" });
      const r = e.getBoundingClientRect(),
        target = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
      return target === e || e.contains(target);
    });
    expect(reachable, `${label}: primary control is not covered`).toBe(true);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  return result;
}

for (const width of [320, 360, 390, 640, 768, 1024, 1440, 1920]) {
  test(`all bilingual modules and editors fit ${width}px without page overflow or intersecting fields`, async ({
    page,
  }, info) => {
    test.skip(
      info.project.name !== "desktop",
      "explicit viewport matrix runs once",
    );
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: width < 768 ? 780 : 900 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/demo");
    const evidence = [];
    for (let language = 0; language < 2; language++) {
      if (language)
        await page.getByRole("button", { name: "中文", exact: true }).click();
      for (const names of modules) {
        const name = names[language];
        await navigate(page, name);
        await expect(
          page.getByRole("heading", { name, exact: true }),
        ).toBeVisible();
        if (names[0] === "Statements") await expectPdfReady(page);
        evidence.push({
          module: name,
          ...(await check(page, `${width}: ${name}`)),
        });
        if (!language && [320, 768, 1920].includes(width)) {
          await page.screenshot({
            path: `reports/responsive-${width}-${names[0].toLowerCase().replace(/\W+/g, "-")}.png`,
            fullPage: true,
            animations: "disabled",
          });
          await page.screenshot({
            path: `reports/ux-first-screen-${width}-${names[0].toLowerCase().replace(/\W+/g, "-")}.png`,
            animations: "disabled",
          });
        }
      }
    }
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await navigate(page, "Transactions");
    await page
      .locator(".draft-card")
      .first()
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit draft",
      exact: true,
    });
    await expect(editor).toBeVisible();
    evidence.push({
      module: "Draft editor",
      ...(await check(page, `${width}: draft editor`)),
    });
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      expect(
        await editor.evaluate((e) => e.contains(document.activeElement)),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(editor).not.toBeVisible();
    await page
      .locator(".draft-card")
      .first()
      .getByRole("button", { name: "Review & confirm", exact: true })
      .click();
    const confirmation = page.getByRole("dialog", {
      name: "Review & confirm",
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    evidence.push({
      module: "Confirmation",
      ...(await check(page, `${width}: confirmation`)),
    });
    await confirmation
      .getByRole("button", { name: "Confirm these details", exact: true })
      .scrollIntoViewIfNeeded();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(
        await confirmation.evaluate((e) => e.contains(document.activeElement)),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(confirmation).not.toBeVisible();
    await navigate(page, "Dashboard");
    await page
      .getByRole("button", { name: "Add account", exact: true })
      .click();
    const account = page.getByRole("dialog", {
      name: "Add account",
      exact: true,
    });
    await expect(account).toBeVisible();
    evidence.push({
      module: "Account form",
      ...(await check(page, `${width}: account`)),
    });
    await page.keyboard.press("Escape");
    await expect(account).not.toBeVisible();
    await navigate(page, "Budgets & goals");
    await openPlanning(page);
    const planning = page.getByRole("dialog", {
      name: "Adjust budgets & goals",
      exact: true,
    });
    await expect(planning).toBeVisible();
    evidence.push({
      module: "Planning editor",
      ...(await check(page, `${width}: planning`)),
    });
    await page.keyboard.press("Escape");
    await expect(planning).not.toBeVisible();
    await navigate(page, "Portfolio");
    await page
      .getByRole("button", { name: "Add valuation", exact: true })
      .first()
      .click();
    const valuation = page.getByRole("dialog", {
      name: "Add valuation",
      exact: true,
    });
    await expect(valuation).toBeVisible();
    evidence.push({
      module: "Valuation editor",
      ...(await check(page, `${width}: valuation`)),
    });
    await page.keyboard.press("Escape");
    await expect(valuation).not.toBeVisible();
    expect(errors).toEqual([]);
    await mkdir("reports", { recursive: true });
    await writeFile(
      `reports/ux-responsive-${width}.json`,
      JSON.stringify({ width, checks: evidence, pageErrors: errors }, null, 2),
    );
  });
}

test("long customer labels and maximum-size draft amounts remain readable on phone, tablet and desktop", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "explicit stress viewport matrix");
  await page.goto("/demo");
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.evaluate(() => {
    const key = "zhizhang.product-demo.v1",
      db = JSON.parse(window.localStorage.getItem(key));
    for (const a of db.state.accounts) a.name = "LongAccountName".repeat(4);
    for (const e of db.state.transactions)
      e.merchant = "LongMerchant".repeat(10);
    for (const d of db.state.drafts) {
      d.content.merchant = "LongMerchant".repeat(10);
      d.content.amount = "999999999999.99";
    }
    for (const i of db.state.investments)
      i.name = "LongInvestmentName".repeat(5);
    window.localStorage.setItem(key, JSON.stringify(db));
  });
  await page.reload();
  const measurements = [];
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const names of modules) {
      await navigate(page, names[0]);
      measurements.push({
        module: names[0],
        ...(await check(page, `long content ${width}: ${names[0]}`)),
      });
    }
  }
  await writeFile(
    "reports/ux-responsive-long-content.json",
    JSON.stringify(measurements, null, 2),
  );
});

test("landscape and short desktop keep navigation and long editors reachable", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "explicit short-height matrix");
  await page.goto("/demo");
  const evidence = [];
  for (const [width, height] of [
    [844, 390],
    [1280, 600],
  ]) {
    await page.setViewportSize({ width, height });
    for (const names of modules) {
      await navigate(page, names[0]);
      evidence.push({
        module: names[0],
        height,
        ...(await check(
          page,
          `short viewport ${width}x${height}: ${names[0]}`,
        )),
      });
    }
    const lock = page.getByRole("button", {
      name: "Lock workspace",
      exact: true,
    });
    await lock.scrollIntoViewIfNeeded();
    const bounds = await lock.boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    await navigate(page, "Budgets & goals");
    await openPlanning(page);
    evidence.push({
      module: "Long planning editor",
      height,
      ...(await check(page, `short viewport ${width}x${height}: editor`)),
    });
    await page.keyboard.press("Escape");
  }
  await writeFile(
    "reports/ux-responsive-short-height.json",
    JSON.stringify(evidence, null, 2),
  );
});
