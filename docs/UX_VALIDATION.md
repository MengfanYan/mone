# 任务工作台与规划工具 · 最新验收

更新：2026-10-16（Australia/Sydney）。本次实现与边界见 [ADVISORY_WORKSPACE.md](ADVISORY_WORKSPACE.md)。后续布局、通知及终端章节为历史版本的验证记录。

- 首页三项核心指标在宽工作区等宽并排；资产微型构成、月度目标所需存款与结余比值、可展开计算依据。目标进度是结余/所需月存款的比较，不表示实际已转存目标账户。
- 指令中心连接三个独立任务模式；凭证上传/原文/候选、只读诊断及来源跳转均可操作。录入仅预览，保存草稿与最终入账分别确认。
- 预算调平预览与确认、还款草稿、退款关联候选、手动汇率、三个月现金流、配置试算、订阅候选、Markdown简报；金额为确定性运算，无自动银行交易。
- 语音严格限定支持本地识别的浏览器，转写只填入文本；关闭任务窗口即中止，无云识别后备。

| 检查 | 本次结果 |
| --- | --- |
| Demo完整浏览器 | **53通过，0失败**；11个重复手机矩阵有意跳过。[日志](../reports/advisory-demo-browser.log) |
| 最终变更补测 | Demo **10/10**，包括速记+预算、多币种修正、调平确认、还款编辑、手动汇率、简报、强制本地语音和关闭中止。[日志](../reports/advisory-demo-targeted.log) |
| Live浏览器 | 完整回归40通过、2条共享测试等待竞争；去除重复的预览点击后，受影响流程及桌面/手机版共**6/6通过**。包括真实中文OCR、不可变账本修正和Agent交互。保留[完整运行](../reports/advisory-live-browser.log)与[修复后复跑](../reports/advisory-live-targeted.log)，不将先前失败隐藏为一次全绿运行 |
| Cloud浏览器 | **8/8通过**，登录/MFA/恢复、双语设置及过期会话私密DOM清除。[日志](../reports/advisory-cloud-browser.log) |
| 自适应 | 八宽度320–1920px、中英文及编辑器共**168项**；24项超长内容、18项短窗口及八模块200% CSS缩放通过。修正了长商户名称撑宽分析卡片的问题 |
| 业务与逻辑 | Python **77/77**；Node Demo逻辑 **43/43**，含新增8项授权/版本范围、预算总额、还款边界、JPY/KWD折算、重复计划、退款及来源测试。[Python](../reports/advisory-python.log)、[Node](../reports/advisory-logic.log) |
| 构建与静态检查 | Local、Demo、Cloud生产构建和ESLint通过。[构建](../reports/advisory-live-build.log)、[Demo](../reports/advisory-demo-build.log)、[Cloud](../reports/advisory-cloud-build.log)、[lint](../reports/advisory-lint.log) |

[机器摘要与文件哈希](../reports/advisory-validation.json)。已目视核对[桌面首页](../reports/advisory-desktop-dashboard.png)、[凭证工作台](../reports/advisory-desktop-evidence.png)、[手机凭证](../reports/advisory-mobile-evidence.png)、[手机现金流](../reports/advisory-mobile-cash.png)。专用预览已重启到最终构建：<http://localhost:3105/demo>，未停止用户已有3000/3001服务。

测试仅使用合成数据与临时数据库，无真实客户账本、收费模型或银行调用。浏览器范围为Chromium及手机尺寸模拟；实际麦克风、语言包、Safari/Firefox和生产托管仍需设备/部署环境验收。语音自动化验证配置分支，不声称完成真实声音识别测试。收费保持关闭，安全存储上线条件未变。

---

# 上一轮：布局对齐修复

更新：2026-10-16（Australia/Sydney）。针对用户三张截图修正共用顶部控件、卡片横向对齐和末行留白；[布局规则](UI_NOTIFICATIONS.md#2026-10-16-布局对齐补充)。后续通知交付章节为此前版本的功能验证记录；以下为本次最终构建的复核。

- 月份、币种及同行按钮均为44px，月份说明不再拉偏控件。窄屏合理换行，按钮移至下行时铺满。
- 设置偏好和投资分布使用完整宽度；指标和服务状态换行后填满末行。双列投资/关系区域末张卡补齐整行，DOM与键盘顺序保持。
- 同排投资卡标题、操作区、金额、图表和来源入口对齐；单点筛选禁用而保留位置。图表高度限制在140–240px，单卡不因铺满而产生过高显示区。

| 验证 | 结果与证据 |
|---|---|
| Demo浏览器回归 | **45项通过，0失败、0不稳定**；11项重复手机矩阵明确跳过；[最终报告](../reports/layout-alignment-browser.json) |
| 控件/卡片专项 | 八模块 × 320/768/1440/1920px，**32项通过**；可见控件同高对齐、行填充与投资卡内基线均通过；[几何结果](../reports/layout-alignment-geometry.json) |
| 奇数卡片 | 独立合成存储模拟**1张/3张**投资卡，末行铺满且与上行无重叠；[结果](../reports/layout-alignment-odd-cards.json) |
| 八宽度与双语 | 320、360、390、640、768、1024、1440、1920px，含编辑器共**168项通过**，页面横向越界/字段相交/金额断行均为0；另24项长内容、18项短窗口通过 |
| 缩放与颜色 | 八模块200% CSS zoom；**1115次**纯色文本测量、最低5.59:1、0项低于对应阈值；[测量](../reports/ux-contrast.json) |
| 三套构建 | [正式版](../reports/layout-alignment-live-build.log)、[Demo](../reports/layout-alignment-build.log)、[云端](../reports/layout-alignment-cloud-build.log)均通过 |
| 静态检查 | ESLint及三个改动源文件的Prettier检查通过；[lint](../reports/layout-alignment-lint.log) |
| 机器摘要 | [结果、限制和改动文件哈希](../reports/layout-alignment-validation.json) |

截图已目视核对：[设置桌面](../reports/aligned-1440-settings.png)、[投资桌面](../reports/aligned-1440-portfolio.png)、[设置手机](../reports/aligned-320-settings.png)、[三张投资卡](../reports/aligned-investments-3.png)。独立预览已重启至最终构建：<http://localhost:3105/demo>。

本次仅改视觉样式和投资卡展示结构，业务API与存储不变；未重跑未修改的Python/PG业务套件。测试仅使用合成数据，无个人账本读取、付费模型或外部API调用。范围仍是Chromium和手机尺寸模拟，非真实Safari/Firefox及所有硬件验收；200%为CSS zoom，渐变/SVG/PDF不计入数值对比度。

# 上一轮：统一UI与首页通知

更新：2026-10-16（Australia/Sydney）。按用户提供的[设计规范](https://docs.google.com/document/d/1vui69964o-XeQBrXaFc0R7X5ze4BRQXLaNO0ld1V9Rw/edit)统一八模块、登录/恢复、弹窗和云设置；新增首页通知、顶部未读、详情/来源跳转及已读保存。[实现与来源规则](UI_NOTIFICATIONS.md)。以下是最终构建的实测，后续章节为历史记录。

| 检查 | 本轮结果 / 证据 |
|---|---|
| 本地版浏览器 | **42/42通过**，桌面/手机、0失败、0重试不稳定；[报告](../reports/notification-browser-live.json) |
| Demo浏览器 | **45项执行通过**，0失败、0重试不稳定；11项重复手机矩阵明确跳过，八宽度矩阵由桌面项目逐项执行；[报告](../reports/notification-browser-demo.json) |
| 云端前端浏览器 | **8/8通过**，桌面/手机及320/768/1440px双语；Auth/Storage为合成响应；[报告](../reports/notification-browser-cloud.json) |
| 布局 | 320、360、390、640、768、1024、1440、1920px，八模块双语与编辑器共**168项**；页面横向越界与字段相交均为0；另**24项**长文本/极端金额、**18项**横屏/短窗口通过 |
| 字体/缩放/颜色 | 本地Inter/JetBrains Mono；八页200% CSS zoom通过；**1111次**纯色背景文字测量，最低**5.59:1**、0项低于对应阈值；[测量](../reports/ux-contrast.json) |
| 本地业务/安全 | **77项Python**、**35项Demo逻辑**、**2项PDF**、**2项恢复标记**通过；ESLint及本地/Demo构建通过；[检查](../reports/notification-check.log) |
| 云端数据库/API | 临时真实PostgreSQL，**33/33通过**，含通知与已读的两用户隔离；[日志](../reports/notification-cloud-integration.log) |
| 云端构建 | `.next-cloud`生产构建通过；[日志](../reports/notification-cloud-build.log) |
| E0 | **200/200通过，50条轨迹**；[日志](../reports/notification-evaluation.log) |
| 汇总 | [机器结果、环境与源码哈希](../reports/notification-ui-validation.json) |

新增专项验证了：正式版空数据、草稿不触发工资通知、API确认后才显示、刷新同步实际页面快照、预算精确金额/原币种、价格缺数与同日修订、冲正后通知撤销、跨月、单条记录/类别/投资跳转、已读持久化、后台撤回分析、隐私遮罩、离线导航，以及已读操作不使财务确认失效。源记录进入页面前重新请求实际状态。

手机通知在指标卡之前，助手图标放入顶栏；桌面助手保留角落入口并预留边距。修复了旧浅色样式残留的低对比文字、选中导航悬停颜色，以及长投资卡片悬停位移造成的按钮点击不稳定。长内容和固定导航滚动后的关键操作均完成回归。

截图已目视核对：[桌面首页与通知](../reports/notifications-desktop.png)、[手机通知](../reports/notifications-mobile.png)、[投资页](../reports/ux-first-screen-1920-portfolio.png)。所有数据均为合成资料；未读取个人SQLite、用户密钥或客户文件，未调用付费模型。

范围：本机Chromium及iPhone尺寸/触控模拟，尚非真实Safari/Firefox或全部硬件验收。200%使用CSS zoom；数值对比度不包含渐变、SVG和PDF画布，另作截图目视检查。本轮没有部署或实连Supabase，云端发布门槛继续见[策略矩阵](STRATEGY_IMPLEMENTATION.md)。通知是站内保存记录提示，没有实时银行/行情连接或系统推送。

复跑：`npm run check`、`npm run test:cloud`、`npm run eval`、`npm run test:e2e`、`npm run test:e2e:demo`、`npm run test:e2e:cloud`。本地/Demo/云端各自输出至独立test-results子目录，避免轨迹互相清理。`reports/notification-*.json`为本轮证据。

## 2026-10-15历史：审查修复与云端基础

记录：2026-10-15（Australia/Sydney）。本节是当轮历史基线，不代表2026-10-16更新后的数量。旧浏览器审批额度阻塞当时已解除，浏览器命令实际执行完成。测试只使用合成资料与临时库，未读取个人SQLite、真实密钥或客户文件，未调用付费模型。

| 检查 | 最终结果与证据 |
|---|---|
| 本地版浏览器 | **40/40通过**，桌面/手机、0失败、0重试不稳定；[报告](../reports/review-browser-live.json) |
| 离线Demo浏览器 | **39项通过**，0失败、0重试不稳定；11项重复手机尺寸矩阵明确跳过，尺寸矩阵在桌面项目中逐项执行；[报告](../reports/review-browser-demo.json) |
| 云端前端浏览器 | **8/8通过**，桌面/手机、320/768/1440px双语、MFA/设备/规则/文件/迁移及过期清屏；[报告](../reports/cloud-browser.json)。Auth和Storage响应为合成桩 |
| 自适应 | 320、360、390、640、768、1024、1440、1920px，八模块双语及编辑器共**168项**；页面横向溢出及字段相交均为0；另有**24项**长文本/极端金额、**18项**横屏/短窗口检查 |
| 缩放与颜色 | 八页200% CSS zoom通过；**498次**纯色背景文字测量，最低**5.59:1**；[测量](../reports/ux-contrast.json)。渐变、SVG和PDF未纳入该数值 |
| 领域与安全 | **72项Python**、**32项Demo逻辑**、**2项PDF**、**2项恢复标记**通过；ESLint及本地/Demo生产构建通过；[检查日志](../reports/review-check.log) |
| 云端数据库 | 临时真实PostgreSQL，**32/32通过**：两租户隔离、连接复用、并发幂等/预算、精确分录约束、多币种退款/冲正迁移、删除恢复与密钥轮换；[日志](../reports/cloud-integration.log) |
| 实际云端启动 | 临时证书、verify-full TLS数据库、真实ASGI+BFF启动/健康/未登录拒绝通过；同上日志。无真实Auth请求；Docker镜像未实际运行 |
| 云端构建 | `.next-cloud`生产构建通过；[日志](../reports/cloud-build.log) |
| E0 | 本轮重新执行，**200/200通过，50条轨迹**；[日志](../reports/review-evaluation.log) |
| 依赖公告 | `npm audit --omit=dev`：当前生产依赖已知漏洞**0**；[快照](../reports/review-dependency-audit.json)。不等于独立安全审计 |
| 复核摘要 | [机器结果与源码SHA-256](../reports/review-cloud-validation.json) |

本轮修复 [F01–F18](AUDIT_REMEDIATION.md)，保留PDF预览。额外修复首次会话检查较慢时清空正在输入的访问码、过期响应影响新会话、子模块会话失效后仍显示私人DOM的问题。三套Playwright输出目录独立，防止并行验收互相删除轨迹。

实际Chrome已目视检查桌面首页和320px分析页；最终截图另经本机图片查看核对。手机测试使用Chromium触控/尺寸模拟，未覆盖真实Safari、Firefox及所有设备；CSS zoom不是原生浏览器缩放或完整无障碍认证。截图：[桌面](../reports/ux-first-screen-1920-dashboard.png)、[手机分析](../reports/ux-first-screen-320-analysis.png)。

云端仍处于合成数据开发验证阶段。真实Supabase注册/邮件/恢复、Storage权限、云数据库+对象+密钥完整恢复及运营发布门槛尚未验收；[未配置预检查](../reports/cloud-preflight-unconfigured.json)明确返回`public_release_ready=false`。收费依用户要求保持关闭。代码实现与外部条件逐项见[策略矩阵](STRATEGY_IMPLEMENTATION.md)，配置和复跑见[Cloud运行](CLOUD_RUNNING.md)。

以下为上一轮悬浮Agent交付时的历史快照；其测试数量和“尚未实现”范围不代表本轮新增云端代码的状态。

## 历史快照：悬浮 Agent 与正式版空数据

更新：2026-10-15（Australia/Sydney）。当前深色终端代码、正式模式和独立Demo均已实际验收；此前浏览器额度阻塞已解除。所有数据与凭证均为合成样例，没有使用个人SQLite、真实密钥或付费模型请求。

本轮按用户提供的六张图实现统一界面及可操作模块，并保留原八个功能页。原UX 1.0设计仍见[执行方案](UX_EXECUTION_PLAN.md)；本轮实现边界见[ADR 003](adr/003-terminal-reference-workspace.md)。旧 `ux-browser-*.json` 是终端改造前的历史基线；当前以本页和 `agent-browser-*.json` 为准；`terminal-*.json` 保留为上一轮基线。

## 实际结果

| 检查 | 当前结果 / 证据 |
|---|---|
| 正式浏览器 | **32/32通过**，桌面/手机，0失败、0重试不稳定；[机器报告](../reports/agent-browser-live.json) |
| Demo浏览器 | **31项执行通过**，0失败、0重试不稳定；11项手机重复矩阵有意跳过，对应明确尺寸的桌面矩阵已执行；[机器报告](../reports/agent-browser-demo.json) |
| 八模块双语与编辑器 | 320、360、390、640、768、1024、1440、1920px，共 **168项**布局检查；页面不横向越界、字段不相交、主要操作可实际命中，月份保持可读、金额整数/小数不拆行 |
| 长内容 / 极端金额 | **24项**：长账户/商户/投资名称、999999999999.99草稿、手机/平板/桌面；`ux-responsive-long-content.json` |
| 横屏 / 短窗口 | **18项**：844×390、1280×600及长编辑器，导航与操作可达；`ux-responsive-short-height.json` |
| 缩放 / 对比度 | 8页200% CSS zoom无页面横向溢出；**401次**纯色背景文本测量，普通文字最低 **5.59:1**；[测量报告](../reports/ux-contrast.json) |
| Python业务 / 安全 | **67/67通过**，含配置/文档/nonce/私网阻断/备份导出删除覆盖、慢模型期间锁定及返回后的再次验证 |
| Demo逻辑 / PDF | **27/27** Node逻辑；**2/2** 双语PDF字体、分页、精确金额回归 |
| ESLint / 双构建 | 通过；正式 `.next`、Demo `.next-demo` 优化构建均通过 |
| E0 | 原E0基线 **200/200通过**、50条轨迹，本轮未重跑独立评测；原只读工具权限未扩大 |
| 最终跳转调整后的补测 | 正式版 **8/8**，Demo **4/4**，均覆盖桌面和手机，0失败；[正式补测](../reports/agent-final-live.json)、[Demo补测](../reports/agent-final-demo.json) |
| 汇总 | [本轮机器摘要](../reports/agent-ui-validation.json) |

环境为本机Chromium；手机为iPhone 13触控/尺寸模拟，另有上述宽度、横屏与短窗口。未验证真实Safari/WebKit、Firefox、所有硬件和浏览器缩放方式。200%测量使用CSS zoom；透明PDF选择层、SVG、画布和可见渐变不纳入纯色文本测量，另作目视核对。这不是整站无障碍认证或独立渗透测试。

## 六张图对应的可操作功能

| 参考模块 | 当前实现与验证 |
|---|---|
| Dashboard | 深色分层面板、记录资产/当月收支/复核队列、资产环图、已确认周收支曲线、本地规则提示和默认收起的悬浮 Agent 任务弹窗；不同币种分开 |
| Billing / Transactions | 原文与凭证图并列、Tesseract文字框与候选定位、字段编辑/确认；日期/类型/搜索筛选、精确金额排序、选中CSV下载；文本PDF和正式单页扫描PDF已实际上传提取 |
| Portfolio | 资产分布与投资历史并列、估值/收益历史、目标权重100%工作表和审阅导出；单位价格风险实验能计算历史损失分位数/间隔波动，证据不足保持未知；不下单 |
| Planner | 可编辑年龄、期限、本金、月投入、目标、收益、通胀与波动假设；固定种子模拟、5–95百分位、模型达标率与90%模型月投入、Demo重置与实时示意；正式版假设默认空白，显式请求本地计算API后显示结果；JSON导出，不写真实预算/账本 |
| Security | 屏幕遮罩、实际能力矩阵/审计链、错误链提示、访问码再验证后加密导出、错误密码/篡改拒绝、本地备份验证；明确运行库未加密 |
| Settings | 参数保存/刷新持久、本地TXT/MD/文本PDF资料库和引用检索、真实密钥存在状态、逐次完整云请求预览；Demo只返回手写预设，正式服务端接口保留 |

保留Statements直接PDF预览、翻页、缩放和下载，以及独立E0分析页。全局搜索支持Cmd/Ctrl+K，原生模态有焦点隔离、Tab循环和Escape关闭；语言切换保留原有编辑值和报表固定快照。截图已目视核对宽/窄屏、资产/规划/设置、PDF、来源定位和历史曲线。

## 本轮交互与正式版专项

- 一个 Agent 图标覆盖全部已登录模块，首次保持关闭；移除了常驻右栏和各页重复输入区。弹窗可输入、预览、修正、确认任务；只读分析问题可自动路由并显示API返回的计算和建议。
- 正式变更依旧经过一次性确认。完成后刷新实际API状态，并跳转对应模块；单一月份/币种任务自动切换范围。收起/重开保留任务，Escape返回图标焦点；隐私遮罩移除弹窗、锁定清理任务。
- 正式空库的八模块可见文案、placeholder和aria-label已检查，除语言按钮“中文”外无中文系统文案。规划假设全部为空、没有预生成结果；输入、成功计算、参数变化作废及API失败无预设回退均覆盖。
- Live 不再提供创建合成账本的快捷入口，产品演示通过独立 `/demo`。以前保存的MOCK记录继续标识，原始用户数据不因翻译/界面更新而改写或删除。
- 悬浮窗额外覆盖320、375、768、1280、1920px；正文无横向溢出，顶栏/手机导航保持可操作。桌面及手机已人工目视检查。完整分析和CSV入口跳转时收起弹窗，目标页面可直接操作。
- 新增：`tests/e2e/agent.spec.mjs` 和 `tests/test_terminal.py` 中的显式模拟参数/授权/只读测试。旧测试的演示账本通过测试专用API fixture创建，不再依赖被移除的Live按钮。

## 数据与安全验证

- 本地核心仍是精确金额、不可变事件、原子事务、一次性确认和幂等回执。银行本金、借款、退款、分红、投资损益口径未因换肤改变。
- 正式本地文档/配置保存至私有SQLite，全部导出和删除覆盖；Demo只用独立浏览器空间。导入/检索需用途授权，撤回后仍可删除资料。
- 可选云解释不自动附带账本。固定TLS目标、公网DNS校验/固定、响应限额、逐次完整payload与一次性确认；测试使用mock，**未以真实服务响应证明连通性**。慢服务不阻塞锁定/删除，响应回来再次核对会话、用途和版本。已开始的传输无法撤回。
- 备份采用WebCrypto AES-256-GCM、PBKDF2-SHA256 600,000次、随机salt/IV。浏览器实际下载后解密验证通过；错误密码、篡改和不支持格式被拒绝。没有自动恢复流程。
- **工作SQLite、Demo存储和普通PDF/CSV/JSON仍未应用层加密**。访问码不是加密密钥；屏幕遮罩不是认证。设备磁盘加密、私有账户、下载文件和独立备份需用户管理。完整删除不修改环境密钥或擦除SSD/系统快照。完整说明见[SECURITY](SECURITY.md)。

## 尚未验收或未实现

三张独立编写的干净中文PNG与一张由其构造的扫描PDF，不代表真实银行/基金/模糊/旋转凭证通用准确率；500图评测、恶意文件容器隔离、5–8人定位研究、完整WCAG/性能p95审计仍未执行。风险实验不是整体组合VaR或预测，规划不保证回报；实时行情、银行/税务/交易连接器、托管多租户、SQLCipher/静态数据库加密和备份恢复生命周期仍不在当前交付范围。参考图中的在线/加密/交易字样不会被当作已接通的事实。

## 复跑

```bash
npm run check
npm run eval
npm run test:e2e
npm run test:e2e:demo
```

端到端先后执行，使用3097/8797、3101和临时合成数据库，不能指向个人账本。先构建两套产物；可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 使用本机已有Chromium。示例：`PLAYWRIGHT_JSON_OUTPUT_FILE=reports/terminal-browser-live.json npm run test:e2e -- --reporter=list,json`，Demo同理。

完整浏览器回归通过后，最后调整了“查看完整分析/导入CSV”跳转时收起弹窗；重新执行 `npm run check`，并对最终构建补测上述12项，全部通过。检查日志：`reports/agent-check.log`。

新增业务测试：`tests/test_terminal.py`、`tests/demo/terminal.test.mjs`。新增真实界面流程：`tests/e2e/terminal.spec.mjs`、`tests/demo/browser/terminal.spec.mjs`；矩阵在 `responsive.spec.mjs`，含同一文字行的字形分片处理，避免把小数点字体片段误判为断行。

截图：`reports/ux-first-screen-{320,768,1920}-{module}.png`、`responsive-{width}-{module}.png`、`ui-demo-{module}-{desktop,mobile}.png`、`ux-pdf-panel-*.png`、`ux-zoom-*.png`。生成图片被Git忽略，保留于本机供复核。参考图片未作为产品静态资源发布。

本轮悬浮窗截图：`reports/agent-live-popup-desktop.png`、`reports/agent-live-popup-mobile.png`。空库与界面任务使用独立临时SQLite；图片中的账户与咖啡记录由测试明确调用API创建。
