import {
  duplicateReview,
  duplicateReviewComplete,
  duplicateResolution,
} from "../duplicates.mjs";
import { isEducationalQuestion } from "../analysis-intent.mjs";
import { buildNotifications } from "../notifications.mjs";
import preset from "./preset.mjs";
import { createDemoExperience } from "./experience.mjs";
import { enrichDemoState } from "./insights.mjs";
import {
  DEFAULT_TERMINAL_SETTINGS,
  searchKnowledge,
} from "../terminal/knowledge.mjs";
import {
  minor,
  format,
  precision,
  summaries,
  moneyFlow,
  riskFor,
  portfolioFor,
  product,
} from "./calculations.mjs";

export const DEMO_PERIOD = preset.period;
export const DEMO_DATE = preset.date;
export const DEMO_STORAGE_KEY = "zhizhang.product-demo.v1";
export const DEMO_RECEIPT = preset.receipt.raw_text;
export const DEMO_CSV =
  "date,amount,currency,merchant,category,kind,external_id\n2026-09-29,42.60,AUD,Harbor Lunch,Dining,expense,demo-csv-lunch\n2026-09-29,95.20,AUD,Fresh Market,Groceries,expense,demo-csv-groceries";
const stamp = `${DEMO_DATE}T06:00:00Z`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const id = () => `demo-${crypto.randomUUID()}`;
const canonical = (value) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
const hash = async (value) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new globalThis.TextEncoder().encode(value),
      ),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");

function fresh() {
  const state = clone(preset.state);
  for (const key of [
    "summary",
    "money_flow",
    "risk",
    "portfolio",
    "daily",
    "statements",
  ])
    delete state[key];
  return {
    schema: preset.version,
    kind: "synthetic-wallet-demo",
    locked: false,
    revision: 0,
    state,
    reports: clone(preset.reports),
    notification_receipts: [],
    terminal: {
      ...clone(DEFAULT_TERMINAL_SETTINGS),
      documents: [
        {
          id: "demo-knowledge-policy",
          name: "Demo planning notes",
          at: stamp,
          text: "Synthetic demonstration policy: keep an emergency reserve before allocating optional investments. Monthly contributions are user-defined assumptions. Cash flow uses confirmed records only. All model explanations are preset examples; this demo never calls an external service. 演示规划说明：先保留应急储备，再考虑可选投资。月投入由用户自行假设，现金流仅使用已确认记录。",
        },
      ],
    },
    terminal_audit: [],
  };
}

/** Local simulation of the existing transport contract. It never calls fetch or a live service. */
export function createDemoClient({
  translate = (value) => value,
  locale = () => "en",
  storage: suppliedStorage,
} = {}) {
  let db,
    storage,
    persistence = "browser";
  const challenges = new Map(),
    retries = new Map();
  const fail = (code, message) => {
    const error = new Error(translate(message));
    error.code = code;
    if (locale() === "en" && /[\u3400-\u9fff]/.test(error.message))
      error.message = `${code.replaceAll("_", " ")}. Check the details and try again.`;
    throw error;
  };
  const check = (condition, code, message) => {
    if (!condition) fail(code, message);
  };
  function initialize() {
    if (db) return;
    try {
      storage =
        suppliedStorage === undefined ? window.localStorage : suppliedStorage;
      const saved = storage?.getItem(DEMO_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : null;
      const valid =
        parsed?.kind === "synthetic-wallet-demo" &&
        parsed.schema === preset.version &&
        [
          "accounts",
          "transactions",
          "drafts",
          "holdings",
          "market_evidence",
        ].every((key) => Array.isArray(parsed.state?.[key])) &&
        parsed.reports &&
        parsed.state.planning &&
        parsed.state.consents;
      db = valid ? parsed : fresh();
    } catch {
      db = fresh();
      persistence = "memory";
    }
    experience.initialize();
    persist();
  }
  function persist() {
    try {
      if (!storage) {
        persistence = "memory";
        return;
      }
      storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(db));
    } catch {
      persistence = "memory";
    }
  }
  function amount(value, currency, positive = false) {
    let result;
    try {
      result = minor(value, currency);
    } catch (error) {
      fail(
        error.message,
        error.message === "CURRENCY_PRECISION"
          ? "金额小数位不符合币种规则。"
          : "金额必须是十进制字符串。",
      );
    }
    check(!positive || result > 0n, "INVALID_AMOUNT", "金额必须大于零。");
    check(
      result < 10n ** BigInt(12 + precision[currency]) &&
        result > -(10n ** BigInt(12 + precision[currency])),
      "AMOUNT_LIMIT",
      "金额超出本地版本限制。",
    );
    return format(result, currency);
  }
  function date(value) {
    check(
      typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value,
      "INVALID_DATE",
      "日期无效。",
    );
    return value;
  }
  function text(value, limit = 120) {
    check(
      typeof value === "string" &&
        value.trim().length > 0 &&
        value.trim().length <= limit &&
        !Array.from(value).some((c) => c.charCodeAt(0) < 32),
      "INVALID_FIELD",
      "请填写有效名称或描述。",
    );
    return value.trim();
  }
  function normalized(raw) {
    const account = db.state.accounts.find(
      (a) => a.id === raw.account_id && !a.archived,
    );
    check(account, "RESOURCE_NOT_FOUND", "账户不存在。");
    check(
      account.currency === raw.currency,
      "CURRENCY_MISMATCH",
      "账户与交易币种不一致。",
    );
    const kind = raw.kind || "expense";
    check(
      [
        "income",
        "expense",
        "transfer",
        "card_payment",
        "loan_received",
        "debt_principal",
        "interest",
        "dividend",
        "investment_buy",
        "investment_sell",
        "refund",
      ].includes(kind),
      "INVALID_KIND",
      "不支持的交易类型。",
    );
    if (
      ["transfer", "card_payment", "loan_received", "debt_principal"].includes(
        kind,
      )
    ) {
      const other = db.state.accounts.find((a) => a.id === raw.counterparty_id);
      check(
        other && !other.archived && other.id !== account.id,
        "COUNTERPARTY_REQUIRED",
        "请选择不同的对方账户。",
      );
      check(
        other.currency === account.currency,
        "FX_REQUIRED",
        "跨币种转账需FX证据；本地版本仅支持同币种转账。",
      );
      check(
        account.type === "cash" &&
          other.type === (kind === "transfer" ? "cash" : "liability"),
        "INVALID_ACCOUNT_TYPE",
        "对方账户类型不匹配。",
      );
    }
    if (
      ["income", "dividend", "investment_buy", "investment_sell"].includes(kind)
    )
      check(
        account.type === "cash",
        "INVALID_ACCOUNT_TYPE",
        "此交易需要现金/银行账户。",
      );
    return {
      kind,
      date: date(raw.date),
      amount: amount(raw.amount, raw.currency, true),
      currency: raw.currency,
      merchant: text(raw.merchant || "Demo record"),
      category: text(raw.category || "Other", 40),
      account_id: account.id,
      counterparty_id: raw.counterparty_id || null,
      refund_of: raw.refund_of || null,
      external_id: raw.external_id || null,
      mock: true,
    };
  }
  function addDraft(
    raw,
    evidence = {
      source: "DEMO_MANUAL",
      quality: "USER_PROVIDED",
      limitations: ["仅演示数据；不连接真实账户。"],
    },
  ) {
    const content = normalized(raw);
    check(
      db.state.drafts.length < 200,
      "RESOURCE_LIMIT",
      "演示草稿数量已达上限，请重置演示。",
    );
    const duplicate_candidates = db.state.transactions
      .filter(
        (e) =>
          !e.reverses &&
          e.kind !== "opening" &&
          ["date", "amount", "currency", "merchant", "account_id"].every(
            (k) => e[k] === content[k],
          ),
      )
      .map((e) => e.id);
    const draft = {
      id: id(),
      version: 1,
      content,
      evidence,
      duplicate_candidates,
    };
    db.state.drafts.unshift(draft);
    return draft;
  }
  function postings(event) {
    const {
      account_id: account,
      counterparty_id: other,
      kind,
      category,
      currency,
    } = event;
    const value = minor(event.amount, currency);
    let rows;
    if (["income", "dividend"].includes(kind))
      rows = [
        [account, value],
        [`income:${category}`, -value],
      ];
    else if (["expense", "interest"].includes(kind))
      rows = [
        [`expense:${category}`, value],
        [account, -value],
      ];
    else if (kind === "refund")
      rows = [
        [account, value],
        [`expense:${category}`, -value],
      ];
    else if (["transfer", "card_payment", "debt_principal"].includes(kind))
      rows = [
        [other, value],
        [account, -value],
      ];
    else if (kind === "loan_received")
      rows = [
        [account, value],
        [other, -value],
      ];
    else if (kind === "investment_buy")
      rows = [
        ["investment:principal", value],
        [account, -value],
      ];
    else
      rows = [
        [account, value],
        ["investment:principal", -value],
      ];
    return rows.map(([key, money]) => [key, format(money, currency)]);
  }
  function validatePlan(raw) {
    check(
      precision[raw.currency] !== undefined,
      "CURRENCY_UNSUPPORTED",
      "请选择支持的币种。",
    );
    const plan = {
      ...raw,
      budgets: [],
      goals: [],
      timezone: raw.timezone || "Australia/Sydney",
    };
    try {
      new Intl.DateTimeFormat("en", { timeZone: plan.timezone }).format(
        new Date(stamp),
      );
    } catch {
      fail("INVALID_TIMEZONE", "请选择有效时区。");
    }
    for (const key of [
      "monthly_income",
      "essential_spend",
      "debt_payment",
      "earmarked",
    ]) {
      plan[key] =
        raw[key] === "" || raw[key] === null || raw[key] === undefined
          ? null
          : amount(raw[key], raw.currency);
      check(
        plan[key] === null || minor(plan[key], raw.currency) >= 0n,
        "INVALID_AMOUNT",
        "金额必须大于零。",
      );
    }
    plan.budgets = (raw.budgets || []).map((b) => ({
      id: b.id || `demo-budget-${b.category}`,
      version: b.version || 1,
      category: text(b.category, 40),
      amount: amount(b.amount, raw.currency, true),
    }));
    check(
      new Set(plan.budgets.map((b) => b.category)).size === plan.budgets.length,
      "DUPLICATE_BUDGET",
      "预算类别不能重复。",
    );
    plan.goals = (raw.goals || []).map((g) => ({
      id: g.id || `demo-goal-${g.name}`,
      version: g.version || 1,
      name: text(g.name),
      target: amount(g.target, raw.currency, true),
      saved: amount(g.saved, raw.currency),
      deadline: date(g.deadline),
    }));
    check(
      plan.goals.every((g) => minor(g.saved, raw.currency) >= 0n),
      "INVALID_AMOUNT",
      "金额必须大于零。",
    );
    return plan;
  }
  function stateFor(period) {
    check(
      /^\d{4}-\d{2}$/.test(period) &&
        Number(period.slice(-2)) >= 1 &&
        Number(period.slice(-2)) <= 12 &&
        Number(period.slice(0, 4)) > 0,
      "INVALID_PERIOD",
      "期间格式应为 YYYY-MM。",
    );
    const state = clone(db.state);
    state.investments = experience.rows();
    state.holdings = state.investments
      .filter((x) => !x.archived && x.latest?.market_value != null)
      .map((x) => ({
        ...x,
        ...x.latest,
        id: x.id,
        market_value: x.latest.market_value,
        observed_at: x.latest.observed_at,
      }));
    state.accounts.forEach((a) => {
      const balance = state.transactions.reduce(
        (sum, event) =>
          sum +
          event.postings
            .filter(([key]) => key === a.id)
            .reduce((part, [, value]) => part + minor(value, a.currency), 0n),
        0n,
      );
      a.balance = format(
        a.type === "liability" ? -balance : balance,
        a.currency,
      );
    });
    state.period = period;
    state.summary = state.consents.analysis
      ? summaries(state.transactions, state.accounts, period)
      : null;
    state.money_flow = state.consents.analysis
      ? moneyFlow(state.transactions, state.accounts, period)
      : [];
    state.risk = state.summary
      ? riskFor(state.accounts, state.summary, state.planning, DEMO_DATE)
      : null;
    state.portfolio = state.consents.analysis
      ? portfolioFor(state.holdings)
      : [];
    state.daily = {
      date: DEMO_DATE,
      summary: state.consents.analysis
        ? summaries(
            state.transactions.filter(
              (e) => e.date === DEMO_DATE && e.kind !== "opening",
            ),
            state.accounts,
            DEMO_PERIOD,
          )
        : null,
    };
    state.statements = Object.values(db.reports)
      .map(({ id, snapshot, version }) => ({
        id,
        period: snapshot.period,
        version,
        created_at: stamp,
      }))
      .sort(
        (a, b) => b.period.localeCompare(a.period) || b.version - a.version,
      );
    state.mode = "OFFLINE_PRODUCT_DEMO";
    state.calc_version = "demo-ledger-1";
    state.mock = true;
    state.as_of = stamp;
    state.demo = { date: DEMO_DATE, period: DEMO_PERIOD, persistence };
    state.capabilities = {
      cloud_model: false,
      bank_sync: false,
      trading: false,
      ocr: true,
      training: false,
    };
    state.limitations = [
      "仅演示数据；不连接真实账户。",
      "所有市场、模型与识别结果均为手动预设。",
      "演示修改仅保存在本浏览器，与正式账本分开。",
    ];
    const enriched = enrichDemoState(state);
    const valuations = {};
    for (const point of db.valuations || [])
      (valuations[point.investment_id] ||= []).push(point);
    enriched.notifications = buildNotifications(
      enriched,
      valuations,
      db.notification_receipts || [],
    );
    return enriched;
  }
  function baseProposal(purpose, resource, payload) {
    const extended = experience.preview(purpose, resource, payload);
    if (extended !== undefined) return extended;
    if (["confirm_draft", "reject_draft"].includes(purpose)) {
      const draft = db.state.drafts.find((d) => d.id === resource);
      check(draft, "RESOURCE_NOT_FOUND", "待确认草稿不存在。");
      return draft.content;
    }
    if (purpose === "reverse_event") {
      const original = db.state.transactions.find((e) => e.id === resource);
      check(
        original &&
          !original.reverses &&
          original.kind !== "opening" &&
          !db.state.transactions.some((e) => e.reverses === resource),
        "ALREADY_REVERSED",
        "交易已冲正。",
      );
      check(
        !db.state.transactions.some(
          (e) =>
            e.refund_of === resource &&
            !e.reverses &&
            !db.state.transactions.some((other) => other.reverses === e.id),
        ),
        "REFUND_DEPENDENCY",
        "原交易存在退款；请先冲正退款。",
      );
      check(
        !db.performance_events.some(
          (e) => e.content.ledger_event_ref === resource,
        ),
        "INVESTMENT_DEPENDENCY",
        "此现金事件已关联投资收益历史；请保留来源或先处理关联历史。",
      );
      return {
        original,
        event_id: resource,
        effect: "追加反向分录；保留原交易",
      };
    }
    if (purpose === "planning") {
      check(resource === "planning", "INVALID_RESOURCE", "规划资源无效。");
      return validatePlan(payload);
    }
    if (purpose === "consents") {
      check(
        resource === "consents" &&
          payload &&
          Object.keys(payload).sort().join() === "analysis,ocr" &&
          Object.values(payload).every((v) => typeof v === "boolean"),
        "INVALID_CONSENT",
        "仅支持本地分析/凭证识别两种用途。",
      );
      return payload;
    }
    check(
      ["privacy_delete", "privacy_export"].includes(purpose) &&
        resource === "all",
      "PURPOSE_FORBIDDEN",
      "此操作不在确认白名单中。",
    );
    return {
      scope: "demo-browser-only",
      counts: {
        accounts: db.state.accounts.length,
        drafts: db.state.drafts.length,
        events: db.state.transactions.length,
        holdings: db.state.holdings.length,
        investments: db.state.investments.length,
        command_plans: Object.keys(db.commands || {}).length,
        investment_valuations: (db.valuations || []).length,
        statements: Object.keys(db.reports).length,
      },
    };
  }
  function proposal(purpose, resource, payload) {
    return duplicateReview(
      baseProposal(purpose, resource, payload),
      purpose,
      resource,
      db.state.transactions,
      db.state.ledger_version,
    );
  }
  async function consume(data, purpose, resource) {
    const c = challenges.get(data.nonce);
    check(
      c &&
        c.purpose === purpose &&
        c.resource === resource &&
        c.content_hash === data.content_hash &&
        c.expires > Date.now(),
      "CONFIRMATION_INVALID",
      "确认无效或过期，请重新预览。",
    );
    check(
      c.revision === db.revision &&
        (await hash(canonical(proposal(purpose, resource, data.payload)))) ===
          c.content_hash,
      "PROPOSAL_STALE",
      "数据已变化，请重新预览。",
    );
    check(
      duplicateReviewComplete(
        c.preview.duplicate_review,
        data.duplicate_resolutions,
      ),
      "DUPLICATE_REVIEW_REQUIRED",
      "Review duplicate matches and explain why each is a separate transaction.",
    );
    return c;
  }
  function statement(period) {
    check(db.state.consents.analysis, "CONSENT_REVOKED", "分析用途已撤回。");
    const state = stateFor(period),
      pending = state.drafts.filter((draft) =>
        draft.content.date.startsWith(period),
      ).length,
      previous = Object.values(db.reports)
        .filter((r) => r.snapshot.period === period)
        .sort((a, b) => b.version - a.version)[0];
    if (
      previous &&
      previous.snapshot.ledger_version === state.ledger_version &&
      previous.snapshot.settings_version === state.settings_version &&
      previous.snapshot.pending_drafts === pending
    )
      return { id: previous.id, version: previous.version, reused: true };
    const record = {
      id: id(),
      version: (previous?.version || 0) + 1,
      snapshot: {
        snapshot_id: id(),
        period,
        summary: state.summary,
        ledger_version: state.ledger_version,
        settings_version: state.settings_version,
        pending_drafts: pending,
        cutoff: stamp,
        timezone: state.planning.timezone,
        calc_version: "demo-ledger-1",
        mock: true,
        event_ids: state.transactions
          .filter((e) => e.date.startsWith(period))
          .map((e) => e.id),
        limitations: state.limitations,
        revision_reason: previous
          ? "账本/规划/待确认数据变化，保留旧版本。"
          : "首次暂结。",
      },
    };
    db.reports[record.id] = record;
    return { id: record.id, version: record.version, reused: false };
  }
  async function report(record) {
    const s = record.snapshot,
      t = translate;
    const lines = [
      `# ${s.period} ${t("演示月度账单")}`,
      t("MOCK · 仅用于产品演示，不是实际财务报告。"),
      `v${record.version} · ${s.snapshot_id}`,
      `${t("分析截止")} ${s.cutoff}`,
      "",
    ];
    for (const summary of s.summary) {
      lines.push(
        `## ${summary.currency}`,
        `${t("收入")} ${summary.income}`,
        `${t("本月确认费用")} ${summary.expenses}`,
        `${t("现金变化")} ${summary.cash_change}`,
        `${t("现金余额")} ${summary.closing_cash}`,
        `| ${t("类别")} | ${t("金额")} |`,
        "|---|---:|",
      );
      Object.entries(summary.categories).forEach(([category, value]) =>
        lines.push(
          `| ${category.replaceAll("|", "\\|").replaceAll("<", "&lt;").replaceAll(">", "&gt;")} | ${value} |`,
        ),
      );
    }
    lines.push("", t(s.revision_reason), ...s.limitations.map(t));
    const markdown = lines.join("\n");
    return {
      id: record.id,
      version: record.version,
      snapshot: clone(s),
      markdown,
      sha256: await hash(markdown),
      language: locale(),
      mock: true,
    };
  }
  function analysis(question, period, currency) {
    check(
      !currency || Object.hasOwn(precision, currency),
      "CURRENCY_UNSUPPORTED",
      "请选择支持的币种。",
    );
    check(db.state.consents.analysis, "CONSENT_REVOKED", "分析用途已撤回。");
    const state = stateFor(period);
    const blocked =
      !isEducationalQuestion(question) &&
      /买入|卖出|下单|转账|删除|支付|buy|sell|trade|transfer|delete|pay\b/i.test(
        question,
      );
    const category = blocked
      ? "blocked"
      : /market|inflation|市场|通胀|CPI/i.test(question)
        ? "market"
        : /portfolio|holding|investment|持仓|投资/i.test(question)
          ? "portfolio"
          : /scenario|stress|失业|压力|情景/i.test(question)
            ? "scenario"
            : /budget|goal|预算|目标/i.test(question)
              ? "budget"
              : "spending";
    const result = clone(
      preset.answers[category === "market" ? "spending" : category],
    );
    Object.assign(result, {
      id: id(),
      period,
      snapshot_id: id(),
      mock: true,
      as_of: stamp,
      artifact: {
        id: "offline-demo-presets-1",
        kind: "preset-simulation",
        trained: false,
        external_requests: false,
      },
      facts: [],
      calculations: [],
      assumptions: [
        "分析解释是预设演示脚本，不调用AI模型。",
        ...state.limitations,
      ],
      actions: ["查看草稿、预算和持仓，体验预览与确认流程。"],
    });
    result.scope = {
      period,
      currency: currency || null,
      currencies: [
        ...new Set(
          state.accounts
            .filter((a) => !currency || a.currency === currency)
            .map((a) => a.currency),
        ),
      ],
      ledger_version: state.ledger_version,
      settings_version: state.settings_version,
      calculation_version: state.calc_version,
      event_ids: state.transactions
        .filter(
          (e) =>
            e.date.startsWith(period) && (!currency || e.currency === currency),
        )
        .map((e) => e.id),
    };
    if (blocked) {
      result.actions = ["演示版不执行资金操作；此结果用于展示产品边界。"];
      return result;
    }
    if (
      currency &&
      !state.accounts.some((a) => a.currency === currency) &&
      !state.investments.some((i) => i.currency === currency)
    ) {
      result.status = "DEGRADED";
      result.actions = ["所选币种没有可分析的记录。"];
      return result;
    }
    if (currency) {
      state.summary = state.summary.filter((s) => s.currency === currency);
      state.portfolio = state.portfolio.filter((p) => p.currency === currency);
    }
    result.plan.forEach((step) => {
      step.arguments = { snapshot_id: result.snapshot_id };
    });
    result.observations.forEach((observation) => {
      observation.quality = "DEMO_PRESET";
    });
    if (category === "market") {
      result.facts = state.market_evidence;
      result.plan = [];
      result.observations = [];
      result.tool_calls = 0;
      return result;
    }
    if (category === "portfolio")
      result.calculations = state.portfolio.map((p) => ({
        metric_id: `demo:portfolio:${p.currency}`,
        label: "手工持仓市值",
        value: p.total,
        unit: p.currency,
      }));
    else {
      if (category === "spending")
        for (const summary of state.summary)
          for (const [key, label] of [
            ["income", "确认收入"],
            ["expenses", "确认费用（扣除退款）"],
            ["cash_change", "现金变化"],
          ])
            result.calculations.push({
              metric_id: `demo:${period}:${summary.currency}:${key}`,
              label,
              value: summary[key],
              unit: summary.currency,
            });
      if (!currency || state.risk.metrics.currency === currency)
        for (const [key, label] of [
          ["available", "可用现金"],
          ["coverage_months", "必要支出覆盖月数"],
          ["cash_30d", "30天情景现金"],
          ["income_loss_months", "无收入情景月数"],
        ])
          result.calculations.push({
            metric_id: `demo:risk:${key}`,
            label,
            value: state.risk.metrics[key],
            unit: key.includes("months")
              ? "months"
              : state.risk.metrics.currency,
          });
      if (!currency || state.risk.metrics.currency === currency)
        result.actions.push(...state.risk.findings.map((f) => f.message));
      else result.actions.push("当前币种缺少已批准的规划假设。");
    }
    if (/internal transfer|内部转账|转账.*费用/i.test(question))
      result.actions.unshift(
        "内部转账改变账户间的现金分布，不构成新的收入或费用；借款与还款本金也不重复计入费用。",
      );
    if (isEducationalQuestion(question) && /sell|buy|卖出|买入/i.test(question))
      result.actions.unshift(
        "买卖会改变持仓与现金，税费、流动性和成本资料不足时不能判断净收益；本次只解释，不执行交易。",
      );
    if (
      !result.calculations.some(
        (c) => c.value !== null && c.value !== undefined,
      )
    )
      result.status = "DEGRADED";
    return result;
  }
  function parseCsv(source) {
    check(
      typeof source === "string" &&
        new globalThis.TextEncoder().encode(source).length <= 1024 * 1024,
      "FILE_LIMIT",
      "CSV限1MiB。",
    );
    const rows = [];
    let row = [],
      field = "",
      quoted = false;
    for (let i = 0; i < source.length; i++) {
      const character = source[i];
      if (character === '"') {
        if (quoted && source[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = !quoted;
      } else if (character === "," && !quoted) {
        row.push(field);
        field = "";
      } else if (character === "\n" && !quoted) {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        field = "";
      } else field += character;
    }
    check(!quoted, "INVALID_CSV", "CSV格式无效。");
    if (field || row.length) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
    }
    const header = rows
      .shift()
      ?.map((value) => value.replace(/^\uFEFF/, "").trim());
    check(
      header &&
        ["date", "amount", "currency", "merchant"].every((key) =>
          header.includes(key),
        ) &&
        new Set(header).size === header.length &&
        rows.length <= 500,
      "INVALID_CSV",
      "CSV需包含日期、金额、币种与商户表头，最多500行。",
    );
    return rows
      .filter((r) => r.some((v) => v.trim()))
      .map((r) => {
        check(r.length === header.length, "INVALID_CSV", "CSV列数不匹配。");
        return Object.fromEntries(header.map((key, i) => [key, r[i]]));
      });
  }
  async function dispatch(path, method, body, retryKey) {
    const extended = await experience.dispatch(
      path.split("?")[0],
      method,
      body,
      retryKey,
    );
    if (extended.handled) return extended.result;
    const [route, query = ""] = path.split("?"),
      parts = route.split("/"),
      period = new URLSearchParams(query).get("period") || DEMO_PERIOD;
    if (route === "demo/reset") {
      db = fresh();
      challenges.clear();
      retries.clear();
      return { reset: true };
    }
    if (route === "session") {
      db.locked = method === "DELETE";
      challenges.clear();
      return { authenticated: !db.locked, demo: true };
    }
    check(!db.locked, "UNAUTHENTICATED", "演示已锁定，请重新进入。");
    if (route === "notifications" && method === "GET")
      return stateFor(period).notifications;
    if (route === "notifications/read" && method === "POST") {
      check(
        body &&
          Object.keys(body).sort().join() === "ids,period" &&
          Array.isArray(body.ids) &&
          body.ids.length > 0 &&
          body.ids.length <= 50 &&
          body.ids.every((id) => typeof id === "string" && id.length <= 256),
        "INVALID_FIELDS",
        "Select up to 50 current notifications",
      );
      const available = new Set(
        stateFor(body.period).notifications.items.map((n) => n.id),
      );
      check(
        body.ids.every((id) => available.has(id)),
        "RESOURCE_NOT_FOUND",
        "The notification changed; refresh this period",
      );
      db.notification_receipts = [
        ...new Set([...body.ids, ...(db.notification_receipts || [])]),
      ].slice(0, 500);
      return { updated: new Set(body.ids).size };
    }
    if (parts[0] === "terminal") {
      const settings =
        db.terminal || (db.terminal = clone(DEFAULT_TERMINAL_SETTINGS));
      const publicSettings = () => ({
        ...clone(settings),
        provider: "openai",
        key_configured: false,
        endpoint: "offline-preset",
        cloud_automatic: false,
        database_encrypted: false,
        retrieval_method: "384-dimensional-hashed-lexical-cosine",
        demo: true,
      });
      const audit = (action) => {
        (db.terminal_audit ||= []).push({
          id: id(),
          action,
          at: new Date().toISOString(),
          resource_id: "demo-terminal",
        });
        db.terminal_audit = db.terminal_audit.slice(-100);
      };
      if (parts[1] === "settings" && method === "GET") return publicSettings();
      if (parts[1] === "audit" && method === "GET")
        return {
          events: clone(db.terminal_audit || []).reverse(),
          verified: false,
          method: "DEMO_BROWSER_LOG_NOT_ATTESTED",
        };
      if (parts[1] === "settings" && method === "PUT") {
        check(
          Object.keys(body).sort().join() ===
            "max_tokens,model,temperature,threshold,top_k" &&
            typeof body.model === "string" &&
            /^[a-zA-Z0-9._-]{1,80}$/.test(body.model),
          "INVALID_SETTINGS",
          "设置字段无效。",
        );
        for (const [key, lo, hi, whole] of [
          ["max_tokens", 100, 4000, true],
          ["temperature", 0, 2, false],
          ["top_k", 1, 10, true],
          ["threshold", 0, 1, false],
        ])
          check(
            typeof body[key] === "number" &&
              Number.isFinite(body[key]) &&
              body[key] >= lo &&
              body[key] <= hi &&
              (!whole || Number.isInteger(body[key])),
            "INVALID_SETTINGS",
            "设置参数超出范围。",
          );
        Object.assign(settings, body);
        audit("terminal.settings");
        return publicSettings();
      }
      if (parts[1] === "documents" && method === "POST") {
        check(
          db.state.consents.analysis,
          "CONSENT_REQUIRED",
          "分析用途未授权。",
        );
        check(
          Object.keys(body).sort().join() === "name,text" &&
            typeof body.name === "string" &&
            body.name.length > 0 &&
            body.name.length <= 100 &&
            typeof body.text === "string" &&
            body.text.trim().length > 0 &&
            body.text.length <= 50000 &&
            settings.documents.length < 20,
          "DOCUMENT_LIMIT",
          "最多20份文档，每份不超过50,000字符。",
        );
        settings.documents.push({
          id: id(),
          name: body.name,
          text: body.text,
          at: new Date().toISOString(),
        });
        audit("knowledge.import");
        return publicSettings();
      }
      if (parts[1] === "documents" && method === "DELETE") {
        check(
          Object.keys(body).join() === "id" &&
            settings.documents.some((x) => x.id === body.id),
          "RESOURCE_NOT_FOUND",
          "文档不存在。",
        );
        settings.documents = settings.documents.filter((x) => x.id !== body.id);
        audit("knowledge.delete");
        return publicSettings();
      }
      if (["search", "model-preview"].includes(parts[1]) && method === "POST") {
        check(
          db.state.consents.analysis,
          "CONSENT_REQUIRED",
          "分析用途未授权。",
        );
        check(
          Object.keys(body).join() === "query" &&
            typeof body.query === "string" &&
            body.query.trim().length > 0 &&
            body.query.length <= 2000,
          "INVALID_QUERY",
          "请输入1至2000字符的问题。",
        );
        const results = searchKnowledge(
          settings.documents,
          body.query,
          settings.top_k,
          settings.threshold,
        );
        if (parts[1] === "search")
          return { results, method: "hashed-lexical-cosine", local: true };
        const nonce = id();
        challenges.set(nonce, { terminal: true, expires: Date.now() + 120000 });
        return {
          nonce,
          destination: "OFFLINE DEMO — NO NETWORK",
          payload: {
            model: settings.model,
            question: body.query,
            excerpts: results,
            simulated: true,
          },
          expires_seconds: 120,
          warning: "This returns a hand-written preset, not a model response.",
        };
      }
      if (parts[1] === "model-explanation" && method === "POST") {
        const challenge = challenges.get(body.nonce);
        check(
          body.confirmed === true &&
            challenge?.terminal &&
            challenge.expires > Date.now(),
          "CONFIRMATION_EXPIRED",
          "确认已过期。",
        );
        challenges.delete(body.nonce);
        audit("model.preset");
        return {
          text:
            locale() === "zh"
              ? "演示预设：优先检查已确认现金流与应急储备，再比较规划页面中的可编辑假设。这是一段手动编写的产品示例，不来自云模型，不构成投资建议。"
              : "DEMO PRESET: Review confirmed cash flow and your emergency reserve before comparing editable planning assumptions. This is a hand-written product example, not a cloud model response or investment recommendation.",
          source: "HAND_WRITTEN_DEMO_PRESET",
          read_only: true,
        };
      }
      fail("DEMO_ROUTE_UNSUPPORTED", "此操作没有演示预设。");
    }
    if (route === "state" && method === "GET") return stateFor(period);
    if (route === "confirmation-challenges" && method === "POST") {
      const preview = clone(
        proposal(body.purpose, body.resource_id, body.payload),
      );
      const challenge = {
        nonce: id(),
        content_hash: await hash(canonical(preview)),
        preview,
        purpose: body.purpose,
        resource: body.resource_id,
        expires: Date.now() + 300000,
        revision: db.revision,
      };
      challenges.set(challenge.nonce, challenge);
      return {
        ...challenge,
        expires_at: new Date(challenge.expires).toISOString(),
      };
    }
    if (route === "accounts" && method === "POST") {
      check(
        ["cash", "liability"].includes(body.type),
        "INVALID_ACCOUNT_TYPE",
        "账户类型无效。",
      );
      const account = {
        id: id(),
        name: text(body.name),
        type: body.type,
        currency: body.currency,
        opened_on: date(body.opened_on),
        mock: true,
      };
      const balance = minor(
        amount(body.opening_balance || "0", body.currency),
        body.currency,
      );
      check(balance >= 0n, "INVALID_AMOUNT", "期初余额不能为负。");
      db.state.accounts.push(account);
      if (balance) {
        const value = account.type === "liability" ? -balance : balance;
        db.state.transactions.push({
          id: id(),
          kind: "opening",
          date: account.opened_on,
          merchant: "Opening balance",
          category: "Opening balance",
          account_id: account.id,
          currency: account.currency,
          amount: format(balance, account.currency),
          direction: "1",
          mock: true,
          reverses: null,
          postings: [
            [account.id, format(value, account.currency)],
            ["equity:opening", format(-value, account.currency)],
          ],
        });
      }
      db.state.ledger_version++;
      return { id: account.id };
    }
    if (route === "drafts" && method === "POST")
      return { id: addDraft(body).id };
    if (parts[0] === "drafts" && method === "PUT") {
      const draft = db.state.drafts.find((d) => d.id === parts[1]);
      check(
        draft && draft.version === body.version,
        "PROPOSAL_STALE",
        "草稿已变化，请重新打开。",
      );
      draft.content = normalized(body.content);
      draft.version++;
      return { id: draft.id, version: draft.version };
    }
    if (
      parts[0] === "drafts" &&
      ["confirm", "reject"].includes(parts[2]) &&
      method === "POST"
    ) {
      await consume(body, `${parts[2]}_draft`, parts[1]);
      const draft = db.state.drafts.find((d) => d.id === parts[1]);
      if (parts[2] === "confirm") {
        if (draft.evidence?.requires_ocr)
          check(db.state.consents.ocr, "CONSENT_REVOKED", "识别授权已撤回。");
        const content = normalized(draft.content);
        const duplicate_override = duplicateResolution(body, draft.id);
        if (duplicate_override)
          draft.evidence = { ...draft.evidence, duplicate_override };
        if (content.kind === "refund") {
          const original = db.state.transactions.find(
            (e) =>
              e.id === content.refund_of &&
              e.kind === "expense" &&
              !e.reverses &&
              !db.state.transactions.some((r) => r.reverses === e.id),
          );
          check(
            original && original.account_id === content.account_id,
            "REFUND_ORIGINAL",
            "请选择有效的原消费。",
          );
          const refunded = db.state.transactions
            .filter((e) => e.refund_of === original.id)
            .reduce(
              (sum, e) =>
                sum + minor(e.amount, e.currency) * BigInt(e.direction || "1"),
              0n,
            );
          check(
            minor(content.amount, content.currency) <=
              minor(original.amount, original.currency) - refunded,
            "REFUND_LIMIT",
            "退款超出剩余可退金额。",
          );
          content.category = original.category;
        }
        const event = {
          ...content,
          id: id(),
          direction: "1",
          reverses: null,
          postings: postings(content),
          evidence: draft.evidence,
        };
        db.state.transactions.push(event);
        db.state.ledger_version++;
        db.state.drafts = db.state.drafts.filter((d) => d.id !== draft.id);
        return { event_id: event.id };
      }
      db.state.drafts = db.state.drafts.filter((d) => d.id !== draft.id);
      return { id: draft.id, status: "REJECTED" };
    }
    if (
      parts[0] === "transactions" &&
      parts[2] === "reverse" &&
      method === "POST"
    ) {
      await consume(body, "reverse_event", parts[1]);
      const original = db.state.transactions.find((e) => e.id === parts[1]);
      const reverse = {
        ...clone(original),
        id: id(),
        direction: "-1",
        reverses: original.id,
        postings: original.postings.map(([key, value]) => [
          key,
          format(-minor(value, original.currency), original.currency),
        ]),
      };
      db.state.transactions.push(reverse);
      db.state.ledger_version++;
      return { event_id: reverse.id };
    }
    if (["planning", "consents"].includes(route) && method === "PUT") {
      await consume(body, route, route);
      db.state[route] = clone(proposal(route, route, body.payload));
      db.state.settings_version++;
      return { saved: true };
    }
    if (route === "imports" && method === "POST") {
      const rows = parseCsv(body.csv),
        drafts = [],
        duplicates = [];
      for (const row of rows) {
        const raw = {
          ...row,
          account_id: row.account_id || body.account_id,
          kind: row.kind || "expense",
          category: row.category || "Other",
        };
        const prior = [
          ...db.state.drafts.map((d) => d.content),
          ...db.state.transactions,
        ].find((e) => raw.external_id && e.external_id === raw.external_id);
        if (prior) {
          check(
            ["date", "currency", "merchant", "kind", "account_id"].every(
              (k) => prior[k] === raw[k],
            ) && prior.amount === amount(raw.amount, raw.currency),
            "SOURCE_CONFLICT",
            "来源ID相同但内容不同；请先修正。",
          );
          duplicates.push(prior);
        } else
          drafts.push(
            addDraft(raw, {
              source: "DEMO_CSV",
              quality: "USER_PROVIDED",
              limitations: ["仅演示数据；不连接真实账户。"],
            }),
          );
      }
      return {
        created: drafts.length,
        duplicates: duplicates.length,
        drafts: drafts.map((d) => ({ id: d.id })),
      };
    }
    if (route === "receipts" && method === "POST") {
      check(
        !body.image_base64,
        "DEMO_OCR_PRESET_ONLY",
        "演示不识别任意图片；请选择模拟样例或粘贴支持的凭证文本。",
      );
      check(db.state.consents.ocr, "CONSENT_REVOKED", "识别用途已撤回。");
      const account = db.state.accounts.find((a) => a.id === body.account_id);
      check(account, "RESOURCE_NOT_FOUND", "账户不存在。");
      const fields = {
        date: body.date || "2026-09-29",
        amount: body.amount || "138.50",
        currency: body.currency || "AUD",
        merchant: body.merchant || "Fresh Market · preset receipt",
      };
      const draft = addDraft(
        {
          ...fields,
          account_id: account.id,
          category: "Groceries",
          kind: "expense",
        },
        clone(preset.receipt),
      );
      return {
        fields,
        missing: [],
        evidence: clone(preset.receipt),
        draft_id: draft.id,
      };
    }
    if (route === "holdings" && method === "POST") {
      fail("LEGACY_CONFIRMATION_REQUIRED", "请使用有确认保护的投资条目接口。");
      const holding = {
        ...body,
        id: id(),
        name: text(body.name),
        issuer: text(body.issuer),
        observed_at: body.observed_at || stamp,
        mock: true,
      };
      check(
        ["stock", "etf", "bond", "cash", "complex"].includes(
          holding.asset_type,
        ) && precision[holding.currency] !== undefined,
        "INVALID_ASSET",
        "资产类型无效。",
      );
      try {
        check(
          product(holding.quantity, holding.price, holding.currency) >= 0n &&
            Number(holding.quantity) > 0,
          "INVALID_DECIMAL",
          "数量/价格超出范围。",
        );
      } catch {
        fail("INVALID_DECIMAL", "数量/价格超出范围。");
      }
      holding.cost_basis =
        body.cost_basis === "" ||
        body.cost_basis === null ||
        body.cost_basis === undefined
          ? null
          : amount(body.cost_basis, holding.currency);
      check(
        holding.cost_basis === null ||
          minor(holding.cost_basis, holding.currency) >= 0n,
        "INVALID_COST",
        "成本基础不能为负。",
      );
      db.state.holdings.push(holding);
      db.state.ledger_version++;
      return holding;
    }
    if (parts[0] === "holdings" && method === "DELETE") {
      fail("LEGACY_CONFIRMATION_REQUIRED", "请通过投资条目归档流程保留历史。");
      check(
        db.state.holdings.some((h) => h.id === parts[1]),
        "RESOURCE_NOT_FOUND",
        "持仓不存在。",
      );
      db.state.holdings = db.state.holdings.filter((h) => h.id !== parts[1]);
      db.state.ledger_version++;
      return { deleted: parts[1] };
    }
    if (route === "analyses" && method === "POST")
      return analysis(
        text(body.text, 2000),
        body.period || DEMO_PERIOD,
        body.currency,
      );
    if (route === "market/refresh" && method === "POST") {
      check(db.state.consents.analysis, "CONSENT_REVOKED", "分析用途已撤回。");
      db.state.market_evidence = clone(preset.state.market_evidence);
      return { added: 0, preset: true };
    }
    if (route === "statements" && method === "POST")
      return statement(body.period);
    if (parts[0] === "statements" && method === "GET") {
      check(db.state.consents.analysis, "CONSENT_REVOKED", "分析用途已撤回。");
      check(db.reports[parts[1]], "RESOURCE_NOT_FOUND", "报表不存在。");
      return report(db.reports[parts[1]]);
    }
    if (
      parts[0] === "privacy" &&
      ["export", "delete"].includes(parts[1]) &&
      method === "POST"
    ) {
      await consume(body, `privacy_${parts[1]}`, "all");
      if (parts[1] === "export")
        return {
          schema_version: "demo-2",
          mock: true,
          exported_at: stamp,
          scope: "demo-browser-only",
          data: stateFor(DEMO_PERIOD),
          reports: clone(db.reports),
          notification_receipts: clone(db.notification_receipts || []),
          terminal: clone(db.terminal || DEFAULT_TERMINAL_SETTINGS),
          experience: Object.fromEntries(
            [
              "commands",
              "import_batches",
              "valuations",
              "performance_events",
              "performance_observations",
              "operation_receipts",
            ].map((k) => [k, clone(db[k] || {})]),
          ),
        };
      const blank = fresh();
      blank.terminal = clone(DEFAULT_TERMINAL_SETTINGS);
      blank.terminal_audit = [];
      blank.locked = true;
      for (const key of [
        "accounts",
        "transactions",
        "drafts",
        "holdings",
        "market_evidence",
      ])
        blank.state[key] = [];
      blank.state.consents = { analysis: false, ocr: false };
      blank.state.planning = {
        currency: "AUD",
        monthly_income: null,
        essential_spend: null,
        debt_payment: null,
        earmarked: null,
        budgets: [],
        goals: [],
        life_status: [],
        timezone: "Australia/Sydney",
      };
      blank.reports = {};
      db = blank;
      challenges.clear();
      retries.clear();
      return { status: "DEMO_DATA_DELETED", mock: true };
    }
    fail("DEMO_ROUTE_UNSUPPORTED", "此操作没有演示预设。");
  }
  const experience = createDemoExperience({
    db: () => db,
    check,
    id,
    stamp,
    day: DEMO_DATE,
    normalized,
    addDraft,
    postings,
    consume,
    baseProposal: (purpose, resource, payload) =>
      proposal(purpose, resource, payload),
    validatePlan,
  });
  return async function demoRequest(path, method = "GET", body = {}, retryKey) {
    initialize();
    if (retryKey)
      check(
        typeof retryKey === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(retryKey),
        "IDEMPOTENCY_KEY",
        "幂等键无效。",
      );
    const requestHash = canonical({ path, method, body });
    if (
      retryKey &&
      (retries.has(retryKey) || db.operation_receipts?.[retryKey])
    ) {
      const previous = retries.get(retryKey) || db.operation_receipts[retryKey];
      check(
        previous.hash === requestHash,
        "IDEMPOTENCY_CONFLICT",
        "重试内容已变化。",
      );
      return clone(previous.result);
    }
    const before = clone(db),
      oldChallenges = new Map(challenges);
    try {
      const result = await dispatch(path, method, body, retryKey);
      if (
        method !== "GET" &&
        path !== "confirmation-challenges" &&
        path !== "analyses"
      ) {
        if (path !== "notifications/read") db.revision++;
        challenges.delete(body.nonce);
        if (retryKey) {
          const receipt = { hash: requestHash, result: clone(result) };
          retries.set(retryKey, receipt);
          db.operation_receipts ||= {};
          db.operation_receipts[retryKey] = receipt;
        }
        persist();
      }
      return clone(result);
    } catch (error) {
      db = before;
      challenges.clear();
      oldChallenges.forEach((value, key) => challenges.set(key, value));
      throw error;
    }
  };
}
