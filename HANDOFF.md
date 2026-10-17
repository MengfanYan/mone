# Financial Agent 文档更新包 · UX 1.0

日期：2026-10-14（Australia/Sydney）。这是针对现有项目的执行文档，不是应用代码更新。

## 文件

- [docs/UX_EXECUTION_PLAN.md](docs/UX_EXECUTION_PLAN.md)：改造主文档，含当前差异、UI、文本CRUD、凭证、编辑联动、曲线、接口/迁移、任务和25项验收。
- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)：保留项目现有实现状态，追加全部待实施改造。
- [CLAUDE.md](CLAUDE.md)：保留原约束，新增第14–15节执行要求。

## 使用

将以上3个Markdown按包内路径复制到 financial-agent 项目；只新增/替换文档。HANDOFF本身可留作交接记录。这个包未覆盖原项目，也不包含任何源代码、数据库、访问码或私人金融资料。原README、API、RUNNING、DEMO、VALIDATION、ML_ENGINEERING继续留在项目。

IMPLEMENTATION/CLAUDE里原有相对链接在原项目上下文中解析；包内没有重复拷贝整个项目。开始后续编码前先读主文档与原AGENTS规则。本轮源码、文档/API与三个已有Demo截图作了只读核对；没有Live浏览器全量验证或重跑原应用测试。

改造需做到：无平台接入可文本新增/查找/修正/移除个人记录；消费/银行/基金截图能提取可纠正条目；7页摘要优先、图标可定位、关系图可下钻；每项投资有真实历史收益曲线及数据不足状态。原不可变账本、确认、币种与隐私边界继续有效。

## 2026-10-15 实施交接

已按文档落实本地UX 1.0源码、schema 2、命令/凭证/稳定投资历史、双语按需编辑、摘要图表和Demo适配。API、RUNNING、DEMO、IMPLEMENTATION与ADR 002已同步。正式私有数据库未用于开发，所有验证使用合成临时数据。

当前证据见[UX验证](docs/UX_VALIDATION.md)：正式浏览器22项、Demo浏览器21项、服务59项、Demo逻辑20项、PDF2项、双构建、E0和三图实际OCR通过。此前额度阻塞已解除，八个宽度、中英文、键盘、横屏/短窗口、200% CSS缩放、PDF、离线和隐私已实际验收。新增权限/CSP/锁定及在途响应保护，存储边界见[SECURITY](docs/SECURITY.md)。用户定位研究、通用500图OCR、完整无障碍与托管安全仍未验收。上方文档包说明为历史。


## 六图终端界面最终交接 · 2026-10-15

已完成六图样式和可操作补全：八页深色终端、Cmd/Ctrl+K、资产/现金流图、来源框定位、凭证PDF、筛选/选中CSV、资产权重工作表、价格风险实验、蒙特卡洛规划、安全/Settings、本地词法资料库及可选逐次确认的Responses适配。正式API保留，Demo保持离线隔离；没有新增LangChain/LangGraph/外部向量数据库或数据库表。

当前实际结果：正式浏览器26项、Demo31项执行通过，11项重复手机矩阵有意跳过；168项宽度/双语/编辑器检查、24项长内容、18项短窗口、八页200% CSS zoom和591个纯色文本样本；Python66、Demo逻辑27、PDF2、双构建、E0 200通过。最新证据以[UX验证](docs/UX_VALIDATION.md)和 `reports/terminal-ui-validation.json` 为准，之前22/21/59等数字为历史基线。无真实客户账本、密钥或付费模型请求。

工作库仍明文；只有可选下载备份进行AES-GCM加密，验证不等于完整恢复。云解释仍需用户配置服务器环境密钥并逐次检查payload；慢请求不阻塞锁定，响应后再次检查身份/授权/版本。无银行或交易执行能力。见[ADR 003](docs/adr/003-terminal-reference-workspace.md)及[SECURITY](docs/SECURITY.md)。

2026-10-15 follow-up — Floating Agent / Live defaults

- Replaced the default right activity column and module-inline command area with one closed-by-default floating Agent icon and a nonmodal, scrollable task popup on all authenticated modules. Shared command context, review/nonce/version/idempotency controls, record editors, PDF evidence and analysis APIs remain intact. Read-only analysis questions can route automatically; API replies/suggestions appear inside the popup. Confirmed writes refresh the relevant module and select a unique task month/currency. Lock clears the task; screen mask removes the popup.
- Live financial scenario controls are blank and produce no projection until an explicit successful authenticated/consented `/api/terminal/simulation` request. Added bounded, read-only Python simulation with no saved assumptions/ledger writes and no synthetic error fallback. Demo keeps illustrative browser assumptions.
- Removed synthetic account/transaction creation from the Live UI. `/demo` remains isolated. Updated old browser tests to create explicit API fixtures instead of depending on the removed product seed button. Default English is checked for visible text, placeholders and labels across all eight fresh Live modules. Stored user text/language preferences and previously saved MOCK records are preserved.


## 2026-10-15 审查修复与云端基础

用户选择免费主流平台优先，收费保持关闭。已修复审查F01–F18，新增独立Cloud staging、Supabase SSR认证/MFA接入、FastAPI、PG/RLS/精确平衡约束、邀请准入、设备撤销、归档迁移、私人规则/反馈、隔离文件接收、独立签名删除控制与恢复围栏。领域服务共用，本地/Demo保留。

当前以 [STRATEGY_IMPLEMENTATION](docs/STRATEGY_IMPLEMENTATION.md)、[CLOUD_RUNNING](docs/CLOUD_RUNNING.md) 和 [AUDIT_REMEDIATION](docs/AUDIT_REMEDIATION.md) 为准。真实Supabase、Docker/Render、完整数据库+对象恢复、解析/自动清扫Worker、Auth账号彻底删除、法律/运营及订阅流程未通过真实发布验收；公众注册、银行、外部模型和收费继续关闭。代码/合成测试不可改写为已上线SaaS。

最终回归：本地浏览器40、Demo执行39（重复矩阵11跳过）、云端前端8、云端真实PG32、本地Python72、Demo逻辑32、PDF2、恢复标记2均通过；三套生产构建、ESLint、E0 200及实际TLS/ASGI/BFF启动通过。首次登录检查的输入清空竞态已修复，320px导航保持完整文字。机器结果、截图及源码哈希见[最新验收](docs/UX_VALIDATION.md)。

## 2026-10-16 UI规范与站内通知

按用户Google设计文档统一深色空间、微光、字重、胶囊状态、键盘/悬停与缩放，字体本地托管。增加首页通知、顶部未读、已读保存、三类记录来源与精确跳转；不接通银行/行情/系统推送。手机通知前置且助手进入顶栏，桌面助手预留边距。新状态存于既有用户settings，导出/删除覆盖，不改变金融版本；本地/云端接口保留、Demo仍离线。详细契约见[UI_NOTIFICATIONS](docs/UI_NOTIFICATIONS.md)。

当前验收：本地浏览器42、Demo执行45（11项明确跳过）、云端界面8、本地Python77、云端PG33、Demo逻辑35、PDF2、恢复标记2、ESLint、三套构建和E0 200均通过。168项宽度/双语/编辑器、24项长内容、18项短窗口、200% CSS缩放及1111次纯色文字测量通过。旧计数为历史；当前见[UX_VALIDATION](docs/UX_VALIDATION.md)。

## 2026-10-16 布局对齐修复

根据用户截图将月份、币种、按钮改为统一44px基线；设置偏好与投资分布铺满，指标/状态换行后填充末行，奇数投资卡占满余行。投资卡通过子网格与稳定筛选区对齐标题、操作、金额、图表和来源；图表限制140–240px，避免整行卡过高。仅调整共用CSS和展示结构，API/账本/存储不变。

最终Demo浏览器45项通过（11项重复矩阵跳过）、32项对齐/行填充和1/3张卡专项通过；168项八宽度/双语/编辑器、24项长内容、18项短窗口、200% CSS zoom、1115次纯色对比度、ESLint/Prettier及正式/Demo/云端三构建通过。旧业务测试计数保留为历史，本轮不重复执行未修改的Python/PG套件。[当前验收与截图](docs/UX_VALIDATION.md)。3105独立Demo预览已重启。

## 2026-10-16：任务工作台与确定性规划交接

已实现三模式工作台、指令中心、首页三列指标及来源公式、诊断转预算确认/还款草稿、退款关联候选、手动汇率折算、现金流沙盒、订阅候选、结余配置试算和Markdown简报。用户选择手动汇率与仅浏览器本地识别；本地识别不可用时不回退云服务，关闭窗口即中止。正式API/确认链和Demo隔离保留，收费关闭。

使用说明见 [ADVISORY_WORKSPACE](docs/ADVISORY_WORKSPACE.md)，最终测试及先前测试等待竞争修复的完整记录见 [UX_VALIDATION](docs/UX_VALIDATION.md)。预览 http://localhost:3105/demo 已更新；用户原开发服务未停止。新增输入和试算均为组件会话内存；暂无模型训练、银行执行或自动汇率请求。
