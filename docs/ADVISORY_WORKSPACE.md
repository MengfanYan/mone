# 任务工作台与财务规划实验室

更新：2026-10-16。适用于 Local、Cloud 和隔离的 Demo。默认英文，界面支持中英文。以下为已实现的确定性规则与交互，不代表已接入通用金融大模型或银行执行服务。

## 入口与三个模式

顶部指令中心支持 Cmd/Ctrl+K：可导航模块、带入自然语言任务、进入凭证工作台或只读诊断。页面快捷入口和助手图标进入同一任务工作台。

- **Record & search**：紧凑输入、账户上下文、本地语音、结构化候选及字段编辑。Enter 只生成预览；Add to Review Queue 保存草稿；实际入账仍需审阅及确认。示例：`Harbor Coffee 18.50 AUD 2026-09-30, and check dining budget`。草稿不会提前计入预算实际支出。
- **Evidence & screenshots**：小票、银行流水、投资观察类型按钮；拖拽或选择 PNG/JPEG、PDF、CSV；折叠的原文粘贴区。CSV 转入原有逐行导入工作流，PDF 使用现有本地 PDF 解析/渲染链路。来源与提取候选并排，支持定位原文/文字框。Demo 的样例明确标为预设，任意图片不会伪装为真实识别结果。
- **Read-only analysis**：当前期间和币种的预算、现金与负债、持仓观察三张诊断卡；来源跳转；上月餐饮对比、65%储蓄率试算、同日同账户同商户同金额的疑似重复扣款检查；底部独立追问框。结果依赖分析授权及快照版本。

OCR 只显示实际提取器提供的原始文字框分数，明确标记未校准；不宣称“98%财务正确率”。没有分数时只显示需复核，不虚构置信度。退款草稿可展示同商户、币种、账户且可退余额足够的原消费候选，选择后打开草稿编辑器，最终入账仍经过原有确认流程。

## 诊断转为可核对行动

首页预算通知的 **Simulate a budget rebalance** 打开只读诊断。选择转出类别和金额后，检查转出类别的未使用额度，预算总额保持不变。再次读取当前授权与版本后调用原 `confirmation-challenges` / `planning` 接口，用户看到新旧设置并最终确认；这不划转银行资金。

**Draft payoff transfer** 要求明确选择现金账户、负债账户、金额和记录日期；金额必须为正且不超过两账户可用余额。结果打开 `debt_principal` 草稿编辑器，先保存草稿，再按现有流程入账。它记录已核实的还款，不执行银行付款。界面提醒核对预留资金、到期日与还款条款。

来源按钮定位原交易或持仓。未实现的模型归因不会以事实呈现；持仓占比小、价格下跌本身不构成低风险或买入理由。

## Analysis → Financial planning lab

| 工具 | 输入与结果 | 边界 |
| --- | --- | --- |
| Subscription radar | 相同商户/账户/金额的支出，至少三个独立日期、最近两段27–32天间隔，才能估算月度周期；名称仅生成待核对候选 | 提示快照日期起三天内的预计扣款；不是后台推送，也不是已确认合同，不自动计入现金流 |
| Cash-flow sandbox | 已记录现金、同币种已批准预留；用户明确填写尚未支付的收入/支出及月度重复计划；假设消费金额/滑块；三个月余额 | 不包含未知账单、未填义务、市场收益；正值不保证可安全消费；不会修改账本 |
| Unified net worth | 原币种现金 + 已记录投资 − 已记录负债；逐币种手动汇率、有效日期和来源；可选比较汇率 | 无实时联网汇率；缺估值/汇率时不显示完整总值；前后汇率差仅是在**同一持仓**下的FX影响，不冒充真实历史净值归因 |
| Cash to assets | 用户选定已有投资、输入假设配置金额；核对已记录结余与预留后的现金；显示前后值 | 不下单、不预测收益、不因跌价推荐买入；未含费用税务 |
| Monthly brief | 已确认收支、利息、预算和事件ID，支持来源跳转及Markdown下载 | 确定性叙事，不编造因果；不含草稿或未记录资产负债 |

金额使用币种最小单位整数运算；手动汇率最多8位小数，折算按目标币种精度四舍五入。原币种账本保持独立。

## 本地语音与数据

用户明确点击 **Local dictation** 后才检测浏览器的 `SpeechRecognition.available({processLocally:true})`。只有本地语言包已经可用且支持 `processLocally` 时才启动，并强制设为 `true`。不支持/语言包未就绪时提示改为输入或粘贴；不会使用云语音后备，也不会自动下载语言包。关闭窗口、切换模式、失焦、锁定或遮罩会中止识别。真实麦克风/语言包效果取决于用户浏览器，自动测试只验证能力分支和停止行为。

浏览器能力依据：[MDN processLocally](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally)、[MDN available](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/available_static)。两者目前均为实验性接口。权限策略允许同源麦克风及本地识别能力，操作系统/浏览器仍要求用户授予麦克风权限。

手动汇率、未支付计划及配置试算只保留在 React 内存中；页面模块卸载、切换期间/币种/版本、遮罩或锁定后重置。不会写入正式浏览器 localStorage、Cookie、外部模型或训练集。主动下载的简报由用户自行保管；正式账本仍通过原认证 API 与安全确认链路存储。Demo 只保存合成演示数据。

## 验证与复跑

- 纯函数：`node --test tests/demo/advisory.test.mjs`
- 新交互：`npm run test:e2e:demo -- --grep 'task modes|budget proposal|manual valuation|on-device speech'`
- 全部页面矩阵：`npm run test:e2e:demo`
- 正式 API 交互：`npm run test:e2e`（独立临时合成数据库）

先执行 `npm run build` / `npm run demo:build` / `npm run cloud:build`。测试脚本使用专用端口，不要改为客户的真实账本路径。详细最终结果见 [UX_VALIDATION.md](UX_VALIDATION.md)。
