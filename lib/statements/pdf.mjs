import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { displayMoney } from "../money-format.mjs";

// Only frozen report data is read here. Never recompute from the current ledger.
export async function createStatementPdf(
  report,
  { locale = "en", translate = (v) => v, fontBytes },
) {
  const s = report.snapshot;
  const t = translate;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const supported = new Set(font.getCharacterSet());
  // Preserve unsupported characters explicitly (e.g. emoji in a user category).
  const printable = (value) =>
    Array.from(String(value ?? ""))
      .map((c) =>
        supported.has(c.codePointAt(0)) || c === "\n"
          ? c
          : `[U+${c.codePointAt(0).toString(16).toUpperCase()}]`,
      )
      .join("");
  const color = (hex) =>
    rgb(...hex.match(/\w\w/g).map((v) => parseInt(v, 16) / 255));
  const ink = color("172D29"),
    muted = color("52645D"),
    forest = color("183E34"),
    lime = color("CEF078"),
    line = color("D7E1DB");
  const W = 595.28,
    H = 841.89,
    M = 42;
  let page, y;
  const text = (value, x, top, size = 10, tint = ink) =>
    page.drawText(printable(value), {
      x,
      y: H - top - size,
      font,
      size,
      color: tint,
    });
  const rect = (x, top, width, height, tint) =>
    page.drawRectangle({ x, y: H - top - height, width, height, color: tint });
  const rule = () => {
    rect(M, y, W - 2 * M, 0.7, line);
    y += 12;
  };
  const newPage = (subtitle) => {
    page = doc.addPage([W, H]);
    rect(0, 0, W, 127, forest);
    text("ZHIZHANG / PERSONAL FINANCE", M, 24, 9, lime);
    text(t("个人分析月度账单"), M, 46, 23, rgb(1, 1, 1));
    text(
      `${s.period}  /  v${report.version}  /  ${subtitle}`,
      M,
      88,
      11,
      rgb(1, 1, 1),
    );
    y = 150;
    if (s.mock) {
      rect(M, y, W - 2 * M, 28, color("F0F5DA"));
      text(t("演示 / 合成数据"), M + 10, y + 7, 10, forest);
      y += 42;
    }
  };
  const ensure = (height) => {
    if (y + height > H - 65) newPage(t("账单续页"));
  };
  const wrap = (value, width, size) => {
    const lines = [];
    for (const paragraph of printable(value).split("\n")) {
      let current = "";
      for (const c of Array.from(paragraph)) {
        if (current && font.widthOfTextAtSize(current + c, size) > width) {
          // Prefer a word boundary in Latin text, fall back to character wrapping.
          const split = current.lastIndexOf(" ");
          if (split > current.length / 2 && c !== " ") {
            lines.push(current.slice(0, split));
            current = current.slice(split + 1) + c;
          } else {
            lines.push(current);
            current = c;
          }
        } else current += c;
      }
      lines.push(current);
    }
    return lines;
  };
  const paragraph = (value, size = 10, tint = muted) => {
    for (const l of wrap(value, W - 2 * M, size)) {
      ensure(size + 6);
      text(l, M, y, size, tint);
      y += size + 6;
    }
    y += 7;
  };
  const heading = (value) => {
    ensure(50);
    y += 7;
    text(value, M, y, 14, forest);
    y += 29;
  };
  const row = (label, value, { highlight = false, size = 11 } = {}) => {
    const amount = printable(value);
    const amountWidth = font.widthOfTextAtSize(amount, size);
    const labels = wrap(
      label,
      Math.max(80, W - 2 * M - amountWidth - 36),
      size,
    );
    let offset = 0;
    while (offset < labels.length) {
      ensure(28);
      const count = Math.max(1, Math.floor((H - 65 - y - 12) / 16));
      const chunk = labels.slice(offset, offset + count);
      const height = Math.max(28, chunk.length * 16 + 12);
      if (highlight) rect(M, y, W - 2 * M, height, color("EAF2EC"));
      chunk.forEach((l, i) => text(l, M + 10, y + 7 + i * 16, size));
      if (offset === 0)
        text(
          amount,
          W - M - 10 - amountWidth,
          y + 7,
          size,
          highlight ? forest : ink,
        );
      y += height;
      offset += chunk.length;
    }
  };

  doc.setTitle(`${s.period} ${t("个人分析月度账单")} v${report.version}`);
  doc.setAuthor("Mone");
  doc.setSubject(
    `Snapshot ${s.snapshot_id}; ${s.mock ? "MOCK" : "personal"}; PROVISIONAL; ${locale}`,
  );
  doc.setLanguage(locale === "zh" ? "zh-CN" : "en");
  const cutoff = new Date(s.cutoff);
  if (!Number.isNaN(cutoff.getTime())) {
    doc.setCreationDate(cutoff);
    doc.setModificationDate(cutoff);
  }

  for (const summary of s.summary) {
    newPage(`${summary.currency}  /  ${t("暂结")}`);
    heading(t("收支摘要"));
    row(t("收入"), `${displayMoney(summary.income)} ${summary.currency}`);
    row(
      t("费用（已扣除退款）"),
      `${displayMoney(summary.expenses)} ${summary.currency}`,
    );
    row(
      t("收入减费用"),
      `${displayMoney(summary.surplus)} ${summary.currency}`,
      { highlight: true },
    );
    heading(t("现金余额桥接"));
    row(t("期初现金"), displayMoney(summary.opening_cash));
    row(t("本期现金变动"), displayMoney(summary.cash_change));
    row(
      t("期末现金"),
      `${displayMoney(summary.closing_cash)} ${summary.currency}`,
      { highlight: true, size: 13 },
    );
    y += 12;
    paragraph(
      t("信用卡消费计入费用，本金还款不重复计费。投资及借款本金不计为工资。"),
      9,
    );
    heading(t("分类费用"));
    rule();
    const categories = Object.entries(summary.categories || {});
    if (!categories.length) paragraph(t("本期暂无分类费用。"));
    for (const [category, amount] of categories)
      row(category, `${displayMoney(amount)} ${summary.currency}`);
  }
  newPage(t("覆盖与证据"));
  heading(t("固定快照"));
  const metadata = [
    [t("快照编号"), s.snapshot_id],
    [t("账单编号"), report.id],
    [t("分析截止时间"), s.cutoff],
    [t("时区"), s.timezone],
    [t("账本版本"), s.ledger_version],
    [t("计算版本"), s.calc_version],
    [t("未确认草稿"), s.pending_drafts],
    [t("取代版本"), s.supersedes || t("无")],
  ];
  for (let i = 0; i < metadata.length; i += 2) {
    const left = metadata[i],
      right = metadata[i + 1];
    const leftLines = wrap(left[1], 245, 9);
    const rightLines = right ? wrap(right[1], 245, 9) : [];
    const height = 20 + Math.max(leftLines.length, rightLines.length) * 14;
    ensure(height);
    text(left[0], M, y, 8, muted);
    if (right) text(right[0], M + 260, y, 8, muted);
    leftLines.forEach((l, j) => text(l, M, y + 14 + j * 14, 9));
    rightLines.forEach((l, j) => text(l, M + 260, y + 14 + j * 14, 9));
    y += height;
  }
  heading(t("覆盖与限制"));
  paragraph(t("个人财务分析，不是银行正式账单或审计证明。"));
  paragraph(t("覆盖完整性未知；没有汇率证据时，各币种独立展示。"));
  for (const limitation of s.limitations || []) paragraph(t(limitation));
  paragraph(t(s.revision_reason));
  paragraph(t("缺少有效来源与月末估值证据，不提供实时市场判断或交易建议。"));
  const eventHeight = Math.min(220, Math.ceil(s.event_ids.length / 2) * 20);
  if (y + 36 + eventHeight > H - 65) newPage(t("账本事件证据"));
  heading(`${t("纳入账本事件")} (${s.event_ids.length})`);
  for (let i = 0; i < s.event_ids.length; i += 2) {
    if (y + 20 > H - 65) {
      newPage(t("账本事件证据"));
      heading(t("纳入账本事件（续）"));
    }
    text(s.event_ids[i], M, y, 8);
    if (s.event_ids[i + 1]) text(s.event_ids[i + 1], M + 260, y, 8);
    y += 20;
  }
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    page = p;
    rect(M, H - 47, W - 2 * M, 0.7, line);
    text(
      `${s.period} / v${report.version} / ${t("暂结")}${s.mock ? " / MOCK" : ""}`,
      M,
      H - 36,
      8,
      muted,
    );
    text(`${i + 1} / ${pages.length}`, W - M - 25, H - 36, 8, muted);
  });
  return doc.save();
}
