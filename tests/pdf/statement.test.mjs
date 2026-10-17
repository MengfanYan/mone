import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, decodePDFRawStream } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import preset from "../../lib/demo/preset.mjs";
import { createStatementPdf } from "../../lib/statements/pdf.mjs";

const fontBytes = readFileSync(
  new URL("../../public/fonts/NotoSansSC.ttf", import.meta.url),
);
const catalog = JSON.parse(
  readFileSync(new URL("../../locales/catalog.json", import.meta.url)),
);
const report = Object.values(preset.reports)[1];
const render = (value, locale) =>
  createStatementPdf(value, {
    fontBytes,
    locale,
    translate: (text) => (locale === "en" ? catalog[text] || text : text),
  });

function extractedText(pdf) {
  return pdf
    .getPages()
    .flatMap((page) => {
      const fonts = page.node.Resources().lookup(PDFName.of("Font"));
      const cmap = Buffer.from(
        decodePDFRawStream(
          fonts.lookup(fonts.keys()[0]).lookup(PDFName.of("ToUnicode")),
        ).decode(),
      ).toString();
      const characters = new Map(
        Array.from(
          cmap.matchAll(/<([A-Fa-f\d]{4})> <([A-Fa-f\d]+)>/g),
          ([, code, unicode]) => [
            code.toLowerCase(),
            unicode
              .match(/.{4}/g)
              .map((unit) => String.fromCharCode(parseInt(unit, 16)))
              .join(""),
          ],
        ),
      );
      return page.node
        .Contents()
        .asArray()
        .flatMap((stream) => {
          const content = Buffer.from(
            decodePDFRawStream(pdf.context.lookup(stream)).decode(),
          ).toString();
          return Array.from(
            content.matchAll(/<([A-Fa-f\d]+)> Tj/g),
            ([, codes]) =>
              codes
                .match(/.{4}/g)
                .map((code) => characters.get(code.toLowerCase()) || "")
                .join(""),
          );
        });
    })
    .join("\n");
}

test("bilingual PDFs retain the immutable snapshot and embed drawable glyphs", async () => {
  const frozen = JSON.stringify(report);
  for (const locale of ["en", "zh"]) {
    const bytes = await render(report, locale);
    assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), "%PDF-");
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 3);
    assert.ok(pdf.getSubject().includes(report.snapshot.snapshot_id));
    assert.ok(pdf.getSubject().includes("MOCK"));
    const fonts = pdf.getPage(0).node.Resources().lookup(PDFName.of("Font"));
    const dictionary = fonts.lookup(fonts.keys()[0]);
    const descriptor = dictionary
      .lookup(PDFName.of("DescendantFonts"))
      .lookup(0)
      .lookup(PDFName.of("FontDescriptor"));
    const embedded = fontkit.create(
      decodePDFRawStream(descriptor.lookup(PDFName.of("FontFile2"))).decode(),
    );
    let empty = 0;
    for (let i = 1; i < embedded.numGlyphs; i++)
      if (!embedded.getGlyph(i).path.commands.length) empty++;
    // Space is intentionally blank. Oddly aligned font data previously caused
    // missing letters despite successful text extraction and PDF parsing.
    assert.ok(empty <= 1, `unexpected blank glyphs: ${empty}`);
    assert.ok(embedded.numGlyphs > 50);
    const content = extractedText(pdf);
    assert.ok(content.includes("46,007.65 AUD"));
    assert.ok(
      content.includes(
        locale === "zh" ? "个人分析月度账单" : "Personal Financial Statement",
      ),
    );
    assert.ok(content.includes(report.snapshot.event_ids.at(-1)));
  }
  assert.equal(JSON.stringify(report), frozen);
});

test("long categories and evidence paginate without dropping currency precision", async () => {
  const input = structuredClone(report);
  input.snapshot.summary = [
    {
      currency: "KWD",
      income: "999999999999.999",
      expenses: "0.001",
      surplus: "999999999999.998",
      opening_cash: "0.000",
      cash_change: "999999999999.998",
      closing_cash: "999999999999.998",
      categories: Object.fromEntries(
        Array.from({ length: 65 }, (_, i) => [
          `${i} 中文分类 / ${"Long user category ".repeat(i === 0 ? 180 : 1)}`,
          "0.001",
        ]),
      ),
    },
  ];
  input.snapshot.event_ids = Array.from(
    { length: 180 },
    (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
  );
  const pdf = await PDFDocument.load(await render(input, "zh"));
  assert.ok(pdf.getPageCount() >= 6);
  const content = extractedText(pdf);
  assert.ok(content.includes("999,999,999,999.998 KWD"));
  assert.ok(content.includes("0.001 KWD"));
  assert.ok(content.includes(input.snapshot.event_ids.at(-1)));
  for (const page of pdf.getPages()) {
    for (const stream of page.node.Contents().asArray()) {
      const decoded = Buffer.from(
        decodePDFRawStream(pdf.context.lookup(stream)).decode(),
      ).toString();
      for (const match of decoded.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)) {
        assert.ok(Number(match[1]) >= 42 && Number(match[1]) <= 554);
        assert.ok(Number(match[2]) >= 28 && Number(match[2]) <= 820);
      }
    }
  }
});
