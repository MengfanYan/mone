"use client";
import {
  readWorkspaceLocation,
  workspaceSearch,
} from "@/lib/workspace-location.mjs";
import MonthField from "./month-field";
import DuplicateReview from "./duplicate-review";
import { duplicateReviewComplete } from "@/lib/duplicates.mjs";
import AnalysisQuery from "./analysis-query";
import CloudAuth from "./cloud-auth";
import CloudAccount from "./cloud-account";
import NotificationCenter from "./notification-center";
import EvidenceQuality from "./evidence-quality";
import RefundLinkProposal from "./refund-link-proposal";
import AdvisorInsights from "./advisor-insights";
import FinancialSandbox from "./financial-sandbox";
import FloatingAgent from "./terminal/floating-agent";

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Settings,
  Download,
  FileText,
  Home,
  Landmark,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { LanguageSwitch, useLocale } from "@/components/locale-provider";
import { readLocale, translate } from "@/lib/i18n";
import {
  TerminalHeader,
  TerminalMetrics,
  DashboardPulse,
  AllocationPanel,
  PlanningSimulator,
} from "@/components/terminal/workbench";
import {
  SecurityVault,
  TerminalSettings,
} from "@/components/terminal/settings";
import { useScreenPrivacy, MaskedPanel } from "@/components/terminal/context";
import { encryptBackup } from "@/lib/terminal/vault.mjs";
import PortfolioRiskLab from "@/components/terminal/risk-lab";
import Overview from "@/components/overview";
import { emptyCommandContext } from "@/components/command-composer";
import RecordEditor, {
  EditorDrawer,
  ModalDialog,
} from "@/components/record-editor";
import InvestmentView from "@/components/investment-view";
import { pageInsight } from "@/lib/page-insights.mjs";
import LedgerRecords from "@/components/ledger-records";
import PageSummary from "@/components/page-summary";
import {
  BudgetComparison,
  CategoryExpenses,
  CashBridge,
  MonthComparison,
  GoalProgress,
} from "@/components/relationships";
import { localDay } from "@/lib/commands/parser.mjs";
import StatementPreview from "@/components/statement-preview";
import { preparePdfRuntime } from "@/lib/statements/runtime.mjs";
import { Money, Metric } from "@/components/financial-values";
import {
  createDemoClient,
  DEMO_DATE,
  DEMO_PERIOD,
  DEMO_RECEIPT,
  DEMO_CSV,
} from "@/lib/demo/client.mjs";
const t = (key, variables) => translate(key, readLocale(), variables);
const currencies = [
  "AUD",
  "CNY",
  "USD",
  "EUR",
  "GBP",
  "NZD",
  "JPY",
  "KWD",
  "HKD",
  "SGD",
  "CAD",
  "KRW",
  "BHD",
];
const baseKinds = {
  expense: "日常支出",
  income: "工资/其他收入",
  transfer: "内部转账",
  card_payment: "信用卡还款本金",
  loan_received: "借款本金到账",
  debt_principal: "债务本金偿还",
  interest: "利息/费用",
  dividend: "分红收入",
  investment_buy: "投资买入本金",
  investment_sell: "投资卖出本金",
  refund: "关联退款",
  opening: "期初余额",
};
const baseTabs = [
  {
    id: "overview",
    label: "财务概览",
    icon: Home,
  },
  {
    id: "ledger",
    label: "账本与导入",
    icon: Wallet,
  },
  {
    id: "planning",
    label: "预算与目标",
    icon: Landmark,
  },
  {
    id: "portfolio",
    label: "投资记录",
    icon: TrendingUp,
  },
  {
    id: "reports",
    label: "月度账单",
    icon: FileText,
  },
  {
    id: "assistant",
    label: "分析助手",
    icon: Sparkles,
  },
  {
    id: "privacy",
    label: "隐私与授权",
    icon: ShieldCheck,
  },
  { id: "settings", label: "系统设置", icon: Settings },
];
const baseStatuses = {
  student: "在学",
  employed: "在职",
  unemployed: "失业",
  planning_family: "家庭规划",
  parent: "育儿",
};
const baseLabels = {
  currency: "币种",
  monthly_income: "稳定月收入",
  essential_spend: "月必要支出",
  debt_payment: "月必须偿债",
  earmarked: "已圈定资金",
  timezone: "时区",
  amount: "金额",
  date: "发生日",
  merchant: "商户/描述",
  category: "类别",
  kind: "类型",
  account_id: "账户",
  counterparty_id: "对方账户",
  refund_of: "原消费",
  mock: "演示数据",
  analysis: "本地分析",
  ocr: "本地凭证识别",
  scope: "范围",
  effect: "影响",
};
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const newEvent = (locale = "en", date = today()) => ({
  amount: "",
  currency: "AUD",
  date,
  merchant: "",
  category: locale === "zh" ? "食品" : "Groceries",
  kind: "expense",
  account_id: "",
  counterparty_id: null,
  refund_of: null,
  external_id: null,
  mock: false,
});
const emptyPlan = {
  currency: "AUD",
  monthly_income: "",
  essential_spend: "",
  debt_payment: "",
  earmarked: "",
  budgets: [],
  goals: [],
  life_status: [],
  timezone: "Australia/Sydney",
};
async function liveApi(path, method = "GET", body, idempotencyKey) {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": readLocale(),
      ...(idempotencyKey && {
        "Idempotency-Key": idempotencyKey,
      }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error?.message || t("操作未完成。"));
    error.code = result.error?.code;
    throw error;
  }
  return result.data;
}
function download(name, content, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(
    new Blob([content], {
      type,
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Field({ label, children, ...props }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children ? (
        cloneElement(children, {
          id,
        })
      ) : (
        <input id={id} {...props} />
      )}
    </div>
  );
}
function Currency({ value, onChange, ...props }) {
  return (
    <select
      {...props}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {currencies.map((c) => (
        <option key={c}>{c}</option>
      ))}
    </select>
  );
}
function Empty({ title, text, children }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Wallet size={28} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
function PreviewRows({ value, accountsById = {} }) {
  const { t } = useLocale();
  const kinds = Object.fromEntries(
    Object.entries(baseKinds).map(([key, value]) => [key, t(value)]),
  );
  const labels = Object.fromEntries(
    Object.entries(baseLabels).map(([key, value]) => [key, t(value)]),
  );
  const statuses = Object.fromEntries(
    Object.entries(baseStatuses).map(([key, value]) => [key, t(value)]),
  );
  return (
    <dl className="preview-rows">
      {Object.entries(value)
        .filter(([key, v]) => labels[key] && v !== null)
        .map(([key, v]) => (
          <div key={key}>
            <dt>{labels[key]}</dt>
            <dd>
              {key === "kind"
                ? kinds[v]
                : key.endsWith("account_id")
                  ? accountsById[v]?.name || v
                  : typeof v === "boolean"
                    ? v
                      ? t("是")
                      : t("否")
                    : key === "effect"
                      ? t(String(v))
                      : String(v)}
            </dd>
          </div>
        ))}
      {value.budgets?.map((b, i) => (
        <div key={`b${i}`}>
          <dt>
            {t("预算 ·")} {b.category}
          </dt>
          <dd>
            {b.amount} {value.currency}
          </dd>
        </div>
      ))}
      {value.goals?.map((g, i) => (
        <div key={`g${i}`}>
          <dt>
            {t("目标 ·")} {g.name}
          </dt>
          <dd>
            {g.saved} / {g.target} {value.currency} · {g.deadline}
          </dd>
        </div>
      ))}
      {value.life_status && (
        <div>
          <dt>{t("自报生活状态")}</dt>
          <dd>
            {value.life_status.map((s) => statuses[s]).join("、") ||
              t("未提供")}
          </dd>
        </div>
      )}
    </dl>
  );
}
export default function Workspace({
  initialTab = "overview",
  demo = false,
  cloud = false,
}) {
  const [transport] = useState(() =>
    demo
      ? createDemoClient({
          translate: (text) => translate(text, readLocale()),
          locale: readLocale,
        })
      : liveApi,
  );
  const { locale, t, dateLocale } = useLocale();
  const { masked } = useScreenPrivacy();
  const [agentOpen, setAgentOpen] = useState(false);
  const notificationAnchor = useRef(false);
  const notificationSequence = useRef(0);
  const backupPassword = useRef("");
  const kinds = Object.fromEntries(
    Object.entries(baseKinds).map(([key, value]) => [key, t(value)]),
  );
  const labels = Object.fromEntries(
    Object.entries(baseLabels).map(([key, value]) => [key, t(value)]),
  );
  const statuses = Object.fromEntries(
    Object.entries(baseStatuses).map(([key, value]) => [key, t(value)]),
  );
  const tabs = baseTabs.map((item) => ({
    ...item,
    label: t(item.label),
  }));
  const [session, setSession] = useState("loading");
  const [code, setCode] = useState("");
  const [state, setState] = useState(null);
  const [tab, setTab] = useState(initialTab);
  const [period, setPeriod] = useState(
    demo ? DEMO_PERIOD : today().slice(0, 7),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [account, setAccount] = useState({
    name: "",
    type: "cash",
    currency: "AUD",
    opening_balance: "0",
    opened_on: demo ? DEMO_DATE : today(),
  });
  const [entry, setEntry] = useState(() =>
    newEvent(locale, demo ? DEMO_DATE : today()),
  );
  const [editing, setEditing] = useState(null);
  const [importMode, setImportMode] = useState("manual");
  const [csv, setCsv] = useState("");
  const [csvMock, setCsvMock] = useState(false);
  const [receiptText, setReceiptText] = useState("");
  const [receiptFields, setReceiptFields] = useState({});
  const [receiptImage, setReceiptImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [plan, setPlan] = useState(emptyPlan);
  const [question, setQuestion] = useState(
    demo ? t("分析本月收支和现金风险") : "",
  );
  const [answer, setAnswer] = useState(null);
  const [report, setReport] = useState(null);
  const [reauth, setReauth] = useState("");
  const [filter, setFilter] = useState("");
  const [commandContext, setCommandContext] = useState(emptyCommandContext);
  const [editorOpen, setEditorOpen] = useState(false);
  const [planningOpen, setPlanningOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [ledgerView, setLedgerView] = useState("all");
  const [currencyChoice, setCurrencyChoice] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [portfolioTrigger, setPortfolioTrigger] = useState(0);
  const [ledgerScope, setLedgerScope] = useState({});
  const [portfolioTarget, setPortfolioTarget] = useState(null);
  const [selectedDrafts, setSelectedDrafts] = useState([]);
  const firstState = useRef(true);
  const [locationReady, setLocationReady] = useState(false);
  const privateEpoch = useRef(0);
  const analysisSequence = useRef(0);
  const selectedCurrency =
    currencyChoice ||
    state?.planning.currency ||
    state?.accounts[0]?.currency ||
    "AUD";
  const displayAnswer =
    state?.consents.analysis &&
    answer &&
    (answer.scope?.ledger_version == null ||
      (answer.scope.ledger_version === state.ledger_version &&
        answer.scope.settings_version === state.settings_version)) &&
    answer.period === period &&
    answer.scope?.currency === selectedCurrency
      ? answer
      : null;
  async function analyze(text) {
    const epoch = privateEpoch.current,
      sequence = ++analysisSequence.current;
    const value = await api("analyses", "POST", {
      text,
      period,
      currency: selectedCurrency,
    });
    if (epoch !== privateEpoch.current || sequence !== analysisSequence.current)
      return null;
    setAnswer(value);
    return value;
  }
  const currentInsight = state
    ? pageInsight(state, tab, selectedCurrency)
    : null;
  function saveLocation(next = {}, replace = false) {
    const search = workspaceSearch({
      tab,
      period,
      currency: selectedCurrency,
      ...next,
    });
    const url = window.location.pathname + search;
    if (window.location.pathname + window.location.search !== url)
      window.history[replace ? "replaceState" : "pushState"](null, "", url);
  }
  useEffect(() => {
    if (!locationReady) return;
    const search = workspaceSearch({ tab, period, currency: selectedCurrency });
    if (window.location.search !== search)
      window.history.replaceState(null, "", window.location.pathname + search);
  }, [locationReady, tab, period, selectedCurrency]);
  useEffect(() => {
    const restore = () => {
      const location = readWorkspaceLocation(window.location.search);
      analysisSequence.current++;
      setTab(location.tab || initialTab);
      setPeriod(location.period || (demo ? DEMO_PERIOD : today().slice(0, 7)));
      setCurrencyChoice(location.currency || "");
      setMessage(null);
      setMoreOpen(false);
      setEditorOpen(false);
      setPlanningOpen(false);
      setConfirmation(null);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [demo, initialTab]);
  function navigate(id) {
    saveLocation({ tab: id });
    window.scrollTo({ top: 0, behavior: "instant" });
    setTab(id);
    setMessage((old) => (old?.error ? null : old));
    setMoreOpen(false);
  }
  function drill(scope) {
    if (!scope) return;
    if (scope.tab === "assistant") {
      const basis = document.querySelector(".analysis-method");
      if (basis) {
        basis.open = true;
        basis.querySelector("summary")?.focus();
        basis.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    if (scope.currency) setCurrencyChoice(scope.currency);
    if (scope.period) setPeriod(scope.period);
    if (scope.tab === "ledger") {
      setFilter(scope.category || "");
      setLedgerScope({
        ...scope,
        effective: Boolean(scope.category || scope.from),
        returnTab: tab,
      });
    }
    navigate(scope.tab || tab);
  }
  function openTask({ mode = "command", text = "" } = {}) {
    setCommandContext((old) => ({ ...old, mode, text, error: "" }));
    setAgentOpen(true);
  }
  function advisorySource(target) {
    setAgentOpen(false);
    return work(async () => {
      const loaded = await load(target.period || period);
      if (loaded)
        openNotificationTarget({ ...target, period: target.period || period });
    });
  }
  async function advisoryProposal(kind, payload, versions) {
    if (editorOpen || confirmation)
      throw new Error("Finish the open review first");
    const fresh = await load(period);
    if (
      !fresh ||
      !fresh.consents.analysis ||
      fresh.ledger_version !== versions.ledger_version ||
      fresh.settings_version !== versions.settings_version
    )
      throw new Error("Snapshot changed; review refreshed figures");
    if (kind === "planning")
      await preview("planning", "planning", "planning", "PUT", payload);
    else {
      setEditing(null);
      setEntry({ ...newEvent(locale, payload.date), ...payload });
      setEditorOpen(true);
    }
    setAgentOpen(false);
  }
  function openManual() {
    if (editorOpen) {
      notify(t("请先保存或取消当前编辑。"), true);
      return;
    }
    setEditing(null);
    setEntry((old) => ({
      ...newEvent(locale, demo ? DEMO_DATE : localDay(state.planning.timezone)),
      account_id: old.account_id,
      currency: old.currency,
    }));
    setEditorOpen(true);
  }
  function openResource(resource, viewOnly = false) {
    const type = resource.resource_type,
      id = resource.resource_id || resource.id;
    if (
      ["investment", "planning", "budget", "goal", "account"].includes(type)
    ) {
      if (type === "investment") {
        const item = state.investments.find((x) => x.id === id);
        if (item) {
          setCurrencyChoice(item.currency);
          if (!viewOnly) setPortfolioTarget({ id, key: crypto.randomUUID() });
        }
      }
      navigate(
        type === "investment"
          ? "portfolio"
          : type === "account"
            ? "overview"
            : "planning",
      );
      if (type !== "investment" && type !== "account" && !viewOnly)
        setPlanningOpen(true);
      return;
    }
    const draft = state.drafts.find((x) => x.id === id),
      event = state.transactions.find((x) => x.id === id);
    const value = draft?.content || event;
    if (
      !value ||
      (!draft &&
        (event.reverses || state.transactions.some((x) => x.reverses === id)))
    ) {
      notify(t("此记录已确认、冲正或移除，请查看保留的历史。"), true);
      navigate("ledger");
      return;
    }
    navigate("ledger");
    if (value.currency) setCurrencyChoice(value.currency);
    if (value.date) setPeriod(value.date.slice(0, 7));
    setLedgerScope({ resource_id: id });
    if (!viewOnly) {
      if (editorOpen) {
        notify(t("请先保存或取消当前编辑。"), true);
        return;
      }
      setEntry(
        Object.fromEntries(
          Object.entries(value).filter(([key]) =>
            [
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
            ].includes(key),
          ),
        ),
      );
      setEditing({
        id,
        version: draft?.version || 1,
        resource_type: draft ? "draft" : "transaction",
        source:
          draft?.evidence?.raw_text ||
          draft?.evidence?.text ||
          event?.evidence?.source_span,
      });
      setEditorOpen(true);
    }
  }
  function openImport(mode = "csv") {
    navigate("ledger");
    setImportMode(mode);
    setToolsOpen(true);
  }
  function primaryAction() {
    if (tab === "settings")
      document.querySelector(".terminal-settings-grid input")?.focus();
    else if (tab === "planning") setPlanningOpen(true);
    else if (tab === "portfolio") setPortfolioTrigger((x) => x + 1);
    else if (tab === "reports")
      work(async () => {
        const result = await api("statements", "POST", { period });
        setReport(await api(`statements/${result.id}`));
        await load();
      });
    else if (tab === "privacy")
      document
        .querySelector(".privacy-row")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    else {
      setAgentOpen(true);
      document.getElementById("local-command-input")?.focus();
    }
  }
  const primaryLabels = {
    overview: "说一句 / 上传",
    ledger: "记录收支",
    planning: "调整预算与目标",
    portfolio: "新增本地投资",
    reports: "生成月报",
    assistant: "输入本地任务",
    privacy: "管理授权",
    settings: "配置工作台",
  };
  const notify = (text, error = false) =>
    setMessage({
      text,
      error,
    });
  const clearPrivateViews = useCallback(() => {
    backupPassword.current = "";
    notificationAnchor.current = false;
    notificationSequence.current++;
    privateEpoch.current += 1;
    setCommandContext(emptyCommandContext());
    setAgentOpen(false);
    setPortfolioTarget(null);
    setEditorOpen(false);
    setPlanningOpen(false);
    setAccountOpen(false);
    setConfirmation(null);
    setMoreOpen(false);
    setToolsOpen(false);
    setSelectedDrafts([]);
    setState(null);
    setAnswer(null);
    setReport(null);
    setEditing(null);
    setQuestion("");
    setFilter("");
    setCode("");
    setReauth("");
    setPlan(emptyPlan);
    setEntry(newEvent("en", demo ? DEMO_DATE : today()));
    setAccount({
      name: "",
      type: "cash",
      currency: "AUD",
      opening_balance: "0",
      opened_on: demo ? DEMO_DATE : today(),
    });
    setCsv("");
    setReceiptText("");
    setReceiptFields({});
    setReceiptImage(null);
    setImagePreview(null);
    setSession("locked");
  }, [
    demo,
    setCommandContext,
    setPortfolioTarget,
    setEditorOpen,
    setPlanningOpen,
    setAccountOpen,
    setConfirmation,
    setMoreOpen,
    setToolsOpen,
    setSelectedDrafts,
    setState,
    setAnswer,
    setReport,
    setEditing,
    setQuestion,
    setFilter,
    setCode,
    setReauth,
    setPlan,
    setEntry,
    setAccount,
    setCsv,
    setReceiptText,
    setReceiptFields,
    setReceiptImage,
    setImagePreview,
    setSession,
  ]);
  const api = useCallback(
    async (...args) => {
      const requestEpoch = privateEpoch.current;
      try {
        return await transport(...args);
      } catch (error) {
        if (
          requestEpoch === privateEpoch.current &&
          [
            "UNAUTHENTICATED",
            "ACCOUNT_DISABLED",
            "WORKSPACE_FORBIDDEN",
            "MFA_REQUIRED",
            "REAUTH_REQUIRED",
          ].includes(error.code)
        )
          clearPrivateViews();
        if (
          requestEpoch === privateEpoch.current &&
          ["CONSENT_REVOKED", "CONSENT_REQUIRED"].includes(error.code) &&
          /^(notifications|analyses|statements|terminal\/(search|documents|model-))/.test(
            args[0],
          )
        ) {
          analysisSequence.current++;
          setAnswer(null);
          setReport(null);
          setCommandContext((old) => ({ ...old, analysis: null }));
          setState((old) =>
            old
              ? {
                  ...old,
                  consents: { ...old.consents, analysis: false },
                  summary: [],
                  portfolio: [],
                  money_flow: [],
                  risk: null,
                  daily: { ...old.daily, summary: null },
                }
              : old,
          );
        }
        throw error;
      }
    },
    [
      transport,
      clearPrivateViews,
      setAnswer,
      setReport,
      setCommandContext,
      setState,
    ],
  );
  async function refreshNotifications() {
    const epoch = privateEpoch.current;
    const sequence = ++notificationSequence.current;
    // Refresh one coherent snapshot so alerts never disagree with the KPI cards.
    const result = await api(`state?period=${period}`);
    if (
      epoch !== privateEpoch.current ||
      sequence !== notificationSequence.current
    )
      return;
    if (!result.consents.analysis) {
      analysisSequence.current++;
      setAnswer(null);
      setReport(null);
      setCommandContext((old) => ({ ...old, analysis: null }));
    }
    setState((old) => (old && old.period === result.period ? result : old));
    return result.notifications;
  }
  async function readNotifications(ids) {
    notificationSequence.current++;
    await api("notifications/read", "POST", { period, ids });
    await refreshNotifications();
  }
  function openNotificationTarget(target) {
    if (target.tab === "portfolio") {
      setCurrencyChoice(target.currency);
      setPortfolioTarget({
        id: target.resource_id,
        key: crypto.randomUUID(),
        viewOnly: true,
      });
      navigate("portfolio");
    } else {
      setLedgerView("confirmed");
      drill({
        ...target,
        budget_only: Boolean(target.category),
        focus_only: Boolean(target.resource_id),
        origin: "notification",
      });
    }
  }
  useEffect(() => {
    if (tab !== "overview" || masked || session !== "authenticated") return;
    if (notificationAnchor.current) {
      notificationAnchor.current = false;
      const element = document.getElementById("workspace-notifications");
      element?.focus();
      element?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, [tab, masked, session, state]);
  useEffect(() => {
    if (
      demo ||
      masked ||
      tab !== "overview" ||
      session !== "authenticated" ||
      !state?.consents.analysis
    )
      return;
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const epoch = privateEpoch.current,
        sequence = ++notificationSequence.current;
      api(`state?period=${period}`)
        .then((result) => {
          if (
            active &&
            epoch === privateEpoch.current &&
            sequence === notificationSequence.current
          ) {
            if (!result.consents.analysis) {
              analysisSequence.current++;
              setAnswer(null);
              setReport(null);
              setCommandContext((old) => ({ ...old, analysis: null }));
            }
            setState((old) =>
              old && old.period === result.period ? result : old,
            );
          }
        })
        .catch(() => {});
    };
    const timer = window.setInterval(refresh, 45000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [
    demo,
    masked,
    tab,
    session,
    state?.consents.analysis,
    api,
    period,
    setState,
    setAnswer,
    setReport,
    setCommandContext,
  ]);
  async function load(selectedPeriod = period) {
    const epoch = privateEpoch.current;
    const location = readWorkspaceLocation(window.location.search);
    const result = await api(
      firstState.current && location.period
        ? `state?period=${location.period}`
        : !demo && firstState.current
          ? "state"
          : `state?period=${selectedPeriod}`,
    );
    if (epoch !== privateEpoch.current) return;
    if (firstState.current) {
      firstState.current = false;
      setPeriod(result.period);
      if (location.tab) setTab(location.tab);
      if (location.currency) setCurrencyChoice(location.currency);
      setLocationReady(true);
    }
    setState(result);
    if (!planningOpen) setPlan({ ...emptyPlan, ...result.planning });
    setSession("authenticated");
    setEntry((old) => {
      const selected =
        result.accounts.find((a) => a.id === old.account_id) ||
        result.accounts[0];
      return selected
        ? {
            ...old,
            account_id: selected.id,
            currency: selected.currency,
          }
        : old;
    });
    return result;
  }
  useEffect(() => {
    let active = true;
    const epoch = privateEpoch.current;
    const location = readWorkspaceLocation(window.location.search);
    api(
      firstState.current && location.period
        ? `state?period=${location.period}`
        : !demo && firstState.current
          ? "state"
          : `state?period=${period}`,
    )
      .then(async (result) => {
        if (demo)
          await preparePdfRuntime().catch(() => {
            if (active)
              setMessage({
                text: "PDF未能加载，请重试。已保存的账单仍然保留。",
                error: true,
              });
          });
        return result;
      })
      .then((result) => {
        if (!active || epoch !== privateEpoch.current) return;
        if (firstState.current) {
          firstState.current = false;
          setPeriod(result.period);
          if (location.currency) setCurrencyChoice(location.currency);
          setLocationReady(true);
        }
        setState(result);
        setPlan({
          ...emptyPlan,
          ...result.planning,
        });
        setSession("authenticated");
        const query = new URLSearchParams(window.location.search);
        const linked = query.get("draft_id");
        if (linked && query.get("edit") === "1") {
          const d = result.drafts.find((x) => x.id === linked);
          setTab("ledger");
          if (d) {
            setEntry(d.content);
            setEditing({
              id: d.id,
              version: d.version,
              resource_type: "draft",
              source: d.evidence.raw_text || d.evidence.text,
            });
            setEditorOpen(true);
          } else
            setMessage({
              text: "定位的草稿已确认或被移除，请查看账本历史。",
              error: true,
            });
          window.history.replaceState(
            null,
            "",
            window.location.pathname + "?tab=ledger",
          );
        } else if (
          query.get("tab") &&
          baseTabs.some((x) => x.id === query.get("tab"))
        )
          setTab(query.get("tab"));
        setEntry((old) => {
          const selected =
            result.accounts.find((a) => a.id === old.account_id) ||
            result.accounts[0];
          return selected
            ? {
                ...old,
                account_id: selected.id,
                currency: selected.currency,
              }
            : old;
        });
      })
      .catch((error) => {
        if (active && epoch === privateEpoch.current) {
          clearPrivateViews();
          if (error.code !== "UNAUTHENTICATED")
            setMessage({
              text: error.message,
              error: true,
            });
        }
      });
    return () => {
      active = false;
    };
  }, [period, api, demo, clearPrivateViews]);
  useEffect(() => {
    if (!state) return;
    let active = true;
    if (
      demo &&
      state.consents.analysis &&
      tab === "assistant" &&
      (!answer ||
        answer.scope?.currency !== selectedCurrency ||
        answer.period !== period ||
        answer.scope?.ledger_version !== state.ledger_version ||
        answer.scope?.settings_version !== state.settings_version)
    ) {
      api("analyses", "POST", {
        text: "Analyze monthly cash flow",
        period,
        currency: selectedCurrency,
      })
        .then((value) => {
          if (active) setAnswer(value);
        })
        .catch((error) => {
          if (active) setMessage({ text: error.message, error: true });
        });
    }
    const saved = state.statements.find((item) => item.period === period);
    if (tab === "reports" && !report && saved) {
      api(`statements/${saved.id}`)
        .then((value) => {
          if (active) setReport(value);
        })
        .catch((error) => {
          if (active) setMessage({ text: error.message, error: true });
        });
    }
    return () => {
      active = false;
    };
  }, [demo, api, tab, period, selectedCurrency, answer, report, state]);
  async function resetDemo() {
    privateEpoch.current += 1;
    await api("demo/reset", "POST");
    setCommandContext(emptyCommandContext());
    setPortfolioTarget(null);
    setEditorOpen(false);
    setPlanningOpen(false);
    setToolsOpen(false);
    setCurrencyChoice("");
    setLedgerScope({});
    setSelectedDrafts([]);
    setConfirmation(null);
    setReport(null);
    setAnswer(null);
    setEditing(null);
    setAccountOpen(false);
    setEntry(newEvent(locale, DEMO_DATE));
    setPeriod(DEMO_PERIOD);
    setTab("overview");
    setFilter("");
    setReauth("");
    setCsv("");
    setReceiptText("");
    setReceiptFields({});
    setReceiptImage(null);
    setImagePreview(null);
    setQuestion(t("分析本月收支和现金风险"));
    await load(DEMO_PERIOD);
    notify(t("演示已重置，可以开始下一次产品演示。"));
  }
  async function work(operation, success) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await operation();
      if (success) notify(success);
    } catch (error) {
      notify(error.message, true);
      if (error.code === "UNAUTHENTICATED") {
        clearPrivateViews();
      }
    } finally {
      setBusy(false);
    }
  }

  async function lockWorkspace() {
    privateEpoch.current += 1;
    try {
      await api("session", "DELETE");
    } finally {
      clearPrivateViews();
    }
  }
  async function preview(purpose, resource_id, path, method = "POST", payload) {
    const epoch = privateEpoch.current;
    const body = {
      purpose,
      resource_id,
      ...(payload !== undefined && {
        payload,
      }),
      ...(["privacy_delete", "privacy_export"].includes(purpose) && {
        access_code: reauth,
      }),
    };
    const challenge = await api("confirmation-challenges", "POST", body);
    if (epoch !== privateEpoch.current) return;
    setConfirmation({
      challenge,
      path,
      method,
      payload,
      purpose,
      idempotencyKey: crypto.randomUUID(),
      duplicate_resolutions: [],
    });
  }
  async function executeConfirmation() {
    const epoch = privateEpoch.current;
    const current = confirmation;
    const result = await api(
      current.path,
      current.method,
      {
        ...(current.challenge.preview.duplicate_review?.length && {
          duplicate_resolutions: current.duplicate_resolutions,
        }),
        nonce: current.challenge.nonce,
        content_hash: current.challenge.content_hash,
        ...(current.payload !== undefined && {
          payload: current.payload,
        }),
      },
      current.idempotencyKey,
    );
    if (epoch !== privateEpoch.current) return;
    setConfirmation(null);
    if (current.purpose === "correct_event")
      setCommandContext((old) => ({
        ...old,
        recent: old.recent.map((id) =>
          id === result.reverses ? result.resource_id : id,
        ),
      }));
    if (current.purpose === "confirm_draft_batch") setSelectedDrafts([]);
    if (current.purpose === "privacy_export") {
      const password = backupPassword.current;
      backupPassword.current = "";
      const output = password ? await encryptBackup(result, password) : result;
      if (epoch !== privateEpoch.current) return;
      download(
        password
          ? "wallet-encrypted-backup.json"
          : demo
            ? "wallet-demo-export.json"
            : "wallet-private-export.json",
        JSON.stringify(output, null, 2),
        "application/json",
      );
    }
    if (current.purpose === "privacy_delete") {
      privateEpoch.current += 1;
      setCommandContext(emptyCommandContext());
      setPortfolioTarget(null);
      setEditorOpen(false);
      setPlanningOpen(false);
      setToolsOpen(false);
      setSelectedDrafts([]);
      setState(null);
      setSession("locked");
      setTab("overview");
      setAnswer(null);
      setReport(null);
      setQuestion("");
      setFilter("");
      setEditing(null);
      setAccountOpen(false);
      setAccount({
        name: "",
        type: "cash",
        currency: "AUD",
        opening_balance: "0",
        opened_on: demo ? DEMO_DATE : today(),
      });
      setReauth("");
      setPlan(emptyPlan);
      setEntry(newEvent(locale, demo ? DEMO_DATE : today()));
      setCsv("");
      setCsvMock(false);
      setReceiptText("");
      setReceiptFields({});
      setReceiptImage(null);
      setImagePreview(null);
      notify(
        t(
          demo
            ? "演示数据已清除，正式账本不受影响。可以重置开始下一次演示。"
            : "本地数据已删除；下载文件与自行制作的备份请自行清理。",
        ),
      );
    } else {
      analysisSequence.current++;
      setAnswer(null);
      if (
        current.purpose === "consents" &&
        current.payload?.analysis === false
      ) {
        setReport(null);
        setCommandContext((old) => ({ ...old, analysis: null }));
      }
      await load();
      notify(t("操作完成。计算与授权已更新。"));
    }
  }
  function selectAccount(id) {
    const selected = state.accounts.find((a) => a.id === id);
    setEntry((e) => ({
      ...e,
      account_id: id,
      currency: selected.currency,
      counterparty_id: null,
    }));
  }
  async function submitEntry(event) {
    event.preventDefault();
    await work(async () => {
      if (editing)
        await api(`drafts/${editing.id}`, "PUT", {
          version: editing.version,
          content: entry,
        });
      else await api("drafts", "POST", entry);
      setEditorOpen(false);
      setEditing(null);
      setEntry((e) => ({
        ...newEvent(locale, demo ? DEMO_DATE : today()),
        account_id: e.account_id,
        currency: e.currency,
      }));
      await load();
    }, t("草稿已保存，尚未入账。请核对后确认。"));
  }
  async function fileCsv(file) {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      notify(t("CSV限1MiB。"), true);
      return;
    }
    setCsv(await file.text());
  }
  async function fileImage(file) {
    if (!file) return;
    if (demo) {
      notify(
        t("演示不识别任意图片；请选择模拟样例或粘贴支持的凭证文本。"),
        true,
      );
      return;
    }
    if (
      !file.type.match(/^image\/(png|jpeg)$/) ||
      file.size > 5 * 1024 * 1024
    ) {
      notify(t("只接受5MiB以内PNG/JPEG。"), true);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result);
      setReceiptImage(value.split(",")[1]);
      setImagePreview(value);
    };
    reader.readAsDataURL(file);
  }
  const accountsById = Object.fromEntries(
    (state?.accounts || []).map((a) => [a.id, a]),
  );
  const accountSelect = (
    <select
      value={entry.account_id}
      onChange={(e) => selectAccount(e.target.value)}
      required
    >
      <option value="" disabled>
        {t("选择账户")}
      </option>
      {state?.accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name} · {a.currency}
        </option>
      ))}
    </select>
  );
  function previewContent(value) {
    value = Object.fromEntries(
      Object.entries(value).filter(
        ([key]) =>
          !["duplicate_review", "duplicate_ledger_version"].includes(key),
      ),
    );
    if (confirmation?.purpose === "investment_change")
      return (
        <div className="investment-confirm-preview">
          <h3>{value.entry?.name || value.previous?.name}</h3>
          <p>{t("仅维护本地历史，不执行外部买卖，不另建现金收入。")}</p>
          <dl className="preview-rows">
            {Object.entries(
              value.valuation ||
                value.event ||
                value.patch || { action: value.action },
            )
              .filter(
                ([key, v]) =>
                  !["evidence", "supersedes"].includes(key) &&
                  v !== null &&
                  typeof v !== "object",
              )
              .map(([key, v]) => (
                <div key={key}>
                  <dt>
                    {t(
                      {
                        market_value: "市值",
                        cost_basis: "剩余成本",
                        reported_gain: "凭证报告累计收益",
                        daily_gain: "今日收益（不计为累计）",
                        observed_at: "观察时间",
                        amount: "金额",
                        fee: "费用",
                        tax: "税费",
                        type: "收益事件类型",
                        action: "操作",
                        name: "名称",
                        issuer: "发行人",
                        quantity: "份额",
                        price: "单位价格",
                      }[key] || key,
                    )}
                  </dt>
                  <dd>{String(v)}</dd>
                </div>
              ))}
          </dl>
        </div>
      );
    if (confirmation?.purpose === "confirm_draft_batch")
      return (
        <div>
          {value.drafts.map((d) => (
            <PreviewRows
              key={d.id}
              accountsById={accountsById}
              value={d.content}
            />
          ))}
        </div>
      );
    if (confirmation?.purpose === "correct_event")
      return (
        <div>
          <h3>{t("原记录")}</h3>
          <PreviewRows accountsById={accountsById} value={value.original} />
          <h3>{t("更正后")}</h3>
          <PreviewRows accountsById={accountsById} value={value.replacement} />
          <p>{t("原子冲正并替代；原记录保留")}</p>
        </div>
      );
    if (confirmation?.purpose.startsWith("privacy_"))
      return (
        <p>
          {demo && (
            <strong>
              {t("仅模拟本浏览器演示数据的导出或删除，不影响正式版。")}
              <br />
            </strong>
          )}
          {t("范围：此本地工作台全部数据（")}
          {value.counts.accounts}
          {t("个账户、")}
          {value.counts.drafts}
          {t("条草稿、")}
          {value.counts.events}
          {t("个事件、")}
          {value.counts.statements}
          {t("份报告、")}
          {value.counts.investments ?? value.counts.holdings}
          {t("条持仓）。")}
          {confirmation.purpose === "privacy_delete"
            ? t("将清理账户、草稿、账本、报表、持仓和授权，并退出全部会话。")
            : t("将下载包含私人明细的JSON文件。")}
          {t("下载文件和用户自行制作的备份需自行管理。")}
        </p>
      );
    if (confirmation?.purpose === "reverse_event")
      return (
        <>
          <p>{t("追加反向分录，保留历史；更正时可再创建新草稿。")}</p>
          <PreviewRows accountsById={accountsById} value={value.original} />
        </>
      );
    return <PreviewRows accountsById={accountsById} value={value} />;
  }
  if (session !== "authenticated" || !state)
    return (
      <main className="login-page">
        <div className="login-decoration">
          <div className="brand">
            <div className="brand-mark">
              <Wallet size={24} />
            </div>
            <div>
              {t("知账")}
              <span>{t("个人财务")}</span>
            </div>
          </div>
          <div>
            <div className="eyebrow">YOUR MONEY, CLEARLY.</div>
            <h1>
              {t("每一笔，有据可查。")}
              <br />
              {t("每一步，心中有数。")}
            </h1>
            <p>
              {t("从一份账单开始，理解收支、规划目标。")}
              <br />
              {t("在自己的设备上，把财务看清楚。")}
            </p>
            <div className="login-pills">
              <span>
                <LockKeyhole size={15} />
                {t("本地处理")}
              </span>
              <span>
                <Check size={15} />
                {t("金额可复算")}
              </span>
              <span>
                <ShieldCheck size={15} />
                {t("由你确认")}
              </span>
            </div>
          </div>
          <small>{t("只读财务分析 · 无支付或证券交易")}</small>
        </div>
        <section className="login-card">
          <div className="login-card-top">
            <span className="eyebrow">
              {t(cloud ? "云端账号" : "本地访问")}
            </span>
            <LanguageSwitch />
          </div>
          <div className="eyebrow">{t("私人财务工作台")}</div>
          <h2>{t(demo ? "打开产品演示" : "打开你的工作台")}</h2>
          {cloud ? (
            <CloudAuth
              api={api}
              pending={session === "loading"}
              onSignedIn={() => load()}
            />
          ) : (
            <>
              <p>
                {demo ? (
                  t("无需访问码。所有模块使用预设数据，可以随时重置演示。")
                ) : (
                  <>
                    {t("运行")}
                    <code>npm run dev</code>
                    {t("，输入终端显示的本地访问码。无需云端账号或API密钥。")}
                  </>
                )}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  work(async () => {
                    await api("session", "POST", {
                      access_code: code,
                    });
                    setCode("");
                    await load();
                  });
                }}
              >
                {!demo && (
                  <Field
                    label={t("本地访问码")}
                    type="password"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="current-password"
                    disabled={session === "loading" || busy}
                    required
                    autoFocus
                  />
                )}
                <button
                  className="primary wide"
                  disabled={busy || session === "loading"}
                >
                  {busy
                    ? t("正在打开…")
                    : session === "loading"
                      ? t(demo ? "加载演示场景…" : "连接本地服务…")
                      : t(demo ? "进入演示" : "进入工作台")}
                  <ChevronRight size={18} />
                </button>
              </form>
              {demo ? (
                <button
                  className="secondary wide demo-login-reset"
                  disabled={busy}
                  onClick={() => work(resetDemo)}
                >
                  {t("重置演示")}
                </button>
              ) : (
                <a className="secondary wide demo-login-reset" href="/demo">
                  {t("查看产品演示")}
                </a>
              )}
            </>
          )}
          {message && !masked && (
            <div
              className={`notice ${message.error ? "error" : ""}`}
              role={message.error ? "alert" : "status"}
            >
              {t(message.text)}
            </div>
          )}
          <div className="login-note">
            <ShieldCheck size={18} />
            <span>
              {t(
                demo
                  ? "演示修改仅保存在本浏览器，与正式账本分开。"
                  : cloud
                    ? "每位用户拥有独立的私人工作空间。请使用独立密码并启用多重验证。"
                    : "数据存储在本机。本地模式仅支持一位使用者；请开启设备磁盘加密。",
              )}
            </span>
          </div>
        </section>
      </main>
    );
  return (
    <div
      className="app-shell"
      data-section={tab}
      onClickCapture={
        demo
          ? (event) => {
              const link = event.target.closest("a");
              if (
                link &&
                (/^https?:/.test(link.getAttribute("href")) ||
                  (tab === "assistant" &&
                    link.getAttribute("href") === "/demo"))
              ) {
                event.preventDefault();
                notify(t("演示来源为本地预设，查看样例无需打开外部网站。"));
              }
            }
          : undefined
      }
    >
      <aside className="sidebar">
        <a className="brand" href={demo ? "/demo" : "/"}>
          <div className="brand-mark">
            <Wallet size={23} />
          </div>
          <div>
            {t("知账")}
            <span>{t("个人财务")}</span>
          </div>
        </a>
        <div className="sidebar-caption">{t("我的工作台")}</div>
        <nav>
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${tab === id ? "active" : ""}`}
              aria-label={label}
              aria-current={tab === id ? "page" : undefined}
              data-module={id}
              aria-describedby={
                id === "ledger" && state.drafts.length > 0
                  ? "pending-drafts-caption"
                  : undefined
              }
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "ledger" && state.drafts.length > 0 && (
                <b id="pending-drafts-caption">
                  {state.drafts.length}
                  <span className="sr-only"> {t("笔待确认草稿")}</span>
                </b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="status-dot" />
            {t(demo ? "产品演示" : cloud ? "云端空间" : "本地模式")}
            <p>
              {t(
                demo
                  ? "预设数据 · 无需联网"
                  : cloud
                    ? "私人账号 · 服务端存储"
                    : "数据留在此设备",
              )}
              <br />
              {t(demo ? "可随时重置场景" : "自动云调用与交易已关闭")}
            </p>
          </div>
          <button className="nav-item" onClick={() => work(lockWorkspace)}>
            <LockKeyhole size={18} />
            {t("锁定工作台")}
          </button>
        </div>
      </aside>
      <div className="main-wrap">
        <TerminalHeader
          tabs={tabs}
          onTask={openTask}
          onNavigate={navigate}
          demo={demo}
          cloud={cloud}
          onLock={() => work(lockWorkspace)}
          unreadCount={
            masked ||
            !state.consents.analysis ||
            state.notifications?.period !== period
              ? 0
              : state.notifications?.unread_count || 0
          }
          onNotifications={() => {
            const element = document.getElementById("workspace-notifications");
            if (element) {
              element.focus();
              element.scrollIntoView({ block: "start", behavior: "instant" });
            } else {
              notificationAnchor.current = true;
              navigate("overview");
            }
          }}
        />
        <main className="workspace">
          {demo && (
            <details className="demo-banner" aria-label={t("演示模式说明")}>
              <summary>
                <span className="demo-mode-tag">DEMO</span>
                {t("演示场景与重置")}
              </summary>
              <div>
                <span className="demo-mode-tag">DEMO</span>
                <strong>{t("产品演示，开箱即可体验")}</strong>
                <p>
                  {t(
                    "预设场景：2026年9月。市场、AI与凭证识别均为演示样例；不会连接真实账户。",
                  )}
                  {state.demo?.persistence === "memory" && (
                    <span>
                      {" "}
                      {t("浏览器存储不可用，修改仅保留到本页关闭。")}
                    </span>
                  )}
                </p>
              </div>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => work(resetDemo)}
              >
                {t("重置演示")}
              </button>
            </details>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">{t("个人财务")}</div>
              <h1>{tabs.find((t) => t.id === tab).label}</h1>
              <p>
                {!masked && currentInsight
                  ? t(
                      currentInsight.text_key,
                      Object.fromEntries(
                        Object.entries(currentInsight.params || {}).map(
                          ([k, v]) => [
                            k,
                            ["analysis", "ocr"].includes(k) ? t(v) : v,
                          ],
                        ),
                      ),
                    )
                  : t("有来源的记录、可复算的金额，由你掌握。")}
              </p>
            </div>
            <div className="heading-controls">
              <MonthField
                key={period}
                label={t("分析月份")}
                value={period}
                onChange={(value) => {
                  saveLocation({ period: value });
                  analysisSequence.current++;
                  setPeriod(value);
                  setAnswer(null);
                  setReport(null);
                }}
              />
              <select
                aria-label={t("当前币种")}
                value={selectedCurrency}
                onChange={(e) => {
                  saveLocation({ currency: e.target.value });
                  analysisSequence.current++;
                  setCurrencyChoice(e.target.value);
                }}
              >
                {Array.from(
                  new Set([
                    selectedCurrency,
                    ...state.accounts.map((a) => a.currency),
                    ...state.investments.map((x) => x.currency),
                    ...currencies,
                  ]),
                ).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <button
                className="primary"
                disabled={masked && !["privacy", "settings"].includes(tab)}
                onClick={primaryAction}
              >
                <Plus size={17} />
                {t(primaryLabels[tab])}
              </button>
            </div>
          </div>
          {message && (
            <div
              className={`notice ${message.error ? "error" : ""}`}
              role="status"
            >
              <span>{t(message.text)}</span>
              <button
                className="icon-button"
                aria-label={t("关闭提示")}
                onClick={() => setMessage(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {state.mock && !demo && (
            <div className="mock-banner">
              {t("演示数据 · MOCK：此工作台含合成记录，不能当作真实金融事实。")}
            </div>
          )}
          {!state.consents.analysis && (
            <div className="notice error">
              {t(
                "本地分析用途未授权或已撤回。账本仍可查阅；请在隐私页预览并授权后运行计算。",
              )}
            </div>
          )}

          <div className="terminal-layout">
            <div className="terminal-content">
              {masked && !["privacy", "settings"].includes(tab) ? (
                <MaskedPanel />
              ) : (
                <>
                  {tab === "overview" && state.consents.analysis && (
                    <TerminalMetrics
                      onSource={advisorySource}
                      onReview={() => {
                        setLedgerView("drafts");
                        navigate("ledger");
                      }}
                      state={state}
                      currency={selectedCurrency}
                    />
                  )}
                  {tab === "overview" && state.consents.analysis && (
                    <NotificationCenter
                      feed={
                        state.notifications?.period === period
                          ? state.notifications
                          : null
                      }
                      loading={state.notifications?.period !== period}
                      demo={demo}
                      onRebalance={(n) => {
                        setCurrencyChoice(n.currency);
                        openTask({ mode: "analysis" });
                      }}
                      onRead={readNotifications}
                      onRefresh={refreshNotifications}
                      onNavigate={(target) =>
                        work(async () => {
                          const loaded = await load(target.period);
                          if (loaded) openNotificationTarget(target);
                        })
                      }
                    />
                  )}
                  {tab === "overview" && state.consents.analysis && (
                    <DashboardPulse
                      state={state}
                      currency={selectedCurrency}
                      onNavigate={navigate}
                    />
                  )}
                  {tab === "settings" && (
                    <>
                      {cloud && <CloudAccount api={api} onUpdated={load} />}
                      <TerminalSettings
                        key={session}
                        api={api}
                        demo={demo}
                        cloud={cloud}
                        authorized={state.consents.analysis}
                        onUpdated={load}
                      />
                    </>
                  )}
                  {tab === "assistant" && (
                    <AnalysisQuery
                      period={period}
                      currency={selectedCurrency}
                      onBasis={() => drill({ tab: "assistant" })}
                      value={question}
                      onChange={setQuestion}
                      busy={busy}
                      authorized={state.consents.analysis}
                      onSubmit={(e) => {
                        e.preventDefault();
                        work(() => analyze(question));
                      }}
                    />
                  )}
                  {!["overview", "settings", "assistant", "ledger"].includes(
                    tab,
                  ) && (
                    <PageSummary
                      state={state}
                      tab={tab}
                      currency={selectedCurrency}
                      onDrill={drill}
                    />
                  )}
                  {tab === "ledger" && (
                    <>
                      {ledgerScope.returnTab && (
                        <div className="filter-return">
                          <span>
                            {t("筛选：{category} · {period} · {currency}", {
                              category:
                                filter ||
                                t(
                                  ledgerScope.resource_id
                                    ? "指定记录"
                                    : "指定日期",
                                ),
                              period,
                              currency: selectedCurrency,
                            })}
                          </span>
                          <button
                            className="secondary"
                            onClick={() => {
                              navigate(ledgerScope.returnTab);
                              setFilter("");
                              setLedgerScope({});
                            }}
                          >
                            {t(
                              ledgerScope.origin === "notification"
                                ? "返回通知"
                                : "返回关系图",
                            )}
                          </button>
                          <button
                            className="text-button"
                            onClick={() => {
                              setFilter("");
                              setLedgerScope({});
                            }}
                          >
                            {t("清除筛选")}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                  {tab === "reports" && (
                    <>
                      <CashBridge state={state} currency={selectedCurrency} />
                      <MonthComparison
                        state={state}
                        currency={selectedCurrency}
                      />
                    </>
                  )}

                  {tab === "privacy" && (
                    <SecurityVault
                      api={api}
                      demo={demo}
                      cloud={cloud}
                      reauth={reauth}
                      onReauth={setReauth}
                      revision={state.ledger_version}
                      onEncryptedExport={async (password) => {
                        backupPassword.current = password;
                        try {
                          await preview(
                            "privacy_export",
                            "all",
                            "privacy/export",
                          );
                        } catch (e) {
                          backupPassword.current = "";
                          throw e;
                        }
                      }}
                    />
                  )}
                  {tab === "overview" && (
                    <Overview
                      state={state}
                      period={period}
                      currencyChoice={selectedCurrency}
                      onRange={(scope) =>
                        drill({
                          tab: "ledger",
                          currency: selectedCurrency,
                          period,
                          ...scope,
                        })
                      }
                      busy={busy}
                      onAddAccount={() => setAccountOpen(true)}
                      onNavigate={navigate}
                      demo={demo}
                      relationships={
                        <div className="relation-grid">
                          <BudgetComparison
                            state={state}
                            currency={selectedCurrency}
                            onDrill={drill}
                          />
                          <CategoryExpenses
                            state={state}
                            currency={selectedCurrency}
                            onDrill={drill}
                          />
                        </div>
                      }
                    />
                  )}

                  {tab === "ledger" && (
                    <>
                      <section className="ledger-task-bar panel">
                        <div className="button-row">
                          <button className="primary" onClick={openManual}>
                            {t("添加记录")}
                          </button>
                          <button
                            className="secondary"
                            onClick={() => openImport("csv")}
                          >
                            {t("CSV导入")}
                          </button>
                          <button
                            className="secondary"
                            onClick={() => setAgentOpen(true)}
                          >
                            {t("输入本地任务")}
                          </button>
                        </div>
                        <div role="tablist" aria-label={t("账本记录视图")}>
                          {[
                            ["all", "全部"],
                            ["drafts", "待确认"],
                            ["confirmed", "已确认"],
                          ].map(([id, key]) => (
                            <button
                              role="tab"
                              aria-selected={ledgerView === id}
                              key={id}
                              onClick={() => setLedgerView(id)}
                            >
                              {t(key)}
                              {id === "drafts"
                                ? ` (${state.drafts.length})`
                                : ""}
                            </button>
                          ))}
                        </div>
                      </section>
                      <details className="panel ledger-tools" open={toolsOpen}>
                        <summary
                          onClick={(e) => {
                            e.preventDefault();
                            setToolsOpen(!toolsOpen);
                          }}
                        >
                          {t("手工、CSV与凭证工具")}
                          <ChevronRight size={16} />
                        </summary>

                        <div className="panel-heading">
                          <h2>
                            {editing ? t("修改待确认草稿") : t("添加记录")}
                          </h2>
                          <button
                            className="secondary"
                            onClick={() => setAccountOpen(true)}
                          >
                            <Plus size={15} />
                            {t("添加账户")}
                          </button>
                        </div>
                        <div className="segmented">
                          {[
                            ["manual", t("手工记账")],
                            ["csv", t("CSV导入")],
                            ["receipt", t("凭证识别")],
                          ].map(([id, label]) => (
                            <button
                              key={id}
                              className={importMode === id ? "selected" : ""}
                              onClick={() => setImportMode(id)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        {!state.accounts.length ? (
                          <Empty
                            title={t("先添加一个账户")}
                            text={t(
                              "指定账户、币种与期初余额，之后才能保存草稿。",
                            )}
                          >
                            <button
                              className="primary"
                              onClick={() => setAccountOpen(true)}
                            >
                              {t("添加账户")}
                            </button>
                          </Empty>
                        ) : importMode === "manual" ? (
                          <button className="secondary" onClick={openManual}>
                            {t("打开记录编辑器")}
                          </button>
                        ) : importMode === "csv" ? (
                          <div>
                            <div className="form-grid two">
                              <Field label={t("缺少account_id列时使用账户")}>
                                {accountSelect}
                              </Field>
                              <Field label={t("上传CSV文件")}>
                                <input
                                  type="file"
                                  accept=".csv,text/csv"
                                  onChange={(e) => fileCsv(e.target.files[0])}
                                />
                              </Field>
                            </div>
                            {demo && (
                              <button
                                className="secondary demo-fill-button"
                                onClick={() => {
                                  setCsv(DEMO_CSV);
                                  setCsvMock(true);
                                }}
                              >
                                {t("填入演示CSV")}
                              </button>
                            )}
                            <Field label={t("CSV内容")}>
                              <textarea
                                rows={7}
                                value={csv}
                                onChange={(e) => setCsv(e.target.value)}
                                placeholder={t(
                                  "date,amount,currency,merchant,category,kind,external_id\n2026-10-13,138.50,AUD,Groceries,食品,expense,bank-001",
                                )}
                              />
                            </Field>
                            <label className="inline-choice">
                              <input
                                type="checkbox"
                                checked={csvMock}
                                onChange={(event) =>
                                  setCsvMock(event.target.checked)
                                }
                              />
                              {t("此CSV为合成演示数据（MOCK）")}
                            </label>
                            <div className="form-footer">
                              <span>
                                {t(
                                  "金额为正数，由kind确定方向。external_id用于重试去重。",
                                )}
                              </span>
                              <button
                                className="primary"
                                disabled={busy || !csv}
                                onClick={() =>
                                  work(async () => {
                                    const result = await api(
                                      "imports",
                                      "POST",
                                      {
                                        csv,
                                        account_id: entry.account_id,
                                        mock: csvMock,
                                      },
                                    );
                                    await load();
                                    notify(
                                      t(
                                        "导入完成：{v0}行，{v1}条已存在。请核对草稿。",
                                        {
                                          v0: result.drafts.length,
                                          v1: result.duplicates,
                                        },
                                      ),
                                    );
                                  })
                                }
                              >
                                <Upload size={16} />
                                {t("导入为草稿")}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            {!state.consents.ocr ? (
                              <div className="notice">
                                {t(
                                  "本地凭证识别用途未授权。请在隐私页开启后使用。",
                                )}
                                <button
                                  className="text-button"
                                  onClick={() => setTab("privacy")}
                                >
                                  {t("管理授权")}
                                </button>
                              </div>
                            ) : (
                              <>
                                <div className="form-grid two">
                                  <Field label={t("记账账户")}>
                                    {accountSelect}
                                  </Field>
                                  <Field label={t("PNG/JPEG · 最大5MiB")}>
                                    <input
                                      type="file"
                                      accept="image/png,image/jpeg"
                                      onChange={(e) =>
                                        fileImage(e.target.files[0])
                                      }
                                    />
                                  </Field>
                                </div>
                                {demo && (
                                  <div className="demo-inline-note">
                                    <p>
                                      {t(
                                        "凭证结果是预设演示样例，不分析上传内容。",
                                      )}
                                    </p>
                                    <button
                                      className="secondary"
                                      onClick={() => {
                                        setReceiptText(DEMO_RECEIPT);
                                        setReceiptImage(null);
                                        setImagePreview(null);
                                      }}
                                    >
                                      {t("填入演示凭证")}
                                    </button>
                                  </div>
                                )}
                                <Field label={t("或粘贴凭证文本")}>
                                  <textarea
                                    rows={5}
                                    value={receiptText}
                                    onChange={(e) => {
                                      setReceiptText(e.target.value);
                                      setReceiptImage(null);
                                      setImagePreview(null);
                                    }}
                                    placeholder={t(
                                      "商户名称\n2026-10-13\nTOTAL AUD 138.50",
                                    )}
                                  />
                                </Field>
                                {imagePreview && (
                                  <div className="receipt-preview">
                                    <div
                                      role="img"
                                      aria-label={t("原始凭证预览")}
                                      className="receipt-image"
                                      style={{
                                        backgroundImage: `url(${imagePreview})`,
                                      }}
                                    />
                                    <button
                                      className="text-button"
                                      onClick={() => {
                                        setReceiptImage(null);
                                        setImagePreview(null);
                                      }}
                                    >
                                      {t("清除图片")}
                                    </button>
                                  </div>
                                )}
                                <div className="form-grid">
                                  <Field
                                    label={t("金额（未识别时填写）")}
                                    value={receiptFields.amount || ""}
                                    onChange={(e) =>
                                      setReceiptFields({
                                        ...receiptFields,
                                        amount: e.target.value,
                                      })
                                    }
                                  />
                                  <Field
                                    label={t("日期（未识别时填写）")}
                                    type="date"
                                    value={receiptFields.date || ""}
                                    onChange={(e) =>
                                      setReceiptFields({
                                        ...receiptFields,
                                        date: e.target.value,
                                      })
                                    }
                                  />
                                  <Field label={t("币种（不猜测$符号）")}>
                                    <select
                                      value={receiptFields.currency || ""}
                                      onChange={(e) =>
                                        setReceiptFields({
                                          ...receiptFields,
                                          currency: e.target.value,
                                        })
                                      }
                                    >
                                      <option value="">{t("未指定")}</option>
                                      {currencies.map((c) => (
                                        <option key={c}>{c}</option>
                                      ))}
                                    </select>
                                  </Field>
                                </div>
                                <div className="form-footer">
                                  <span>
                                    {t(
                                      demo
                                        ? "凭证结果是预设演示样例，不分析上传内容。"
                                        : "英文图片OCR依赖本地Tesseract。未知字段需修正，绝不自动入账。",
                                    )}
                                  </span>
                                  <button
                                    className="primary"
                                    disabled={
                                      busy || (!receiptText && !receiptImage)
                                    }
                                    onClick={() =>
                                      work(async () => {
                                        const result = await api(
                                          "receipts",
                                          "POST",
                                          {
                                            text: receiptText,
                                            ...(receiptImage && {
                                              image_base64: receiptImage,
                                            }),
                                            account_id: entry.account_id,
                                            ...Object.fromEntries(
                                              Object.entries(
                                                receiptFields,
                                              ).filter(([, v]) => v),
                                            ),
                                          },
                                        );
                                        if (result.draft_id) {
                                          setReceiptFields({});
                                          await load();
                                          notify(
                                            t(
                                              "识别草稿已保存。请对照原凭证复核后确认。",
                                            ),
                                          );
                                        } else {
                                          setReceiptFields(result.fields);
                                          notify(
                                            t(
                                              "字段缺失：{v0}。请补充后再次识别。",
                                              {
                                                v0: result.missing
                                                  .map((k) => labels[k])
                                                  .join("、"),
                                              },
                                            ),
                                          );
                                        }
                                      })
                                    }
                                  >
                                    {t("识别为草稿")}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </details>
                      <section
                        className="panel"
                        id="pending-drafts"
                        hidden={ledgerView === "confirmed"}
                      >
                        <div className="panel-heading">
                          <h2>
                            {t("待确认")}
                            <span className="count">{state.drafts.length}</span>
                          </h2>
                          <span className="muted">{t("未计入收支和余额")}</span>
                        </div>
                        <div className="batch-actions">
                          <span>{t("选择需要一起确认的草稿")}</span>
                          <button
                            className="secondary"
                            disabled={busy || !selectedDrafts.length}
                            onClick={() =>
                              work(() =>
                                preview(
                                  "confirm_draft_batch",
                                  "batch",
                                  "draft-batches/confirm",
                                  "POST",
                                  {
                                    drafts: state.drafts
                                      .filter((d) =>
                                        selectedDrafts.includes(d.id),
                                      )
                                      .map((d) => ({
                                        id: d.id,
                                        version: d.version,
                                      })),
                                  },
                                ),
                              )
                            }
                          >
                            {t("预览选中批次")} ({selectedDrafts.length})
                          </button>
                        </div>
                        {state.drafts.map((d) => (
                          <div className="draft-card" key={d.id}>
                            <label className="inline-choice">
                              <input
                                type="checkbox"
                                aria-label={t("选中草稿 {name}", {
                                  name: d.content.merchant,
                                })}
                                checked={selectedDrafts.includes(d.id)}
                                onChange={(e) =>
                                  setSelectedDrafts((old) =>
                                    e.target.checked
                                      ? [...old, d.id]
                                      : old.filter((id) => id !== d.id),
                                  )
                                }
                              />
                              {t("加入确认批次")}
                            </label>
                            <div className="draft-main">
                              <div>
                                <strong>{d.content.merchant}</strong>
                                <p>
                                  {d.content.date} · {kinds[d.content.kind]} ·{" "}
                                  {accountsById[d.content.account_id]?.name} ·{" "}
                                  {d.content.category}
                                  {d.content.mock && " · MOCK"}
                                </p>
                                {d.duplicate_candidates.length > 0 && (
                                  <span className="warning">
                                    {t("可能与")}
                                    {d.duplicate_candidates.length}
                                    {t("笔已确认记录重复，请先核对。")}
                                  </span>
                                )}
                                <EvidenceQuality evidence={d.evidence} />
                                <RefundLinkProposal
                                  state={state}
                                  draft={d}
                                  onChoose={(event) => {
                                    if (editorOpen) return;
                                    openResource({
                                      resource_type: "draft",
                                      resource_id: d.id,
                                    });
                                    setEntry((old) => ({
                                      ...old,
                                      kind: "refund",
                                      refund_of: event.id,
                                      category: event.category,
                                    }));
                                  }}
                                />
                                <details>
                                  <summary>{t("查看来源与识别证据")}</summary>
                                  <p>
                                    {t("来源：")}
                                    {d.evidence.source}
                                    {t("· 质量：")}
                                    {d.evidence.quality || t("待复核")}{" "}
                                    {t("· 草稿版本")} {d.version}
                                  </p>
                                  {(d.evidence.text || d.evidence.raw_text) && (
                                    <pre className="evidence-text">
                                      {d.evidence.text || d.evidence.raw_text}
                                    </pre>
                                  )}
                                  {(d.evidence.boxes || d.evidence.word_boxes)
                                    ?.length > 0 && (
                                    <p>
                                      {t("保留")}
                                      {
                                        (
                                          d.evidence.boxes ||
                                          d.evidence.word_boxes
                                        ).length
                                      }
                                      {t("个文字框坐标；请对照上传原图。")}
                                    </p>
                                  )}
                                </details>
                              </div>
                              <Money
                                value={d.content.amount}
                                currency={d.content.currency}
                              />
                            </div>
                            <div className="button-row">
                              <button
                                className="text-button danger-text"
                                disabled={busy}
                                onClick={() =>
                                  work(() =>
                                    preview(
                                      "reject_draft",
                                      d.id,
                                      `drafts/${d.id}/reject`,
                                    ),
                                  )
                                }
                              >
                                {t("拒绝此草稿")}
                              </button>
                              <button
                                className="secondary"
                                disabled={busy}
                                onClick={() =>
                                  openResource({
                                    resource_type: "draft",
                                    resource_id: d.id,
                                  })
                                }
                              >
                                {t("修正")}
                              </button>
                              <button
                                className="primary small"
                                disabled={busy}
                                onClick={() =>
                                  work(() =>
                                    preview(
                                      "confirm_draft",
                                      d.id,
                                      `drafts/${d.id}/confirm`,
                                    ),
                                  )
                                }
                              >
                                <Check size={15} />
                                {t("核对并确认")}
                              </button>
                            </div>
                          </div>
                        ))}
                        {!state.drafts.length && (
                          <Empty
                            title={t("草稿已核对完毕")}
                            text={t(
                              "手工、CSV或凭证导入的新记录会出现在这里。",
                            )}
                          />
                        )}
                      </section>
                      <div hidden={ledgerView === "drafts"}>
                        <LedgerRecords
                          state={state}
                          period={period}
                          currency={selectedCurrency}
                          scope={ledgerScope}
                          filter={filter}
                          onFilter={setFilter}
                          accounts={accountsById}
                          kinds={kinds}
                          busy={busy}
                          onEdit={(id) =>
                            openResource({
                              resource_type: "transaction",
                              resource_id: id,
                            })
                          }
                          onReverse={(id) =>
                            work(() =>
                              preview(
                                "reverse_event",
                                id,
                                `transactions/${id}/reverse`,
                              ),
                            )
                          }
                        />
                      </div>
                      <details className="ledger-analytics">
                        <summary>{t("收支摘要与分类图")}</summary>
                        <PageSummary
                          state={state}
                          tab={tab}
                          currency={selectedCurrency}
                          onDrill={drill}
                        />
                        <CategoryExpenses
                          state={state}
                          currency={selectedCurrency}
                          onDrill={drill}
                        />
                      </details>
                    </>
                  )}

                  {tab === "planning" && (
                    <>
                      <div className="relation-grid">
                        <BudgetComparison
                          state={state}
                          currency={selectedCurrency}
                          onDrill={drill}
                        />
                        <GoalProgress
                          state={state}
                          currency={selectedCurrency}
                        />
                      </div>
                      {planningOpen && (
                        <EditorDrawer
                          title={t("调整预算与目标")}
                          onClose={() => setPlanningOpen(false)}
                        >
                          <section className="panel">
                            <div className="panel-heading">
                              <h2>{t("现金流与生活情景")}</h2>
                              <span className="chip">{t("用户主动提供")}</span>
                            </div>
                            <p className="muted">
                              {t(
                                "按同一币种填写规划。缺失金额保留为空；不要用零代替未知。",
                              )}
                            </p>
                            <div className="form-grid">
                              <Field label={t("规划币种")}>
                                <Currency
                                  value={plan.currency}
                                  onChange={(value) =>
                                    setPlan({
                                      ...plan,
                                      currency: value,
                                    })
                                  }
                                />
                              </Field>
                              <Field
                                label={t("时区")}
                                value={plan.timezone}
                                onChange={(e) =>
                                  setPlan({
                                    ...plan,
                                    timezone: e.target.value,
                                  })
                                }
                              />
                              {[
                                "monthly_income",
                                "essential_spend",
                                "debt_payment",
                                "earmarked",
                              ].map((key) => (
                                <Field
                                  key={key}
                                  label={`${labels[key]} · ${plan.currency}`}
                                  inputMode="decimal"
                                  placeholder={t("未知可留空")}
                                  value={plan[key] ?? ""}
                                  onChange={(e) =>
                                    setPlan({
                                      ...plan,
                                      [key]: e.target.value,
                                    })
                                  }
                                />
                              ))}
                            </div>
                            <div className="status-select">
                              <span>{t("自报生活状态（可不填写）")}</span>
                              <div>
                                {Object.entries(statuses).map(([id, label]) => (
                                  <label key={id}>
                                    <input
                                      type="checkbox"
                                      checked={plan.life_status.includes(id)}
                                      onChange={(e) =>
                                        setPlan({
                                          ...plan,
                                          life_status: e.target.checked
                                            ? [...plan.life_status, id]
                                            : plan.life_status.filter(
                                                (s) => s !== id,
                                              ),
                                        })
                                      }
                                    />{" "}
                                    {label}
                                  </label>
                                ))}
                              </div>
                            </div>
                          </section>
                          <section className="panel">
                            <div className="panel-heading">
                              <h2>{t("类别预算")}</h2>
                              <button
                                className="secondary"
                                onClick={() =>
                                  setPlan({
                                    ...plan,
                                    budgets: [
                                      ...plan.budgets,
                                      {
                                        category: "",
                                        amount: "",
                                      },
                                    ],
                                  })
                                }
                              >
                                <Plus size={16} />
                                {t("添加预算")}
                              </button>
                            </div>
                            {plan.budgets.map((b, i) => (
                              <div className="repeat-row" key={i}>
                                <Field
                                  label={t("类别")}
                                  value={b.category}
                                  onChange={(e) =>
                                    setPlan({
                                      ...plan,
                                      budgets: plan.budgets.map((x, j) =>
                                        j === i
                                          ? {
                                              ...x,
                                              category: e.target.value,
                                            }
                                          : x,
                                      ),
                                    })
                                  }
                                />
                                <Field
                                  label={t("月预算 · {v0}", {
                                    v0: plan.currency,
                                  })}
                                  value={b.amount}
                                  onChange={(e) =>
                                    setPlan({
                                      ...plan,
                                      budgets: plan.budgets.map((x, j) =>
                                        j === i
                                          ? {
                                              ...x,
                                              amount: e.target.value,
                                            }
                                          : x,
                                      ),
                                    })
                                  }
                                />
                                <button
                                  className="icon-button"
                                  aria-label={t("移除预算")}
                                  onClick={() =>
                                    setPlan({
                                      ...plan,
                                      budgets: plan.budgets.filter(
                                        (_, j) => j !== i,
                                      ),
                                    })
                                  }
                                >
                                  <X size={17} />
                                </button>
                              </div>
                            ))}
                            {!plan.budgets.length && (
                              <p className="muted">
                                {t(
                                  "给关心的类别设定月预算，确认后用于偏离检查。",
                                )}
                              </p>
                            )}
                          </section>
                          <section className="panel">
                            <div className="panel-heading">
                              <h2>{t("储蓄目标")}</h2>
                              <button
                                className="secondary"
                                onClick={() =>
                                  setPlan({
                                    ...plan,
                                    goals: [
                                      ...plan.goals,
                                      {
                                        name: "",
                                        target: "",
                                        saved: "0",
                                        deadline: demo ? DEMO_DATE : today(),
                                      },
                                    ],
                                  })
                                }
                              >
                                <Plus size={16} />
                                {t("添加目标")}
                              </button>
                            </div>
                            {plan.goals.map((g, i) => (
                              <div className="goal-edit" key={i}>
                                <div className="form-grid">
                                  <Field
                                    label={t("目标名称")}
                                    value={g.name}
                                    onChange={(e) =>
                                      setPlan({
                                        ...plan,
                                        goals: plan.goals.map((x, j) =>
                                          j === i
                                            ? {
                                                ...x,
                                                name: e.target.value,
                                              }
                                            : x,
                                        ),
                                      })
                                    }
                                  />
                                  {["target", "saved"].map((key) => (
                                    <Field
                                      key={key}
                                      label={`${key === "target" ? t("目标金额") : t("已存金额")} · ${plan.currency}`}
                                      value={g[key]}
                                      onChange={(e) =>
                                        setPlan({
                                          ...plan,
                                          goals: plan.goals.map((x, j) =>
                                            j === i
                                              ? {
                                                  ...x,
                                                  [key]: e.target.value,
                                                }
                                              : x,
                                          ),
                                        })
                                      }
                                    />
                                  ))}
                                  <Field
                                    label={t("截止日")}
                                    type="date"
                                    value={g.deadline}
                                    onChange={(e) =>
                                      setPlan({
                                        ...plan,
                                        goals: plan.goals.map((x, j) =>
                                          j === i
                                            ? {
                                                ...x,
                                                deadline: e.target.value,
                                              }
                                            : x,
                                        ),
                                      })
                                    }
                                  />
                                </div>
                                <button
                                  className="text-button danger-text"
                                  onClick={() =>
                                    setPlan({
                                      ...plan,
                                      goals: plan.goals.filter(
                                        (_, j) => j !== i,
                                      ),
                                    })
                                  }
                                >
                                  {t("移除此目标")}
                                </button>
                              </div>
                            ))}
                          </section>
                          <div className="sticky-save">
                            <span>
                              {t(
                                "变更需预览并确认；计划接受不代表任何资金交易。",
                              )}
                            </span>
                            <button
                              className="primary"
                              disabled={busy}
                              onClick={() =>
                                work(() =>
                                  preview(
                                    "planning",
                                    "planning",
                                    "planning",
                                    "PUT",
                                    plan,
                                  ).then(() => setPlanningOpen(false)),
                                )
                              }
                            >
                              {t("预览并保存规划")}
                            </button>
                          </div>
                        </EditorDrawer>
                      )}
                      {state.risk && (
                        <section className="panel">
                          <div className="panel-heading">
                            <h2>{t("已批准规划 · 情景结果")}</h2>
                            <span className="chip">{t("无收益假设")}</span>
                          </div>
                          <div className="metrics-grid">
                            <Metric
                              label={t("可用现金")}
                              value={state.risk.metrics.available}
                              unit={state.risk.metrics.currency}
                              note={t("扣除已圈定资金")}
                            />
                            <Metric
                              label={t("必要支出覆盖")}
                              value={state.risk.metrics.coverage_months}
                              unit={t("个月")}
                              note={t("必要支出加必须偿债")}
                            />
                            <Metric
                              label={t("无收入压力情景")}
                              value={state.risk.metrics.income_loss_months}
                              unit={t("个月")}
                              note={t("情景，不是失业预测")}
                            />
                            <Metric
                              label={t("30天情景现金")}
                              value={state.risk.metrics.cash_30d}
                              unit={state.risk.metrics.currency}
                              note={t("固定收入与支出假设")}
                            />
                          </div>
                          {state.risk.goals.map((g, i) => (
                            <div className="account-row" key={i}>
                              <div>
                                <strong>
                                  {g.name}
                                  {g.overdue && t(" · 已过截止日")}
                                </strong>
                                <p>
                                  {t("缺口")}
                                  {g.gap} {plan.currency}{" "}
                                  {t("· 无收益月存款下限")} {g.monthly_required}
                                </p>
                              </div>
                            </div>
                          ))}
                        </section>
                      )}
                      <details className="long-term-scenario">
                        <summary>{t("长期情景模拟（可选）")}</summary>
                        <PlanningSimulator
                          api={api}
                          demo={demo}
                          currency={selectedCurrency}
                          authorized={state.consents.analysis}
                        />
                      </details>
                    </>
                  )}

                  {tab === "portfolio" && (
                    <>
                      <div
                        className={`portfolio-terminal-grid ${!state.consents.analysis ? "single" : ""}`}
                      >
                        {state.consents.analysis && (
                          <AllocationPanel
                            state={state}
                            currency={selectedCurrency}
                            onNavigate={navigate}
                            worksheet
                          />
                        )}
                        <InvestmentView
                          state={state}
                          api={api}
                          period={period}
                          currency={selectedCurrency}
                          onConfirm={preview}
                          trigger={portfolioTrigger}
                          focusResource={portfolioTarget}
                          onUpload={() => {
                            setCommandContext((old) => ({
                              ...old,
                              mode: "evidence",
                              doc_type: "investment",
                            }));
                            navigate("assistant");
                          }}
                        />
                      </div>
                      {state.consents.analysis && (
                        <PortfolioRiskLab
                          currency={selectedCurrency}
                          demo={demo}
                        />
                      )}
                    </>
                  )}

                  {tab === "reports" && (
                    <>
                      <section className="panel report-intro">
                        <div>
                          <h2>{t("把一个月，留成一份可复核的记录。")}</h2>
                          <p>
                            {t(
                              "账单固定当时的账本与计算版本。晚到记录生成新版本，旧版保留。",
                            )}
                            <br />
                            {t(
                              "账户未完成银行对账，因此当前所有报告标为暂结。",
                            )}
                          </p>
                        </div>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            work(async () => {
                              const result = await api("statements", "POST", {
                                period,
                              });
                              setReport(await api(`statements/${result.id}`));
                              await load();
                            }, t("月度账单已生成。版本与金额已固定。"))
                          }
                        >
                          <FileText size={17} />{" "}
                          {t("生成 {period} 账单", { period })}
                        </button>
                      </section>
                      <div
                        className={`statement-layout ${report ? "" : "statement-empty"}`}
                      >
                        <section className="panel statement-library">
                          <div className="panel-heading">
                            <h2>{t("已保存的版本")}</h2>
                            <span className="chip">
                              {t("PDF · 可预览与下载")}
                            </span>
                          </div>
                          {state.statements.map((s) => (
                            <div
                              className={`account-row ${s.id === report?.id ? "statement-selected" : ""}`}
                              key={s.id}
                            >
                              <div className="account-icon">
                                <FileText size={20} />
                              </div>
                              <div>
                                <strong>
                                  {s.period} {t("个人分析账单 · v")}
                                  {s.version}
                                </strong>
                                <p>
                                  {new Date(s.created_at).toLocaleString(
                                    dateLocale,
                                  )}{" "}
                                  {t("· 暂结")}
                                </p>
                              </div>
                              <button
                                className="secondary"
                                aria-pressed={s.id === report?.id}
                                disabled={busy}
                                onClick={() =>
                                  work(async () =>
                                    setReport(await api(`statements/${s.id}`)),
                                  )
                                }
                              >
                                {t("查看")}
                              </button>
                            </div>
                          ))}
                          {!state.statements.length && (
                            <Empty
                              title={t("尚未生成月度账单")}
                              text={t(
                                "选择月份后生成。未确认记录和覆盖缺口会明确列出。",
                              )}
                            />
                          )}
                        </section>
                        {report && state.consents.analysis && (
                          <StatementPreview report={report} />
                        )}
                      </div>
                    </>
                  )}

                  {tab === "assistant" && (
                    <>
                      {state.consents.analysis && (
                        <>
                          <AdvisorInsights
                            key={`advisory-${period}-${selectedCurrency}-${state.ledger_version}-${state.settings_version}`}
                            state={state}
                            currency={selectedCurrency}
                            period={period}
                            onSource={advisorySource}
                            onPropose={advisoryProposal}
                          />
                          <FinancialSandbox
                            key={`lab-${period}-${selectedCurrency}-${state.ledger_version}-${state.settings_version}`}
                            period={period}
                            state={state}
                            currency={selectedCurrency}
                            demo={demo}
                            onSource={advisorySource}
                          />
                        </>
                      )}
                      <details className="analysis-method">
                        <summary>{t("只读分析的范围与依据")}</summary>
                        <section className="panel assistant-intro">
                          <div className="assistant-symbol">
                            <Sparkles size={26} />
                          </div>
                          <h2>{t("理解数字背后的原因。")}</h2>
                          <p>
                            {t(
                              "使用确定性工具读取已授权快照，以事实、计算、假设和可选行动解释。",
                            )}
                            <br />
                            {t(
                              demo
                                ? "分析解释是预设演示脚本，不调用AI模型。"
                                : cloud
                                  ? "规则与模板在私人工作空间运行，不发送至外部模型，不进行训练。"
                                  : "当前是无需LLM的规则与模板基线；无云端传输或训练。",
                            )}
                          </p>
                          <dl className="analysis-basis">
                            <div>
                              <dt>{t("范围")}</dt>
                              <dd>
                                {period} · {selectedCurrency}
                              </dd>
                            </div>
                            <div>
                              <dt>{t("账本版本")}</dt>
                              <dd>
                                {displayAnswer?.scope?.ledger_version ??
                                  state.ledger_version}
                              </dd>
                            </div>
                            <div>
                              <dt>{t("计算版本")}</dt>
                              <dd>
                                {displayAnswer?.scope?.calculation_version ||
                                  state.calc_version}
                              </dd>
                            </div>
                            {displayAnswer && (
                              <>
                                <div>
                                  <dt>{t("分析截止")}</dt>
                                  <dd>{displayAnswer.as_of}</dd>
                                </div>
                                <div>
                                  <dt>{t("快照")}</dt>
                                  <dd>
                                    {displayAnswer.snapshot_id || t("资料不足")}
                                  </dd>
                                </div>
                                <div>
                                  <dt>{t("来源事件")}</dt>
                                  <dd>
                                    {displayAnswer.scope.event_ids?.join(
                                      ", ",
                                    ) || t("没有记录")}
                                  </dd>
                                </div>
                              </>
                            )}
                          </dl>
                        </section>
                      </details>
                      {displayAnswer && (
                        <section className="panel answer">
                          <div className="panel-heading">
                            <h2>{t("分析结果")}</h2>
                            <span
                              className={`chip ${displayAnswer.status === "BLOCKED" ? "amber-chip" : "green-chip"}`}
                            >
                              {
                                {
                                  COMPLETED: t("计算完成"),
                                  DEGRADED: t("资料不足"),
                                  BLOCKED: t("操作未开放"),
                                  CLARIFYING: t("需澄清"),
                                }[displayAnswer.status]
                              }
                            </span>
                          </div>
                          {displayAnswer.mock && (
                            <div className="mock-banner">
                              {t("MOCK · 合成数据分析")}
                            </div>
                          )}
                          {displayAnswer.facts.length > 0 && (
                            <>
                              <h3>
                                {t(
                                  demo
                                    ? "预设市场样例"
                                    : "已取得的公共事实（历史观察）",
                                )}
                              </h3>
                              <ul>
                                {displayAnswer.facts.slice(0, 12).map((f) => (
                                  <li key={f.evidence_id}>
                                    {t(f.label)} ·{" "}
                                    {f.observation_start.slice(0, 7)} ·{" "}
                                    {f.value ?? t("数据缺失")}{" "}
                                    {demo ? t(f.unit) : f.unit} ·{" "}
                                    <a
                                      href={f.source_url}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {t(demo ? "预设来源" : "BLS来源")}
                                    </a>{" "}
                                    {t("· 发布时间未知")}
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                          {displayAnswer.calculations.length > 0 && (
                            <>
                              <h3>{t("确定性计算")}</h3>
                              <div className="answer-metrics">
                                {displayAnswer.calculations.map((c) => (
                                  <div key={c.metric_id}>
                                    <span>{t(c.label)}</span>
                                    <strong>
                                      {c.value ?? t("资料不足")}{" "}
                                      <small>
                                        {c.value !== null &&
                                          (c.unit === "months"
                                            ? t("个月")
                                            : c.unit)}
                                      </small>
                                    </strong>
                                    <details className="metric-basis">
                                      <summary>{t("口径与来源")}</summary>
                                      <p>
                                        {c.metric_id} ·{" "}
                                        {displayAnswer.snapshot_id} ·{" "}
                                        {displayAnswer.as_of}
                                      </p>
                                    </details>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                          {displayAnswer.assumptions.length > 0 && (
                            <>
                              <h3>{t("假设与限制")}</h3>
                              <ul>
                                {displayAnswer.assumptions.map((s, i) => (
                                  <li key={i}>{t(s)}</li>
                                ))}
                              </ul>
                            </>
                          )}
                          <h3>{t("可选下一步")}</h3>
                          <ul>
                            {displayAnswer.actions.map((s, i) => (
                              <li key={i}>{t(s)}</li>
                            ))}
                          </ul>
                          <details>
                            <summary>{t("查看只读工具执行记录")}</summary>
                            {displayAnswer.plan.map((step) => (
                              <p key={step.id}>
                                {step.id} · {step.tool} {t("· 结果引用")}{" "}
                                {
                                  displayAnswer.observations.find(
                                    (o) => o.step_id === step.id,
                                  )?.result_ref
                                }
                              </p>
                            ))}
                            <p>
                              {t("工具调用")}
                              {displayAnswer.tool_calls || 0}
                              {t("/8 · 版本")} {displayAnswer.artifact.id}
                              {t("· 无训练 · 无外部请求")}
                            </p>
                          </details>
                        </section>
                      )}
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>{t("市场背景与证据")}</h2>
                          <button
                            className="secondary"
                            disabled={busy || !state.consents.analysis}
                            onClick={() =>
                              work(async () => {
                                const result = await api(
                                  "market/refresh",
                                  "POST",
                                  {},
                                );
                                await load();
                                notify(
                                  t(
                                    demo
                                      ? "已加载预设市场样例，无外部请求。"
                                      : "已取得BLS官方历史观察，新增{v0}个证据版本。发布时间未知；不视为实时。",
                                    {
                                      v0: result.added,
                                    },
                                  ),
                                );
                              })
                            }
                          >
                            {t(
                              demo ? "加载预设市场样例" : "获取BLS公共历史数据",
                            )}
                          </button>
                        </div>
                        <p className="muted">
                          {t(
                            demo
                              ? "手动预设的虚构指数，不是BLS数据或实时行情。"
                              : "仅请求固定的美国CPI公共系列，不发送私人财务资料。没有有效来源时显示INSUFFICIENT_EVIDENCE；不生成当前股价或收益预测。",
                          )}
                        </p>
                        {state.market_evidence.length > 0 && (
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>{t("观察期 / 地区")}</th>
                                  <th>{t("指标 / 单位")}</th>
                                  <th>{t("发布时间 / 取得时间")}</th>
                                  <th>{t("来源")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {state.market_evidence
                                  .slice()
                                  .sort((a, b) =>
                                    b.observation_start.localeCompare(
                                      a.observation_start,
                                    ),
                                  )
                                  .slice(0, 36)
                                  .map((e) => (
                                    <tr key={e.evidence_id}>
                                      <td>
                                        {e.observation_start.slice(0, 7)}
                                        <small>
                                          {demo ? t(e.geography) : e.geography}
                                        </small>
                                      </td>
                                      <td>
                                        {e.value ?? t("数据缺失")}
                                        <small>
                                          {demo ? t(e.unit) : e.unit}{" "}
                                          {t(
                                            demo
                                              ? "· 虚构指数 · 非实时"
                                              : "· 未季调 · 历史观察",
                                          )}
                                        </small>
                                      </td>
                                      <td>
                                        {t("发布：未知")}
                                        <small>
                                          {t("取得：")}
                                          {new Date(
                                            e.retrieved_at,
                                          ).toLocaleString(dateLocale)}
                                        </small>
                                      </td>
                                      <td>
                                        <a
                                          className="text-button"
                                          href={e.source_url}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          {t(demo ? "预设来源" : "BLS官方系列")}
                                        </a>
                                        <small>
                                          {e.revised_from
                                            ? t("修订版本")
                                            : t("保存版本")}
                                        </small>
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {!demo && (
                          <div className="source-links">
                            <a
                              href="https://www.abs.gov.au/statistics"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t("澳大利亚官方统计 · ABS")}
                              <ArrowUpRight size={15} />
                            </a>
                            <a
                              href="https://www.bls.gov/cpi/"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t("美国消费者价格指数 · BLS")}
                              <ArrowUpRight size={15} />
                            </a>
                          </div>
                        )}
                        <p className="muted">
                          {t(
                            demo
                              ? "演示来源为本地预设，查看样例无需打开外部网站。"
                              : "上述链接是来源入口，不是已获取的市场证据。",
                          )}
                        </p>
                      </section>
                    </>
                  )}

                  {tab === "privacy" && (
                    <>
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>{t(cloud ? "数据处理用途" : "本地处理用途")}</h2>
                          <ShieldCheck size={19} />
                        </div>
                        <div className="privacy-row">
                          <div>
                            <h3>{t(cloud ? "工作空间分析" : "本地分析")}</h3>
                            <p>
                              {t(
                                "预算、目标、风险、日报、月报与分析助手。撤回后停止新的分析与报告读取。",
                              )}
                            </p>
                          </div>
                          <button
                            className={`toggle ${state.consents.analysis ? "on" : ""}`}
                            role="switch"
                            aria-checked={state.consents.analysis}
                            aria-label={t(
                              cloud ? "工作空间分析授权" : "本地分析授权",
                            )}
                            disabled={busy}
                            onClick={() =>
                              work(() =>
                                preview(
                                  "consents",
                                  "consents",
                                  "consents",
                                  "PUT",
                                  {
                                    ...state.consents,
                                    analysis: !state.consents.analysis,
                                  },
                                ),
                              )
                            }
                          >
                            <span />
                          </button>
                        </div>
                        <div className="privacy-row">
                          <div>
                            <h3>
                              {t(
                                cloud
                                  ? "凭证处理（尚未配置隔离处理器）"
                                  : "本地凭证识别",
                              )}
                            </h3>
                            <p>
                              {t(
                                demo
                                  ? "凭证结果是预设演示样例，不分析上传内容。"
                                  : cloud
                                    ? "私有文件先进入隔离区。配置隔离处理器前，不执行云端OCR或文件分析。"
                                    : "在本机处理文字或PNG/JPEG。临时图片处理后删除；确认草稿前复查字段。",
                              )}
                            </p>
                          </div>
                          <button
                            className={`toggle ${state.consents.ocr ? "on" : ""}`}
                            role="switch"
                            aria-checked={state.consents.ocr}
                            aria-label={t("凭证识别授权")}
                            disabled={busy || cloud}
                            onClick={() =>
                              work(() =>
                                preview(
                                  "consents",
                                  "consents",
                                  "consents",
                                  "PUT",
                                  {
                                    ...state.consents,
                                    ocr: !state.consents.ocr,
                                  },
                                ),
                              )
                            }
                          >
                            <span />
                          </button>
                        </div>
                        <div className="privacy-row">
                          <div>
                            <h3>{t("云端模型、银行连接、家庭共享")}</h3>
                            <p>
                              {t(
                                demo
                                  ? "所有市场、模型与识别结果均为手动预设。"
                                  : "未实现或未开放。没有调用外部AI提供方，不收集银行密码。",
                              )}
                            </p>
                          </div>
                          <span className="chip">{t("关闭")}</span>
                        </div>
                      </section>
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>{t("导出与删除")}</h2>
                          <LockKeyhole size={19} />
                        </div>
                        <p className="muted">
                          {t(
                            demo
                              ? "导出与删除只作用于本浏览器的演示样例；不需要访问码，也不影响正式账本。"
                              : "再次输入本地访问码，预览范围并确认。导出含明细；删除不能收回已下载文件或自行备份。",
                          )}
                        </p>
                        {!demo && (
                          <Field
                            label={t(
                              cloud ? "再次验证账号密码" : "再次验证本地访问码",
                            )}
                            type="password"
                            value={reauth}
                            onChange={(e) => setReauth(e.target.value)}
                            autoComplete="current-password"
                          />
                        )}
                        <div className="button-row privacy-actions">
                          <button
                            className="secondary"
                            disabled={busy || (!demo && !reauth)}
                            onClick={() =>
                              work(() =>
                                preview(
                                  "privacy_export",
                                  "all",
                                  "privacy/export",
                                ),
                              )
                            }
                          >
                            <Download size={16} />
                            {t("预览全部数据导出")}
                          </button>
                          <button
                            className="danger"
                            disabled={busy || (!demo && !reauth)}
                            onClick={() =>
                              work(() =>
                                preview(
                                  "privacy_delete",
                                  "all",
                                  "privacy/delete",
                                ),
                              )
                            }
                          >
                            {t("预览全部数据删除")}
                          </button>
                        </div>
                      </section>
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>{t("存储与实现范围")}</h2>
                          <span className="chip">{t("透明说明")}</span>
                        </div>
                        <ul className="privacy-limits">
                          <li>
                            {t(
                              demo
                                ? "演示数据在本浏览器中明文保存；请勿输入真实个人信息或金融资料。"
                                : cloud
                                  ? "云端账本保存在独立用户空间；私有文件经授权后访问。下载的未加密导出由你管理。"
                                  : "本机数据库与导出文件未加密。请使用已加密磁盘和独立系统账户，避免共享或自动云同步目录。",
                            )}
                          </li>
                          <li>
                            {t(
                              "完整删除会清理本应用数据并退出会话；已下载文件、备份和系统快照需自行删除。",
                            )}
                          </li>
                          {[...new Set(state.limitations)]
                            .filter(
                              (s) =>
                                !demo ||
                                ![
                                  "所有市场、模型与识别结果均为手动预设。",
                                  "演示修改仅保存在本浏览器，与正式账本分开。",
                                ].includes(s),
                            )
                            .map((s) => (
                              <li key={s}>{t(s)}</li>
                            ))}
                          <li>
                            {t(
                              demo
                                ? "演示修改仅保存在本浏览器，与正式账本分开。"
                                : cloud
                                  ? "身份验证由托管认证服务处理；退出会话后本设备不能继续访问私人记录。"
                                  : "数据保存在项目的 .local-data/wallet.sqlite3。登录会话12小时有效，服务重启后失效。",
                            )}
                          </li>
                          <li>
                            {t(
                              demo
                                ? "所有市场、模型与识别结果均为手动预设。"
                                : cloud
                                  ? "公开收费、银行接入与外部模型默认关闭，恢复和上线验收完成前仅使用合成数据。"
                                  : "仅监听本机；不适合托管、多用户或真实金融建议生产服务。",
                            )}
                          </li>
                          <li>
                            {t(
                              "应用不托管资金、不支付、不交易。接受规划仅表示保存计划。",
                            )}
                          </li>
                        </ul>
                      </section>
                    </>
                  )}
                </>
              )}
              <footer className="workspace-footer">
                <span>{t("知账 · 清楚记账，谨慎规划。")}</span>
                <span>
                  {t("账本 v")}
                  {state.ledger_version} · {state.calc_version}
                  {t(demo ? "· 浏览器演示沙箱" : "· 本地单用户")}
                </span>
              </footer>
            </div>
          </div>
        </main>
      </div>

      {!masked && (
        <FloatingAgent
          open={agentOpen}
          onOpenChange={setAgentOpen}
          api={api}
          state={state}
          demo={demo}
          cloud={cloud}
          period={period}
          model={commandContext}
          onModel={setCommandContext}
          onRefresh={async (result) => {
            const epoch = privateEpoch.current;
            const operations = (result?.operations || []).filter(
              (op) => op.selected !== false,
            );
            const months = [
              ...new Set(
                operations
                  .map((op) => op.fields?.date?.slice(0, 7))
                  .filter(Boolean),
              ),
            ];
            const targetPeriod =
              result?.applied && months.length === 1 ? months[0] : period;
            if (targetPeriod !== period) setPeriod(targetPeriod);
            await load(targetPeriod);
            if (epoch !== privateEpoch.current) return;
            if (result?.applied) {
              const currencies = [
                ...new Set(
                  operations.map((op) => op.fields?.currency).filter(Boolean),
                ),
              ];
              if (currencies.length === 1) setCurrencyChoice(currencies[0]);
              setFilter("");
              setLedgerScope({});
              const kinds = operations.map((op) => op.kind);
              navigate(
                kinds.some((kind) => kind.includes("investment"))
                  ? "portfolio"
                  : kinds.some((kind) => /budget|goal/.test(kind))
                    ? "planning"
                    : "ledger",
              );
            }
          }}
          onSource={advisorySource}
          onPropose={advisoryProposal}
          onOpenRecord={openResource}
          onAddAccount={() => setAccountOpen(true)}
          onManual={openManual}
          onImport={async (file) => {
            if (file) await fileCsv(file);
            openImport("csv");
            setAgentOpen(false);
          }}
          onNavigate={(target) => {
            navigate(target);
            setAgentOpen(false);
          }}
          currency={selectedCurrency}
          onAnalyze={async (text) => {
            const value = await analyze(text);
            if (value) navigate("assistant");
            return value;
          }}
        />
      )}

      {editorOpen && !masked && (
        <EditorDrawer
          title={t(
            editing?.resource_type === "transaction"
              ? "更正已确认记录"
              : editing
                ? "修改待确认草稿"
                : "添加记录",
          )}
          onClose={() => {
            setEditorOpen(false);
            setMessage(null);
          }}
        >
          <RecordEditor
            value={entry}
            onChange={setEntry}
            accounts={state.accounts}
            transactions={state.transactions}
            source={editing?.source}
            busy={busy}
            onCancel={() => {
              setEditorOpen(false);
              setMessage(null);
            }}
            error={message?.error ? t(message.text) : ""}
            onSave={async () => {
              if (editing?.resource_type === "transaction") {
                await work(async () => {
                  await preview(
                    "correct_event",
                    editing.id,
                    `transactions/${editing.id}/corrections`,
                    "POST",
                    { content: entry },
                  );
                  setEditorOpen(false);
                });
              } else await submitEntry({ preventDefault() {} });
            }}
            submitLabel={t(
              editing?.resource_type === "transaction"
                ? "预览更正"
                : "保存草稿",
            )}
          />
        </EditorDrawer>
      )}
      <nav className="mobile-navigation" aria-label={t("手机主导航")}>
        {baseTabs
          .filter((x) =>
            ["overview", "ledger", "portfolio", "assistant"].includes(x.id),
          )
          .map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-label={t(label)}
              aria-current={tab === id ? "page" : undefined}
              className={tab === id ? "active" : ""}
              onClick={() => navigate(id)}
            >
              <Icon size={20} />
              <span>{t(label)}</span>
            </button>
          ))}
        <button
          aria-label={t("更多模块")}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(!moreOpen)}
        >
          <ChevronRight size={20} />
          <span>{t("更多")}</span>
        </button>
        {moreOpen && (
          <div className="mobile-more-menu">
            {baseTabs
              .filter((x) =>
                ["planning", "reports", "privacy", "settings"].includes(x.id),
              )
              .map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  aria-label={t(label)}
                  onClick={() => navigate(id)}
                >
                  <Icon size={19} />
                  {t(label)}
                </button>
              ))}
          </div>
        )}
      </nav>

      {accountOpen && !masked && (
        <ModalDialog
          titleId="account-title"
          onClose={() => setAccountOpen(false)}
        >
          <div className="panel-heading">
            <h2 id="account-title">{t("添加账户")}</h2>
            <button
              className="icon-button"
              aria-label={t("关闭账户表单")}
              onClick={() => setAccountOpen(false)}
            >
              <X size={20} />
            </button>
          </div>
          {message?.error && (
            <div className="notice error" role="alert">
              {t(message.text)}
            </div>
          )}
          <p className="muted">
            {t(
              "填写开始记账时的余额。此操作创建期初分录，之后通过交易维护余额。",
            )}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              work(async () => {
                await api("accounts", "POST", account);
                setAccountOpen(false);
                await load();
              }, t("账户已添加。"));
            }}
          >
            <div className="form-grid two">
              <Field
                label={t("账户名称")}
                value={account.name}
                onChange={(e) =>
                  setAccount({
                    ...account,
                    name: e.target.value,
                  })
                }
                required
                maxLength={60}
              />
              <Field label={t("类型")}>
                <select
                  value={account.type}
                  onChange={(e) =>
                    setAccount({
                      ...account,
                      type: e.target.value,
                    })
                  }
                >
                  <option value="cash">{t("现金/银行")}</option>
                  <option value="liability">{t("信用卡/贷款负债")}</option>
                </select>
              </Field>
              <Field label={t("币种")}>
                <Currency
                  value={account.currency}
                  onChange={(value) =>
                    setAccount({
                      ...account,
                      currency: value,
                    })
                  }
                />
              </Field>
              <Field
                label={
                  account.type === "cash"
                    ? t("期初现金余额")
                    : t("期初欠款（正数）")
                }
                value={account.opening_balance}
                onChange={(e) =>
                  setAccount({
                    ...account,
                    opening_balance: e.target.value,
                  })
                }
                inputMode="decimal"
                required
              />
              <Field
                label={t("初始余额观察日")}
                type="date"
                value={account.opened_on}
                onChange={(e) =>
                  setAccount({
                    ...account,
                    opened_on: e.target.value,
                  })
                }
                required
              />
            </div>
            <label className="inline-choice">
              <input
                type="checkbox"
                checked={account.mock || false}
                onChange={(event) =>
                  setAccount({
                    ...account,
                    mock: event.target.checked,
                  })
                }
              />
              {t("合成演示账户（MOCK）")}
            </label>
            <div className="form-footer">
              <span>{t("余额请与原始来源核对。")}</span>
              <button className="primary" disabled={busy}>
                {t("创建账户")}
              </button>
            </div>
          </form>
        </ModalDialog>
      )}
      {confirmation && !masked && (
        <ModalDialog
          titleId="confirmation-title"
          onClose={() => {
            backupPassword.current = "";
            setConfirmation(null);
          }}
        >
          <div className="panel-heading">
            <h2 id="confirmation-title">{t("核对并确认")}</h2>
            <LanguageSwitch />
            <button
              className="icon-button"
              aria-label={t("取消确认")}
              onClick={() => {
                backupPassword.current = "";
                setConfirmation(null);
              }}
            >
              <X size={20} />
            </button>
          </div>
          {message?.error && (
            <div className="notice error" role="alert">
              {t(message.text)}
            </div>
          )}
          <div className="confirm-notice">
            <ShieldCheck size={18} />
            <span>
              {t(
                "请核对具体内容。此确认5分钟有效，资料或授权变化后需重新预览。",
              )}
            </span>
          </div>
          {["planning", "consents"].includes(confirmation.purpose) && (
            <details>
              <summary>{t("查看原有设置")}</summary>
              <PreviewRows
                accountsById={accountsById}
                value={
                  confirmation.purpose === "planning"
                    ? state.planning
                    : state.consents
                }
              />
            </details>
          )}
          <DuplicateReview
            reviews={confirmation.challenge.preview.duplicate_review}
            resolutions={confirmation.duplicate_resolutions}
            onChange={(resolutions) =>
              setConfirmation({
                ...confirmation,
                duplicate_resolutions: resolutions,
              })
            }
            accounts={accountsById}
          />
          {previewContent(confirmation.challenge.preview)}
          <div className="form-footer">
            <button
              className="secondary"
              onClick={() => {
                backupPassword.current = "";
                setConfirmation(null);
              }}
            >
              {t("取消")}
            </button>
            <button
              className={
                confirmation.purpose === "privacy_delete" ? "danger" : "primary"
              }
              disabled={
                busy ||
                !duplicateReviewComplete(
                  confirmation.challenge.preview.duplicate_review,
                  confirmation.duplicate_resolutions,
                )
              }
              onClick={() => work(executeConfirmation)}
            >
              {confirmation.purpose === "privacy_delete"
                ? t("确认删除全部本地数据")
                : t("内容无误，确认")}
            </button>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}
