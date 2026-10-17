import { duplicateResolution } from "../duplicates.mjs";
import { parseCommand, matchingTargets } from "../commands/parser.mjs";
import { investmentPerformance, upgradeInvestments } from "./investments.mjs";
import { minor, format, precision, product } from "./calculations.mjs";

const copy = (v) => JSON.parse(JSON.stringify(v));
const eventFields = [
  "kind",
  "amount",
  "currency",
  "date",
  "merchant",
  "category",
  "account_id",
  "counterparty_id",
  "refund_of",
  "external_id",
  "mock",
];
export const DEMO_EVIDENCE = {
  receipt: "Harbor Coffee\n2026-09-29\nTotal 7.00 AUD",
  bank: "2026-09-10 Salary Income 200.00 AUD Balance 1200.00\n2026-09-11 Coffee Expense 7.00 AUD Balance 1193.00\n2026-09-12 Transfer 50.00 AUD Balance 1143.00",
  investment:
    "Fund name: Customer fund example\nObserved: 2026-09-30\nCurrency CNY\nMarket value 20500.00\nCost basis 20000.00\nDaily gain 60.00\nCumulative gain 500.00",
};

export function createDemoExperience(ctx) {
  const {
    check,
    id,
    stamp,
    day,
    normalized,
    addDraft,
    postings,
    consume,
    baseProposal,
    validatePlan,
  } = ctx;
  const database = () => {
    const db = ctx.db();
    upgradeInvestments(db, stamp);
    return db;
  };
  const command = (resource) => {
    const p = database().commands[resource];
    check(p, "RESOURCE_NOT_FOUND", "此会话的任务不存在。");
    return p;
  };
  const activeEvents = () => {
    const tx = database().state.transactions;
    return tx.filter(
      (e) =>
        !e.reverses &&
        e.kind !== "opening" &&
        !tx.some((r) => r.reverses === e.id),
    );
  };
  function targets(object) {
    const state = database().state;
    if (object === "record")
      return [
        ...state.drafts.map((d) => ({ ...d, resource_type: "draft" })),
        ...activeEvents().map((e) => ({
          id: e.id,
          version: 1,
          resource_type: "transaction",
          content: e,
        })),
      ];
    if (["budget", "goal"].includes(object))
      return (
        state.planning[object === "budget" ? "budgets" : "goals"] || []
      ).map((x) => ({ ...x, resource_type: object }));
    return (object === "account" ? state.accounts : state.investments).map(
      (x) => ({ ...x, resource_type: object, version: x.version || 1 }),
    );
  }
  const bind = (op, target, amount) => {
    const v = target.content || target;
    const fields = Object.fromEntries(
      Object.entries(v).filter(([k]) =>
        ["draft", "transaction"].includes(target.resource_type)
          ? eventFields.includes(k)
          : [
              "name",
              "category",
              "amount",
              "target",
              "saved",
              "deadline",
              "currency",
            ].includes(k),
      ),
    );
    if (amount != null)
      fields[target.resource_type === "goal" ? "target" : "amount"] = amount;
    return {
      ...op,
      resource_id: target.id,
      resource_type: target.resource_type,
      resource_version: target.version || 1,
      fields,
      previous: v,
    };
  };
  function review(p) {
    p.questions = [];
    for (const op of p.operations) {
      const f = op.fields;
      let errors = op.selected !== false ? [] : [...(op.errors || [])];
      if (op.selected !== false) {
        if (
          op.kind === "create_draft" ||
          (op.kind === "update_record" && op.resource_id)
        ) {
          errors = [
            "amount",
            "currency",
            "date",
            "merchant",
            "account_id",
            "kind",
          ].filter((k) => !f[k] || f[k] === "needs_classification");
          if (
            [
              "transfer",
              "card_payment",
              "loan_received",
              "debt_principal",
            ].includes(f.kind) &&
            !f.counterparty_id
          )
            errors.push("counterparty_id");
          if (!errors.length)
            try {
              normalized(f);
            } catch (e) {
              errors.push(e.code || "INVALID_FIELDS");
            }
        } else if (/^(update|delete)_/.test(op.kind) && !op.resource_id)
          errors.push("target");
        else if (
          ["create_budget", "create_goal"].includes(op.kind) &&
          !f.amount &&
          !f.target
        )
          errors.push("amount");
        else if (
          ["create_investment", "create_account"].includes(op.kind) &&
          !f.currency
        )
          errors.push("currency");
        else if (op.kind === "investment_observation") {
          errors = ["name", "currency", "observed_at"].filter((k) => !f[k]);
          if (!op.resource_id) errors.push("investment");
          if (!f.market_value && !f.reported_gain)
            errors.push("market_value/reported_gain");
        }
        if (op.evidence?.requires_ocr && !database().state.consents.ocr)
          errors.push("CONSENT_REVOKED");
        if (
          op.source_key &&
          database().state.transactions.some(
            (e) => e.evidence?.source_key === op.source_key,
          )
        )
          errors.push("DUPLICATE_SOURCE");
      }
      op.errors = errors;
      if (errors.length && op.selected !== false)
        p.questions.push({ op_id: op.op_id, fields: errors });
    }
    if (p.intent !== "query")
      p.status =
        p.questions.length || !p.operations.some((o) => o.selected !== false)
          ? "NEEDS_CLARIFICATION"
          : "READY";
    return p;
  }
  function plan(body) {
    let parsed;
    try {
      parsed = parseCommand(body.text, {
        ...body,
        accounts: database().state.accounts,
        timezone: database().state.planning.timezone,
        day,
      });
    } catch (e) {
      check(false, "COMMAND_FORBIDDEN", e.message);
    }
    const p = {
      ...parsed,
      command_id: id(),
      version: 1,
      input_text: body.text,
      period: body.period,
      mode: "OFFLINE_PRODUCT_DEMO",
      mock: true,
      results: [],
      warnings: [],
      operations: parsed.operations || [],
    };
    if (["query", "update", "delete"].includes(p.intent)) {
      let matches = matchingTargets(body.text, targets(p.object), p.date);
      if (
        body.recent_resource_ids?.length &&
        /刚才|最近|last|recent|just/i.test(body.text)
      ) {
        const recent = targets(p.object).filter((r) =>
          body.recent_resource_ids.includes(r.id),
        );
        const scoped = matches.filter((r) =>
          body.recent_resource_ids.includes(r.id),
        );
        matches = scoped.length
          ? scoped
          : matchingTargets(body.text, recent, p.date);
        if (
          !matches.length &&
          /^(?:删除|修改|移除|delete|change|update)?\s*(?:刚才|最近|last|recent|just)(?:那条|这一条|记录|one|record|entry)?[。.! ]*$/i.test(
            body.text,
          )
        )
          matches = recent;
      }
      if (p.intent === "query") {
        if (!matches.length && /全部|本月|list|this month/i.test(body.text))
          matches = targets(p.object);
        if (
          p.object === "record" &&
          body.period &&
          /本月|this month/i.test(body.text)
        )
          matches = matches.filter((r) =>
            r.content.date.startsWith(body.period),
          );
        if (body.account_id && p.object === "record")
          matches = matches.filter(
            (r) => r.content.account_id === body.account_id,
          );
        p.query_summary = [];
        if (p.object === "record" && database().state.consents.analysis) {
          const totals = new Map();
          for (const r of matches.filter(
            (r) => r.resource_type === "transaction",
          )) {
            const x = r.content,
              g = totals.get(x.currency) || {
                income: 0n,
                expenses: 0n,
                count: 0,
              };
            g.count++;
            if (["income", "dividend"].includes(x.kind))
              g.income += minor(x.amount, x.currency);
            if (["expense", "interest", "refund"].includes(x.kind))
              g.expenses +=
                minor(x.amount, x.currency) * (x.kind === "refund" ? -1n : 1n);
            totals.set(x.currency, g);
          }
          p.query_summary = [...totals].map(([currency, g]) => ({
            currency,
            income: format(g.income, currency),
            expenses: format(g.expenses, currency),
            count: g.count,
          }));
        }
        p.query_total = matches.length;
        p.results = matches.slice(0, 100).map((r) => ({
          resource_type: r.resource_type,
          resource_id: r.id,
          resource_version: r.version || 1,
          fields: r.content || r,
        }));
        p.status = "APPLIED";
      } else {
        let op = {
          op_id: "o1",
          kind: `${p.intent}_${p.object}`,
          targets: matches.map((r) => ({
            id: r.id,
            resource_type: r.resource_type,
            label: (r.content || r).merchant || r.name || r.category || r.id,
          })),
          resource_id: null,
          resource_type: p.object,
          selected: true,
          fields: { amount: p.amount },
          source_span: body.text,
        };
        if (matches.length === 1) {
          op = bind(op, matches[0], p.amount);
          const renamed = body.text.match(
            /(?:改名为|rename.+?\bto\b)\s*([^，。\n]+)$/i,
          );
          if (
            renamed &&
            ["account", "investment", "goal"].includes(op.resource_type)
          )
            op.fields.name = renamed[1].trim();
        }
        if (p.object === "investment" && op.fields.amount != null)
          op.fields.observed_at = stamp;
        p.operations = [op];
      }
    } else if (["budget", "goal", "account", "investment"].includes(p.object)) {
      const name =
        body.text
          .replace(
            /\b(create|add|budget|goal|account|investment)\b|新增|添加|预算|目标|账户|投资|\d+(?:\.\d+)?|AUD|CNY|USD/gi,
            "",
          )
          .trim() || "Local item";
      p.operations = [
        {
          op_id: "o1",
          kind: `create_${p.object}`,
          selected: true,
          source_span: body.text,
          fields: {
            name,
            category: name,
            amount: p.amount,
            currency:
              p.currency ||
              body.currency ||
              database().state.accounts.find((a) => a.id === body.account_id)
                ?.currency,
            ...(p.object === "investment" && p.amount != null
              ? { observed_at: stamp }
              : {}),
          },
        },
      ];
    }
    check(
      Object.keys(database().commands).length < 100,
      "COMMAND_LIMIT",
      "当前会话最多100项任务。",
    );
    database().commands[p.command_id] = review(p);
    return p;
  }
  function valuations(resource) {
    return database().valuations.filter((p) => p.investment_id === resource);
  }
  function rows() {
    return database().state.investments.map((entry) => {
      const list = valuations(entry.id).sort(
        (a, b) =>
          b.observed_at.localeCompare(a.observed_at) || b.version - a.version,
      );
      return {
        ...entry,
        latest: list[0]
          ? {
              ...list[0].content,
              id: list[0].id,
              observed_at: list[0].observed_at,
              version: list[0].version,
            }
          : null,
        history_count: new Set(list.map((p) => p.observed_at)).size,
      };
    });
  }
  function normalizeValuation(raw, code) {
    check(
      raw &&
        !Number.isNaN(Date.parse(raw.observed_at)) &&
        /(?:Z|[+-]\d\d:\d\d)$/.test(raw.observed_at) &&
        Date.parse(raw.observed_at) <= Date.now(),
      "INVALID_TIME",
      "请输入带时区且不在未来的估值时间。",
    );
    check(
      raw &&
        Object.keys(raw).every((k) =>
          [
            "observed_at",
            "market_value",
            "quantity",
            "price",
            "cost_basis",
            "reported_gain",
            "daily_gain",
            "reported_semantics",
            "supersedes",
            "evidence",
            "fees_taxes_known",
          ].includes(k),
        ),
      "INVALID_FIELDS",
      "估值包含未知字段。",
    );
    check(
      raw.fees_taxes_known === undefined ||
        typeof raw.fees_taxes_known === "boolean",
      "INVALID_FIELDS",
      "税费完整性必须明确。",
    );
    const v = {
      ...raw,
      observed_at: new Date(raw.observed_at).toISOString(),
      evidence: raw.evidence || { source: "DEMO_USER_VALUATION", mock: true },
      fees_taxes_known: Boolean(raw.fees_taxes_known),
      mock: true,
    };
    for (const k of [
      "market_value",
      "cost_basis",
      "reported_gain",
      "daily_gain",
    ])
      v[k] =
        raw[k] == null || raw[k] === ""
          ? null
          : format(minor(raw[k], code), code);
    for (const k of ["market_value", "cost_basis"])
      check(
        v[k] === null || minor(v[k], code) >= 0n,
        "INVALID_COST",
        "市值和成本不能为负。",
      );
    const hasQuantity = raw.quantity != null && raw.quantity !== "",
      hasPrice = raw.price != null && raw.price !== "";
    check(
      hasQuantity === hasPrice,
      "VALUATION_FIELDS",
      "数量和价格需同时提供，或直接提供市值。",
    );
    if (hasQuantity) {
      const value = product(raw.quantity, raw.price, code);
      check(
        v.market_value === null ||
          (minor(v.market_value, code) - value <= 1n &&
            value - minor(v.market_value, code) <= 1n),
        "VALUATION_MISMATCH",
        "数量乘价格与市值不一致。",
      );
      v.market_value = format(value, code);
    }
    check(
      v.market_value !== null || v.reported_gain !== null,
      "VALUATION_FIELDS",
      "请提供市值或明确的报告收益。",
    );
    v.reported_semantics =
      raw.reported_semantics ||
      (v.reported_gain !== null ? "CUMULATIVE" : null);
    check(
      [null, "CUMULATIVE", "UNREALIZED", "DAILY"].includes(
        v.reported_semantics,
      ),
      "PERFORMANCE_SEMANTICS",
      "请明确收益口径。",
    );
    check(
      v.evidence &&
        typeof v.evidence === "object" &&
        JSON.stringify(v.evidence).length < 40000,
      "EVIDENCE_LIMIT",
      "来源信息超限。",
    );
    return v;
  }
  function investmentPreview(resource, payload) {
    check(
      payload &&
        [
          "create",
          "valuation",
          "performance_event",
          "metadata",
          "archive",
        ].includes(payload.action),
      "INVALID_FIELDS",
      "投资操作字段无效。",
    );
    check(
      Object.keys(payload).every((k) =>
        ["action", "entry", "valuation", "event", "patch", "version"].includes(
          k,
        ),
      ),
      "INVALID_FIELDS",
      "投资操作字段无效。",
    );
    if (payload.action === "create") {
      check(
        database().state.investments.length < 200,
        "INVESTMENT_LIMIT",
        "投资条目最多200项。",
      );
      check(
        Object.keys(payload.entry || {}).every((k) =>
          [
            "name",
            "issuer",
            "currency",
            "asset_type",
            "account_ref",
            "history_complete",
            "mock",
          ].includes(k),
        ),
        "INVALID_FIELDS",
        "投资条目包含未知字段。",
      );
      check(
        payload.entry?.history_complete === undefined ||
          typeof payload.entry.history_complete === "boolean",
        "INVALID_FIELDS",
        "完整性必须为布尔值。",
      );
      check(
        resource === "new" &&
          payload.entry?.name &&
          precision[payload.entry.currency] !== undefined,
        "INVALID_FIELDS",
        "请填写投资名称和币种。",
      );
      return {
        action: "create",
        entry: {
          issuer: "User provided",
          asset_type: "fund",
          history_complete: false,
          ...payload.entry,
          mock: true,
        },
        valuation: payload.valuation
          ? normalizeValuation(payload.valuation, payload.entry.currency)
          : null,
      };
    }
    const entry = rows().find((r) => r.id === resource);
    check(
      entry && entry.version === payload.version,
      "PROPOSAL_STALE",
      "投资已变化，请重新打开。",
    );
    check(
      !entry.archived || payload.action === "metadata",
      "ARCHIVED_RESOURCE",
      "投资已归档，历史保留。",
    );
    const result = {
      action: payload.action,
      investment_id: resource,
      version: entry.version,
      previous: entry,
    };
    if (payload.action === "valuation") {
      const v = normalizeValuation(payload.valuation, entry.currency),
        table =
          v.market_value === null ? "performance_observations" : "valuations";
      const store = database();
      const prior = store[table]
        .filter(
          (p) =>
            p.investment_id === resource && p.observed_at === v.observed_at,
        )
        .sort((a, b) => b.version - a.version)[0];
      check(
        !prior || v.supersedes === prior.id,
        "OBSERVATION_CONFLICT",
        "同一观察时间已有记录，请明确修订版本。",
      );
      Object.assign(result, {
        valuation: v,
        table,
        point_version: prior ? prior.version + 1 : 1,
      });
    } else if (payload.action === "performance_event") {
      const e = payload.event;
      check(
        e &&
          [
            "buy",
            "sell",
            "distribution",
            "fee",
            "tax",
            "reinvestment",
          ].includes(e.type) &&
          !Number.isNaN(Date.parse(e.observed_at)) &&
          Date.parse(e.observed_at) <= Date.now(),
        "INVALID_FIELDS",
        "请补齐收益事件类型和时间。",
      );
      check(
        Object.keys(e).every((k) =>
          [
            "type",
            "amount",
            "observed_at",
            "cost_allocated",
            "cost_added",
            "fee",
            "tax",
            "capitalized",
            "included_in_net",
            "ledger_event_ref",
            "source_key",
            "evidence",
          ].includes(k),
        ),
        "INVALID_FIELDS",
        "收益事件字段无效。",
      );
      check(
        /(?:Z|[+-]\d\d:\d\d)$/.test(e.observed_at),
        "INVALID_TIME",
        "请输入带时区的估值时间。",
      );
      for (const k of [
        "capitalized",
        "included_in_net",
        "distribution_in_cost",
      ])
        check(
          e[k] === undefined || typeof e[k] === "boolean",
          "INVALID_FIELDS",
          "费用口径需明确。",
        );
      const event = {
        ...e,
        observed_at: new Date(e.observed_at).toISOString(),
        amount: format(minor(e.amount, entry.currency), entry.currency),
        mock: true,
      };
      check(
        minor(event.amount, entry.currency) > 0n,
        "INVALID_AMOUNT",
        "金额必须大于零。",
      );
      for (const k of ["cost_allocated", "cost_added", "fee", "tax"]) {
        event[k] =
          e[k] == null || e[k] === ""
            ? null
            : format(minor(e[k], entry.currency), entry.currency);
        check(
          event[k] === null || minor(event[k], entry.currency) >= 0n,
          "INVALID_COST",
          "成本及税费不能为负。",
        );
      }
      const key = e.source_key || e.ledger_event_ref;
      if (key)
        check(
          !database().performance_events.some(
            (x) => x.content.source_key === key,
          ),
          "DUPLICATE_SOURCE",
          "此收益来源已录入。",
        );
      if (e.ledger_event_ref) {
        const linked = activeEvents().find((x) => x.id === e.ledger_event_ref);
        check(
          linked &&
            linked.currency === entry.currency &&
            ["dividend", "investment_buy", "investment_sell"].includes(
              linked.kind,
            ) &&
            linked.amount === event.amount,
          "LEDGER_LINK",
          "现金事件金额或币种不匹配。",
        );
      }
      event.source_key = key;
      result.event = event;
    } else if (payload.action === "metadata") {
      check(
        payload.patch &&
          Object.keys(payload.patch).every((k) =>
            ["name", "issuer", "archived"].includes(k),
          ),
        "INVALID_FIELDS",
        "仅可修改名称、发行人和归档状态。",
      );
      result.patch = payload.patch;
    }
    return result;
  }
  function investmentApply(preview) {
    const db = database();
    let resource;
    if (preview.action === "create") {
      resource = id();
      db.state.investments.push({
        ...preview.entry,
        id: resource,
        version: 1,
        archived: false,
      });
      if (preview.valuation)
        db[
          preview.valuation.market_value === null
            ? "performance_observations"
            : "valuations"
        ].push({
          id: id(),
          investment_id: resource,
          observed_at: preview.valuation.observed_at,
          version: 1,
          content: preview.valuation,
        });
    } else {
      resource = preview.investment_id;
      const entry = db.state.investments.find((e) => e.id === resource);
      if (preview.action === "valuation")
        db[preview.table].push({
          id: id(),
          investment_id: resource,
          observed_at: preview.valuation.observed_at,
          content: preview.valuation,
          version: preview.point_version,
          supersedes: preview.valuation.supersedes || null,
        });
      else if (preview.action === "performance_event")
        db.performance_events.push({
          id: id(),
          investment_id: resource,
          observed_at: preview.event.observed_at,
          content: preview.event,
        });
      else if (preview.action === "metadata")
        Object.assign(entry, preview.patch);
      else entry.archived = true;
      entry.version++;
    }
    db.state.portfolio_version++;
    db.state.ledger_version++;
    return {
      resource_type: "investment",
      resource_id: resource,
      status: "APPLIED",
    };
  }
  function validatePosted(content) {
    const c = normalized(content);
    check(c.date <= day, "FUTURE_DATE", "未来记录只能保留草稿。");
    if (c.kind === "refund") {
      const original = activeEvents().find(
        (e) =>
          e.id === c.refund_of &&
          e.kind === "expense" &&
          e.account_id === c.account_id,
      );
      check(original, "REFUND_ORIGINAL", "请选择有效的原消费。");
      const refunded = database()
        .state.transactions.filter((e) => e.refund_of === original.id)
        .reduce(
          (sum, e) =>
            sum + minor(e.amount, e.currency) * BigInt(e.direction || "1"),
          0n,
        );
      check(
        refunded + minor(c.amount, c.currency) <=
          minor(original.amount, c.currency),
        "REFUND_LIMIT",
        "退款超出剩余可退金额。",
      );
      c.category = original.category;
    }
    return c;
  }
  function postDraft(draftId, duplicate_override) {
    const state = database().state,
      draft = state.drafts.find((d) => d.id === draftId);
    check(draft, "RESOURCE_NOT_FOUND", "待确认草稿不存在。");
    if (draft.evidence?.requires_ocr)
      check(state.consents.ocr, "CONSENT_REVOKED", "识别授权已撤回。");
    if (duplicate_override)
      draft.evidence = { ...draft.evidence, duplicate_override };
    const fields = validatePosted(draft.content),
      event = {
        ...fields,
        id: id(),
        direction: "1",
        reverses: null,
        evidence: draft.evidence,
        postings: postings(fields),
      };
    state.transactions.push(event);
    state.drafts = state.drafts.filter((d) => d.id !== draftId);
    state.ledger_version++;
    return event.id;
  }
  function reverse(resource) {
    const state = database().state,
      old = baseProposal("reverse_event", resource).original;
    const event = {
      ...copy(old),
      id: id(),
      direction: "-1",
      reverses: old.id,
      postings: old.postings.map(([key, amount]) => [
        key,
        format(-minor(amount, old.currency), old.currency),
      ]),
      evidence: { source: "DEMO_REVERSAL", mock: true },
    };
    state.transactions.push(event);
    state.ledger_version++;
    return event.id;
  }
  function correctionPreview(resource, payload) {
    const old = baseProposal("reverse_event", resource).original;
    check(
      [
        "expense",
        "income",
        "interest",
        "dividend",
        "investment_buy",
        "investment_sell",
      ].includes(old.kind),
      "CORRECTION_DEPENDENCY",
      "关联交易请使用专门处理流程。",
    );
    return {
      original: old,
      replacement: validatePosted(payload.content),
      event_id: resource,
      effect: "原子冲正并替代；原记录保留",
    };
  }
  function correction(resource, payload) {
    const p = correctionPreview(resource, payload),
      reversed = reverse(resource),
      event = {
        ...p.replacement,
        id: id(),
        mock: true,
        direction: "1",
        reverses: null,
        postings: postings(p.replacement),
        evidence: {
          source: "DEMO_CORRECTION",
          original_event: resource,
          mock: true,
        },
      };
    database().state.transactions.push(event);
    database().state.ledger_version++;
    return {
      resource_type: "transaction",
      resource_id: event.id,
      resource_version: 1,
      reverses: resource,
      reversal_id: reversed,
    };
  }
  function preview(purpose, resource, payload) {
    if (purpose === "investment_change")
      return investmentPreview(resource, payload);
    if (purpose === "correct_event")
      return correctionPreview(resource, payload);
    if (purpose === "confirm_draft_batch") {
      check(
        payload?.drafts?.length &&
          payload.drafts.length <= 20 &&
          new Set(payload.drafts.map((d) => d.id)).size ===
            payload.drafts.length,
        "BATCH_SELECTION",
        "请选择1至20条不同草稿。",
      );
      return {
        drafts: payload.drafts.map((x) => {
          const d = database().state.drafts.find(
            (d) => d.id === x.id && d.version === x.version,
          );
          check(d, "PROPOSAL_STALE", "选中草稿已变化。");
          return { id: d.id, version: d.version, content: d.content };
        }),
        ledger_version: database().state.ledger_version,
      };
    }
    if (purpose !== "command_apply") return undefined;
    const p = command(resource);
    check(
      ["READY", "DRAFT_CREATED"].includes(p.status),
      "COMMAND_NOT_READY",
      "请补齐并保存候选。",
    );
    const operations = p.operations
      .filter((o) => o.selected !== false)
      .map((op) => {
        const item = {
          op_id: op.op_id,
          kind: op.kind,
          resource_id: op.resource_id,
          fields: op.fields,
        };
        if (op.evidence?.requires_ocr)
          check(
            database().state.consents.ocr,
            "CONSENT_REVOKED",
            "识别授权已撤回。",
          );
        if (op.kind === "create_draft") {
          const d =
            op.draft_id &&
            database().state.drafts.find((d) => d.id === op.draft_id);
          check(
            !op.draft_id || d,
            "RESOURCE_NOT_FOUND",
            "草稿已确认或被移除。",
          );
          if (op.source_key)
            check(
              !database().state.transactions.some(
                (e) => e.evidence?.source_key === op.source_key,
              ),
              "DUPLICATE_SOURCE",
              "此凭证来源已确认。",
            );
          item.fields = validatePosted(d?.content || op.fields);
          if (d)
            Object.assign(item, { draft_id: d.id, draft_version: d.version });
        } else if (["update_record", "delete_record"].includes(op.kind)) {
          const target = targets("record").find(
            (t) => t.id === op.resource_id && t.version === op.resource_version,
          );
          check(target, "PROPOSAL_STALE", "记录已变化。");
          Object.assign(item, {
            resource_type: target.resource_type,
            resource_version: target.version,
            previous: target.content,
          });
          if (target.resource_type === "transaction")
            item.correction =
              op.kind === "update_record"
                ? correctionPreview(target.id, { content: op.fields })
                : baseProposal("reverse_event", target.id);
          else if (op.kind === "update_record")
            item.fields = normalized(op.fields);
        } else if (/_(budget|goal)$/.test(op.kind)) {
          const settings = copy(database().state.planning),
            key = op.kind.endsWith("budget") ? "budgets" : "goals",
            old = settings[key].find((x) => x.id === op.resource_id);
          check(
            op.kind.startsWith("create") ||
              old?.version === op.resource_version,
            "PROPOSAL_STALE",
            "预算或目标已变化。",
          );
          let merged = {
            ...old,
            ...op.fields,
            id: old?.id || `demo-planning-${resource}-${op.op_id}`,
            version: (old?.version || 0) + 1,
          };
          if (key === "goals") {
            merged.target ||= op.fields.amount;
            merged.saved ||= "0";
            check(merged.deadline, "INVALID_GOAL", "请填写目标期限。");
          }
          merged = Object.fromEntries(
            Object.entries(merged).filter(([k]) =>
              (key === "goals"
                ? ["id", "version", "name", "target", "saved", "deadline"]
                : ["id", "version", "category", "amount"]
              ).includes(k),
            ),
          );
          settings[key] = settings[key].filter((x) => x.id !== op.resource_id);
          if (!op.kind.startsWith("delete")) settings[key].push(merged);
          item.planning = validatePlan(settings);
          item.previous = old;
        } else if (op.kind === "create_account") {
          check(
            op.fields.name && precision[op.fields.currency] !== undefined,
            "INVALID_FIELDS",
            "请填写账户名称和币种。",
          );
          item.account_create = {
            name: op.fields.name,
            currency: op.fields.currency,
            type: op.fields.type || "cash",
            opening_balance: op.fields.amount || "0",
            opened_on: op.fields.opened_on || day,
          };
          check(
            item.account_create.opened_on <= day &&
              minor(
                item.account_create.opening_balance,
                item.account_create.currency,
              ) >= 0n,
            "INVALID_BALANCE",
            "期初余额/日期无效。",
          );
        } else if (op.kind.endsWith("account")) {
          const account = database().state.accounts.find(
            (a) => a.id === op.resource_id,
          );
          check(
            account && (account.version || 1) === op.resource_version,
            "PROPOSAL_STALE",
            "账户已变化。",
          );
          item.previous = account;
          item.name = op.fields.name || account.name;
        } else if (
          op.kind === "investment_observation" ||
          op.kind.endsWith("investment")
        ) {
          let payload;
          if (op.kind === "investment_observation") {
            const val = Object.fromEntries(
              Object.entries(op.fields).filter(([k]) =>
                [
                  "observed_at",
                  "market_value",
                  "cost_basis",
                  "reported_gain",
                  "daily_gain",
                  "reported_semantics",
                  "quantity",
                  "price",
                  "supersedes",
                ].includes(k),
              ),
            );
            val.evidence = op.evidence;
            payload =
              op.resource_id === "new"
                ? {
                    action: "create",
                    entry: {
                      name: op.fields.name,
                      currency: op.fields.currency,
                    },
                    valuation: val,
                  }
                : {
                    action: "valuation",
                    version: op.resource_version,
                    valuation: val,
                  };
          } else {
            const valuation = Object.fromEntries(
              Object.entries(op.fields).filter(([k]) =>
                [
                  "observed_at",
                  "market_value",
                  "cost_basis",
                  "reported_gain",
                  "daily_gain",
                  "reported_semantics",
                  "quantity",
                  "price",
                  "supersedes",
                  "fees_taxes_known",
                ].includes(k),
              ),
            );
            valuation.market_value ||= op.fields.amount || null;
            const hasValue = [
              "amount",
              "market_value",
              "reported_gain",
              "quantity",
            ].some((k) => op.fields[k] != null && op.fields[k] !== "");
            if (op.kind === "create_investment")
              payload = {
                action: "create",
                entry: { name: op.fields.name, currency: op.fields.currency },
                ...(hasValue ? { valuation } : {}),
              };
            else if (op.kind === "delete_investment")
              payload = { action: "archive", version: op.resource_version };
            else
              payload = hasValue
                ? {
                    action: "valuation",
                    version: op.resource_version,
                    valuation,
                  }
                : {
                    action: "metadata",
                    version: op.resource_version,
                    patch: { name: op.fields.name },
                  };
          }
          item.investment_change = investmentPreview(
            op.resource_id || "new",
            payload,
          );
        } else
          check(false, "COMMAND_UNSUPPORTED", "此任务请使用相应编辑器补齐。");
        return item;
      });
    return {
      command_id: resource,
      plan_version: p.version,
      operations,
      scope: "selected_local_records",
      ledger_version: database().state.ledger_version,
      settings_version: database().state.settings_version,
      portfolio_version: database().state.portfolio_version,
    };
  }
  async function dispatch(path, method, body, retryKey) {
    const parts = path.split("/"),
      db = database();
    if (
      (/commands\/[^/]+\/(drafts|apply)$/.test(path) ||
        path === "draft-batches/confirm" ||
        /transactions\/[^/]+\/corrections$/.test(path) ||
        path.startsWith("investments")) &&
      ["POST", "PATCH"].includes(method)
    )
      check(retryKey, "IDEMPOTENCY_REQUIRED", "请提供幂等键。");
    if (path === "commands/plan" && method === "POST")
      return { handled: true, result: plan(body) };
    if (parts[0] === "commands" && parts.length === 2) {
      const p = command(parts[1]);
      if (method === "GET") return { handled: true, result: p };
      if (method === "PATCH") {
        check(
          body &&
            Array.isArray(body.operations) &&
            Object.keys(body).every((k) =>
              ["version", "operations"].includes(k),
            ),
          "INVALID_FIELDS",
          "任务修改需版本和操作。",
        );
        check(
          p.version === body.version &&
            !["APPLIED", "DRAFT_CREATED", "CANCELLED"].includes(p.status),
          "PROPOSAL_STALE",
          "任务已变化或已提交。",
        );
        for (const change of body.operations) {
          check(
            change &&
              Object.keys(change).every((k) =>
                ["op_id", "fields", "selected", "resource_id"].includes(k),
              ),
            "INVALID_FIELDS",
            "候选字段无效。",
          );
          const o = p.operations.find((x) => x.op_id === change.op_id);
          check(o, "RESOURCE_NOT_FOUND", "候选不存在。");
          if (change.resource_id) {
            if (
              o.kind === "investment_observation" &&
              change.resource_id === "new"
            )
              Object.assign(o, { resource_id: "new", resource_version: 0 });
            else {
              const t = targets(p.object).find(
                (x) => x.id === change.resource_id,
              );
              check(
                t && o.targets.some((x) => x.id === t.id),
                "TARGET_INVALID",
                "请选择本次匹配的条目。",
              );
              if (o.kind === "investment_observation")
                Object.assign(o, {
                  resource_id: t.id,
                  resource_version: t.version,
                });
              else Object.assign(o, bind(o, t, p.amount));
            }
          }
          if (change.fields) {
            let allowed =
              o.kind === "create_draft" || o.kind.endsWith("record")
                ? eventFields
                : o.kind === "investment_observation"
                  ? [
                      "name",
                      "currency",
                      "observed_at",
                      "market_value",
                      "cost_basis",
                      "reported_gain",
                      "daily_gain",
                      "reported_semantics",
                      "quantity",
                      "price",
                      "supersedes",
                    ]
                  : [
                      "name",
                      "category",
                      "amount",
                      "target",
                      "saved",
                      "deadline",
                      "currency",
                      "type",
                      "opened_on",
                      "observed_at",
                    ];
            if (["update_account", "delete_account"].includes(o.kind))
              allowed = ["name"];
            if (o.kind.endsWith("investment"))
              allowed = [
                "name",
                "currency",
                "amount",
                "observed_at",
                "market_value",
                "cost_basis",
                "reported_gain",
                "daily_gain",
                "reported_semantics",
                "quantity",
                "price",
                "supersedes",
                "fees_taxes_known",
              ];
            check(
              typeof change.fields === "object" &&
                Object.keys(change.fields).every((k) => allowed.includes(k)),
              "INVALID_FIELDS",
              "候选包含未知字段。",
            );
            Object.assign(o.fields, change.fields);
          }
          if (change.selected !== undefined)
            check(
              typeof change.selected === "boolean",
              "INVALID_FIELDS",
              "选择状态无效。",
            );
          if (change.selected !== undefined) o.selected = change.selected;
        }
        p.version++;
        review(p);
        return { handled: true, result: p };
      }
    }
    if (parts[0] === "commands" && parts.length === 3 && method === "POST") {
      const p = command(parts[1]);
      if (parts[2] === "cancel") {
        check(
          Object.keys(body).length === 1 &&
            body.version === p.version &&
            !["APPLIED", "CANCELLED"].includes(p.status),
          "PROPOSAL_STALE",
          "任务已变化或已完成。",
        );
        p.status = "CANCELLED";
        p.version++;
        return { handled: true, result: p };
      }
      check(
        p.version === (body.plan_version || body.version),
        "PROPOSAL_STALE",
        "任务版本已变化。",
      );
      if (parts[2] === "drafts") {
        check(
          p.status === "READY" &&
            p.operations
              .filter((o) => o.selected !== false)
              .every((o) => o.kind === "create_draft"),
          "COMMAND_NOT_READY",
          "请补齐候选后保存交易草稿。",
        );
        p.results = p.operations
          .filter((o) => o.selected !== false)
          .map((o) => {
            const draft = o.draft_id
              ? database().state.drafts.find((d) => d.id === o.draft_id)
              : addDraft(
                  o.fields,
                  o.evidence || {
                    source: "DEMO_LOCAL_COMMAND",
                    source_span: o.source_span,
                    mock: true,
                  },
                );
            draft.evidence.source_key ||= o.source_key;
            o.draft_id = draft.id;
            return {
              op_id: o.op_id,
              resource_type: "draft",
              resource_id: draft.id,
              resource_version: 1,
            };
          });
        p.status = "DRAFT_CREATED";
      } else if (parts[2] === "apply") {
        const value = preview("command_apply", p.command_id);
        await consume(body, "command_apply", p.command_id);
        p.results = value.operations.map((item) => {
          let result;
          if (item.kind === "create_draft") {
            const op = p.operations.find((o) => o.op_id === item.op_id);
            const d =
              item.draft_id ||
              addDraft(item.fields, {
                ...(op.evidence || {
                  source: "DEMO_LOCAL_COMMAND",
                  source_span: op.source_span,
                  mock: true,
                }),
                ...(op.source_key ? { source_key: op.source_key } : {}),
              }).id;
            result = {
              resource_type: "transaction",
              resource_id: postDraft(d, duplicateResolution(body, item.op_id)),
              resource_version: 1,
            };
          } else if (
            item.kind === "update_record" &&
            item.resource_type === "transaction"
          )
            result = correction(item.resource_id, { content: item.fields });
          else if (
            item.kind === "delete_record" &&
            item.resource_type === "transaction"
          )
            result = {
              resource_type: "transaction",
              resource_id: reverse(item.resource_id),
              reverses: item.resource_id,
            };
          else if (["update_record", "delete_record"].includes(item.kind)) {
            const d = db.state.drafts.find((d) => d.id === item.resource_id);
            if (item.kind === "update_record") {
              d.content = normalized(item.fields);
              d.version++;
            } else
              db.state.drafts = db.state.drafts.filter((x) => x.id !== d.id);
            result = {
              resource_type: "draft",
              resource_id: item.resource_id,
              resource_version: item.resource_version + 1,
            };
          } else if (item.account_create) {
            const f = item.account_create,
              account = {
                id: id(),
                name: f.name,
                currency: f.currency,
                type: f.type,
                opened_on: f.opened_on,
                mock: true,
                version: 1,
                archived: false,
              };
            db.state.accounts.push(account);
            const amount = minor(f.opening_balance, f.currency);
            if (amount) {
              const signed = account.type === "cash" ? amount : -amount;
              db.state.transactions.push({
                id: id(),
                kind: "opening",
                date: f.opened_on,
                merchant: "Opening balance",
                category: "Opening balance",
                account_id: account.id,
                currency: f.currency,
                amount: format(amount, f.currency),
                direction: "1",
                mock: true,
                reverses: null,
                postings: [
                  [account.id, format(signed, f.currency)],
                  ["equity:opening", format(-signed, f.currency)],
                ],
              });
            }
            db.state.ledger_version++;
            result = { resource_type: "account", resource_id: account.id };
          } else if (item.planning) {
            db.state.planning = item.planning;
            db.state.settings_version++;
            result = {
              resource_type: item.kind.endsWith("budget") ? "budget" : "goal",
              resource_id:
                item.resource_id ||
                `demo-planning-${p.command_id}-${item.op_id}`,
            };
          } else if (item.investment_change)
            result = investmentApply(item.investment_change);
          else {
            const a = db.state.accounts.find((a) => a.id === item.resource_id);
            a.name = item.name;
            a.archived = item.kind === "delete_account" || a.archived;
            a.version = (a.version || 1) + 1;
            result = { resource_type: "account", resource_id: a.id };
          }
          return { ...result, op_id: item.op_id, status: "APPLIED" };
        });
        p.status = "APPLIED";
      } else return { handled: false };
      p.version++;
      return {
        handled: true,
        result: {
          command_id: p.command_id,
          status: p.status,
          results: p.results,
        },
      };
    }
    if (path === "draft-batches/confirm" && method === "POST") {
      const p = preview("confirm_draft_batch", "batch", body.payload);
      await consume(body, "confirm_draft_batch", "batch");
      return {
        handled: true,
        result: {
          status: "APPLIED",
          results: p.drafts.map((d) => ({
            resource_type: "transaction",
            resource_id: postDraft(d.id, duplicateResolution(body, d.id)),
          })),
        },
      };
    }
    if (
      parts[0] === "transactions" &&
      parts[2] === "corrections" &&
      method === "POST"
    ) {
      await consume(body, "correct_event", parts[1]);
      return { handled: true, result: correction(parts[1], body.payload) };
    }
    if (parts[0] === "investments") {
      if (path === "investments" && method === "GET")
        return { handled: true, result: rows() };
      if (parts[2] === "history" && method === "GET") {
        const entry = db.state.investments.find((e) => e.id === parts[1]);
        check(entry, "RESOURCE_NOT_FOUND", "投资条目不存在。");
        return {
          handled: true,
          result: {
            entry,
            valuations: valuations(entry.id),
            events: db.performance_events.filter(
              (p) => p.investment_id === entry.id,
            ),
            observations: db.performance_observations.filter(
              (p) => p.investment_id === entry.id,
            ),
          },
        };
      }
      if (parts[2] === "performance" && method === "GET") {
        check(
          db.state.consents.analysis,
          "CONSENT_REVOKED",
          "本地分析用途未授权。",
        );
        const e = db.state.investments.find((e) => e.id === parts[1]);
        check(e, "RESOURCE_NOT_FOUND", "投资条目不存在。");
        return {
          handled: true,
          result: investmentPerformance(
            e,
            valuations(e.id),
            db.performance_events.filter((p) => p.investment_id === e.id),
            db.performance_observations.filter((p) => p.investment_id === e.id),
          ),
        };
      }
      if (["POST", "PATCH"].includes(method)) {
        if (method === "PATCH")
          check(
            ["metadata", "archive"].includes(body.payload?.action),
            "INVALID_FIELDS",
            "修改条目只接受名称或归档。",
          );
        if (parts[2])
          check(
            body.payload?.action ===
              (parts[2] === "valuations" ? "valuation" : "performance_event"),
            "INVALID_FIELDS",
            "投资操作与接口不匹配。",
          );
        const resource = path === "investments" ? "new" : parts[1],
          p = investmentPreview(resource, body.payload);
        await consume(body, "investment_change", resource);
        return { handled: true, result: investmentApply(p) };
      }
    }
    if (path === "evidence-imports" && method === "POST") {
      check(db.state.consents.ocr, "CONSENT_REVOKED", "请先授权本地凭证识别。");
      check(
        !body.image_base64,
        "DEMO_OCR_PRESET_ONLY",
        "演示不识别任意图片；请选择模拟样例或粘贴支持的凭证文本。",
      );
      const raw = body.text || "",
        type = body.doc_type;
      check(
        ["receipt", "bank", "investment"].includes(type) &&
          raw.length &&
          raw.length <= 20000,
        "DOCUMENT_TYPE",
        "请选择类型并填入凭证文本。",
      );
      const sha = await crypto.subtle
        .digest("SHA-256", new globalThis.TextEncoder().encode(raw))
        .then((buffer) =>
          [...new Uint8Array(buffer)]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(""),
        );
      const p = plan({ text: "Evidence preview", period: body.period });
      p.intent = "import_evidence";
      p.object = type === "investment" ? "investment" : "record";
      const evidence = {
        source: "DEMO_SIMULATED_EXTRACTION",
        raw_text: raw,
        sha256: sha,
        word_boxes: [],
        quality: "DEMO_PRESET",
        requires_ocr: true,
        mock: true,
      };
      const code =
          raw.match(/\b(AUD|CNY|USD|EUR|GBP|JPY)\b/i)?.[1].toUpperCase() ||
          body.currency ||
          null,
        date = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null;
      if (type === "investment") {
        const field = (re) => raw.match(re)?.[1] || null;
        const fields = {
          name: field(/(?:基金名称|fund name)\s*[:：]\s*([^\n]+)/i),
          currency: code,
          observed_at: date ? `${date}T00:00:00.000Z` : null,
          market_value: field(
            /(?:市值|market value)\s*[:：]?\s*([+-]?\d+(?:\.\d+)?)/i,
          ),
          cost_basis: field(/(?:成本|cost basis)\s*[:：]?\s*(\d+(?:\.\d+)?)/i),
          reported_gain: field(
            /(?:累计收益|cumulative gain)\s*[:：]?\s*([+-]?\d+(?:\.\d+)?)/i,
          ),
          daily_gain: field(
            /(?:今日收益|daily gain)\s*[:：]?\s*([+-]?\d+(?:\.\d+)?)/i,
          ),
          reported_semantics: "CUMULATIVE",
        };
        const matches = rows().filter((e) => e.name === fields.name);
        p.operations = [
          {
            op_id: "o1",
            kind: "investment_observation",
            selected: true,
            fields,
            source_span: raw,
            evidence,
            resource_type: "investment",
            resource_id: matches.length === 1 ? matches[0].id : null,
            resource_version: matches[0]?.version,
            targets: [
              ...matches.map((e) => ({ id: e.id, label: e.name })),
              { id: "new", label: "New local investment" },
            ],
          },
        ];
      } else {
        const lines =
          type === "bank"
            ? raw.split("\n").filter((l) => /\d{4}-\d{2}-\d{2}/.test(l))
            : [raw];
        p.operations = lines.map((line, i) => {
          const transfer = /转账|transfer/i.test(line),
            income = /工资|收入|salary|income/i.test(line),
            amount =
              line.match(
                /(?:总计|合计|total|收入|支出|转账|income|expense|transfer)\s*[:：]?\s*([+-]?\d+(?:\.\d+)?)/i,
              )?.[1] || null,
            rowDate = line.match(/\d{4}-\d{2}-\d{2}/)?.[0] || date,
            rowCode =
              line.match(/\b(AUD|CNY|USD|EUR|GBP|JPY)\b/i)?.[1].toUpperCase() ||
              code,
            account = db.state.accounts.find(
              (a) => a.id === body.account_id && a.currency === rowCode,
            );
          return {
            op_id: `o${i + 1}`,
            kind: "create_draft",
            selected: true,
            resource_type: "candidate",
            source_span: line,
            source_key: `evidence:${sha}:${i}`,
            evidence: { ...evidence, row_number: i + 1 },
            fields: {
              kind: transfer ? "transfer" : income ? "income" : "expense",
              amount,
              currency: rowCode,
              date: rowDate,
              merchant:
                type === "receipt"
                  ? line.split("\n")[0]
                  : transfer
                    ? "Transfer"
                    : income
                      ? "Salary"
                      : "Coffee",
              category: income
                ? "Income"
                : /咖啡|coffee/i.test(line)
                  ? "Dining"
                  : "Groceries",
              account_id: account?.id || null,
              counterparty_id: null,
              refund_of: null,
              external_id: null,
              mock: true,
            },
          };
        });
      }
      p.evidence = evidence;
      p.batch_id = id();
      review(p);
      for (const o of p.operations) {
        if (o.source_key) {
          const draft = db.state.drafts.find(
            (d) => d.evidence.source_key === o.source_key,
          );
          if (draft) o.draft_id = draft.id;
          if (
            db.state.transactions.some(
              (e) => e.evidence?.source_key === o.source_key,
            )
          ) {
            o.errors.push("DUPLICATE_SOURCE");
            p.questions.push({ op_id: o.op_id, fields: ["DUPLICATE_SOURCE"] });
            p.status = "NEEDS_CLARIFICATION";
          }
        }
        if (o.errors.length) o.selected = false;
      }
      review(p);
      p.version++;
      db.import_batches[p.batch_id] = {
        command_id: p.command_id,
        doc_type: type,
      };
      return { handled: true, result: p };
    }
    if (parts[0] === "import-batches" && method === "GET") {
      const b = db.import_batches[parts[1]];
      check(b, "RESOURCE_NOT_FOUND", "导入批次不存在。");
      return {
        handled: true,
        result: { batch_id: parts[1], command: command(b.command_id) },
      };
    }
    return { handled: false };
  }
  return { dispatch, preview, rows, initialize: database };
}
