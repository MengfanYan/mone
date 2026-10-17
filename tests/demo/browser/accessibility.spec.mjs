import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { navigate } from "../../e2e/ui-helpers.mjs";

test("eight modules retain readable text contrast and reflow at 200% desktop CSS zoom", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "desktop zoom measurement");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/demo");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const measurements = [],
    failures = [],
    zoomFailures = [];
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
    await expect(page.locator(".sidebar .nav-item.active")).toHaveCSS(
      "color",
      "rgb(199, 210, 254)",
    );
    const samples = await page.evaluate(() => {
      const parse = (c) => c.match(/[\d.]+/g)?.map(Number) || [255, 255, 255];
      const luminance = (rgb) =>
        rgb
          .slice(0, 3)
          .map((c) => {
            const s = c / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          })
          .reduce((v, c, i) => v + c * [0.2126, 0.7152, 0.0722][i], 0);
      const results = [];
      for (const e of document.querySelectorAll(
        "main *, .sidebar *, .topbar *",
      )) {
        const text = [...e.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.trim())
          .join(" ");
        const r = e.getBoundingClientRect(),
          s = window.getComputedStyle(e);
        if (
          !text ||
          !r.width ||
          !r.height ||
          s.visibility === "hidden" ||
          r.width < 3 ||
          r.height < 3 ||
          e.closest(".sr-only,.pdf-text-layer,svg,canvas")
        )
          continue;
        const layers = [];
        let gradient = false;
        for (let p = e; p; p = p.parentElement) {
          const style = window.getComputedStyle(p);
          if (style.backgroundImage !== "none") gradient = true;
          const layer = parse(style.backgroundColor);
          layers.unshift(layer);
          // An opaque panel hides ancestor gradients. Only skip gradients
          // that can actually contribute to the painted background.
          if ((layer[3] ?? 1) === 1) break;
        }
        if (gradient) continue; // image/gradient compositing needs visual inspection
        let bg = [255, 255, 255];
        for (const layer of layers) {
          const a = layer[3] ?? 1;
          bg = bg.map((v, i) => layer[i] * a + v * (1 - a));
        }
        const fg = parse(s.color),
          alpha = fg[3] ?? 1,
          l1 = luminance(
            fg.map((v, i) => v * alpha + (bg[i] || 0) * (1 - alpha)),
          ),
          l2 = luminance(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const large =
          parseFloat(s.fontSize) >= 24 ||
          (parseFloat(s.fontSize) >= 18.66 && parseInt(s.fontWeight) >= 700);
        results.push({
          element: `${e.tagName}.${e.className}`,
          parent: `${e.parentElement.tagName}.${e.parentElement.className}`,
          text: text.slice(0, 90),
          ratio: +ratio.toFixed(3),
          required: large ? 3 : 4.5,
          foreground: s.color,
          background: bg,
        });
      }
      return results;
    });
    expect(samples.length).toBeGreaterThan(15);
    measurements.push({ module: name, samples });
    failures.push(
      ...samples
        .filter((s) => s.ratio + 0.005 < s.required)
        .map((s) => ({ module: name, ...s })),
    );
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    const zoom = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
      bodyRight: document.body.getBoundingClientRect().right,
      viewport: window.innerWidth,
      offenders: [...document.querySelectorAll("main *")]
        .map((e) => ({
          element: `${e.tagName}.${e.className}`,
          text: e.textContent.slice(0, 70),
          right: e.getBoundingClientRect().right,
          width: e.getBoundingClientRect().width,
        }))
        .filter((e) => e.width > 0 && e.right > window.innerWidth + 1)
        .sort((a, b) => b.right - a.right)
        .slice(0, 12),
    }));
    measurements.at(-1).zoom = zoom;
    if (zoom.scroll > zoom.client + 1 || zoom.bodyRight > zoom.viewport + 1)
      zoomFailures.push({ module: name, ...zoom });
    await page.screenshot({
      path: `reports/ux-zoom-${name.toLowerCase().replace(/\W+/g, "-")}.png`,
      animations: "disabled",
    });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1";
    });
  }
  await writeFile(
    "reports/ux-contrast.json",
    JSON.stringify(
      {
        note: "Computed solid-background text contrast; gradients, chart SVG and PDF canvas inspected visually. CSS zoom is 200%, not a native-browser zoom control.",
        modules: measurements,
      },
      null,
      2,
    ),
  );
  expect(failures, "text contrast across eight modules").toEqual([]);
  expect(zoomFailures, "200% CSS zoom geometry").toEqual([]);
});
