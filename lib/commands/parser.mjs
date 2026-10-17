import { precision } from "../demo/calculations.mjs";

export function localDay(zone = "Australia/Sydney", clock = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(clock);
}
const addDays = (day, n) =>
  new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);
function dateFor(text, day) {
  const explicit = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (explicit) return { parsedDay: explicit, basis: "explicit ISO date" };
  let parsedDay = day;
  let basis = text.match(/\b\d{4}-\d{2}-\d{2}\b/)
    ? "explicit ISO date"
    : "user timezone / today";
  if (/昨天|yesterday/i.test(text)) {
    parsedDay = addDays(day, -1);
    basis = "user timezone / yesterday";
  }
  if (/前天/.test(text)) {
    parsedDay = addDays(day, -2);
    basis = "user timezone / two days ago";
  }
  if (/明天|tomorrow/i.test(text)) {
    parsedDay = addDays(day, 1);
    basis = "user timezone / tomorrow";
  }
  if (/上周五|last friday/i.test(text)) {
    const diff = (new Date(`${day}T12:00:00Z`).getUTCDay() + 2) % 7 || 7;
    parsedDay = addDays(day, -diff);
    basis = "user timezone / last Friday";
  }
  if (/月底|以后|later|next month/i.test(text)) {
    parsedDay = null;
    basis = "date needs clarification";
  }
  return { parsedDay, basis };
}
export function parseCommand(
  text,
  {
    accounts = [],
    account_id,
    currency,
    timezone = "Australia/Sydney",
    day = localDay(timezone),
  } = {},
) {
  if (!text.trim() || text.length > 2000)
    throw new Error("请输入2000字以内的本地任务。");
  if (
    /转账到|自动买|买入股票|下单|支付给|删除全部|删除所有|导出全部|上传云|授权云|分享|delete all|erase all|export all|send money|place.*order|buy.*shares|cloud|share.*data/i.test(
      text,
    )
  )
    throw new Error(
      "此请求请使用专门授权或隐私流程；文字任务不能支付、交易、共享或删除全库。",
    );
  if (currency && precision[currency] === undefined)
    throw new Error("请选择支持的币种。");
  const normalizedText = text.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "");
  const selected = accounts.find((a) => a.id === account_id && !a.archived);
  if (account_id && !selected) throw new Error("选定账户不存在或已归档。");
  if (selected && currency && selected.currency !== currency)
    throw new Error("账户与交易币种不一致。");
  const { parsedDay, basis } = dateFor(text, day);
  const object = /预算|budget/i.test(text)
    ? "budget"
    : /目标|goal/i.test(text)
      ? "goal"
      : /账户|account/i.test(text)
        ? "account"
        : /投资|持仓|investment|holding/i.test(text)
          ? "investment"
          : "record";
  const intent = /删除|移除|归档|delete|remove|archive/i.test(text)
    ? "delete"
    : /改成|改为|改名|修改|不是|其实|rename|change|correct|update|was actually/i.test(
          text,
        )
      ? "update"
      : /查|找|多少|show|find|search|how much|list/i.test(text)
        ? "query"
        : "create";
  if (intent !== "create" || object !== "record") {
    const numbers =
      normalizedText
        .replace(/\d{4}-\d{2}-\d{2}/g, "")
        .match(/(?<![\d-])\d+(?:\.\d+)?(?![\d-])/g) || [];
    return {
      intent,
      object,
      operations: [],
      amount: numbers.at(-1) || null,
      currency:
        Object.keys(precision).find((c) =>
          new RegExp(`\\b${c}\\b`, "i").test(text),
        ) ||
        currency ||
        selected?.currency ||
        null,
      date: /昨天|前天|yesterday|\d{4}-\d{2}-\d{2}/i.test(text)
        ? parsedDay
        : null,
      date_basis: basis,
    };
  }
  const codes = Object.keys(precision).join("|");
  const pattern = new RegExp(
    `(?:(${codes})\\s*|[$¥￥]\\s*)?(\\d+(?:\\.\\d+)?)(?:\\s*(${codes}))?`,
    "i",
  );
  const operations = [];
  for (const raw of normalizedText.split(/[，,；;。\n]|\band\b/i)) {
    const clause = raw.trim(),
      cleaned = clause.replace(/\d{4}-\d{2}-\d{2}/g, ""),
      match = cleaned.match(pattern);
    if (!match) continue;
    const code =
      (
        match[1] ||
        match[3] ||
        selected?.currency ||
        currency ||
        ""
      ).toUpperCase() || null;
    const clauseDate =
      /今天|昨天|前天|明天|上周五|today|yesterday|tomorrow|last friday|\d{4}-\d{2}-\d{2}/i.test(
        clause,
      )
        ? dateFor(clause, day)
        : { parsedDay, basis };
    const amountCandidates =
      cleaned.match(/(?<![\d-])\d+(?:\.\d+)?(?![\d-])/g) || [];
    const income = /赚|收入|工资|到账|earn|salary|income|received/i.test(
      clause,
    );
    let kind = income ? "income" : "expense";
    if (
      /借款|loan|transfer|转账|还款|repay|赎回|redeem|分红|dividend/i.test(
        clause,
      )
    )
      kind = "needs_classification";
    const merchant = /咖啡/.test(clause)
      ? "咖啡"
      : /coffee/i.test(clause)
        ? "Coffee"
        : /兼职/.test(clause)
          ? "兼职"
          : /salary/i.test(clause)
            ? "Salary"
            : /part.?time/i.test(clause)
              ? "Part-time work"
              : cleaned
                  .replace(
                    /今天|昨天|我|买了?|花了?|支出|收入|记一笔|赚了?|元|dollars?|\b(today|yesterday|spent|paid|record|earned|income|expense)\b/gi,
                    "",
                  )
                  .replace(match[0], "")
                  .trim()
                  .replace(/^[:$¥￥ ]+|[:$¥￥ ]+$/g, "") || "Manual record";
    const category = /咖啡|coffee|餐饮|dining|lunch|dinner/i.test(clause)
      ? "Dining"
      : /食品|超市|grocer/i.test(clause)
        ? "Groceries"
        : /房租|rent|housing/i.test(clause)
          ? "Housing"
          : /出行|train|transport|taxi/i.test(clause)
            ? "Transport"
            : income
              ? "Income"
              : "Other";
    operations.push({
      op_id: `o${operations.length + 1}`,
      kind: "create_draft",
      selected: true,
      resource_type: "candidate",
      source_span: clause,
      date_basis: clauseDate.basis,
      amount_candidates: amountCandidates,
      fields: {
        kind,
        amount: amountCandidates.length === 1 ? match[2] : null,
        currency: code,
        date: clauseDate.parsedDay,
        merchant: merchant.slice(0, 120),
        category,
        account_id: selected?.currency === code ? selected.id : null,
        counterparty_id: null,
        refund_of: null,
        external_id: null,
        mock: false,
      },
    });
  }
  if (operations.length > 20) throw new Error("每次最多20个操作。");
  return {
    intent: "create_transactions",
    object: "record",
    operations,
    status: operations.length ? "PARSED" : "NEEDS_CLARIFICATION",
  };
}

export function matchingTargets(text, candidates, date) {
  const words = [
    "咖啡",
    "coffee",
    "餐饮",
    "dining",
    "食品",
    "groceries",
    "房租",
    "housing",
    "兼职",
    "part-time",
    "工资",
    "salary",
  ].filter((w) => text.toLowerCase().includes(w));
  const aliases = {
    咖啡: "coffee",
    餐饮: "dining",
    食品: "groceries",
    房租: "housing",
    兼职: "part-time",
    工资: "salary",
  };
  const exact = candidates.filter((item) => text.includes(item.id));
  if (exact.length)
    return exact.filter(
      (item) => !date || (item.content || item).date === date,
    );
  return candidates.filter((item) => {
    const values = item.content || item,
      names = [values.merchant, values.category, values.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    const match =
      text.includes(item.id) ||
      words.some((w) => names.includes(w) || names.includes(aliases[w] || w)) ||
      [values.merchant, values.name, values.category].some(
        (v) => v && text.toLowerCase().includes(v.toLowerCase()),
      );
    return match && (!date || values.date === date);
  });
}
