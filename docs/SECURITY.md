# 本地数据保护与安全存储

2026-10-16新增站内通知：通知从本人已确认记录、批准预算和保存价格生成，已读标识保存在本人服务端settings；导出/删除覆盖，正式版不写财务浏览器存储。分析撤回、锁定或屏幕遮罩会移除通知内容，通知不会启动银行/行情/模型外发。[来源和接口](UI_NOTIFICATIONS.md)。

适用范围：2026-10-15 的本地单用户版本。这里区分已实现保护、使用要求和尚未实现的能力。产品演示只应使用合成数据，不能充当客户真实账本。


新增云端版本的身份、PostgreSQL/RLS、私有文件、独立删除控制和恢复围栏见 [Cloud架构](CLOUD_ARCHITECTURE.md)、[数据治理](DATA_GOVERNANCE.md)、[部署说明](CLOUD_RUNNING.md)。下方原表格继续描述本地版，不适用于托管云数据。云端当前仅做合成/受邀开发验证；公开注册、收费、银行及外部模型关闭，未完成项见 [P0矩阵](STRATEGY_IMPLEMENTATION.md)。

## 数据如何处理

| 数据 | 处理及存放位置 | 保留与清理 |
|---|---|---|
| 账户、交易、预算、投资观察 | 正式版通过同源 `/api` 交给本机 Python，保存到 `WALLET_DB`；默认 `.local-data/wallet.sqlite3` | 用户确认后保存；正式事件通过冲正更正；完整删除清理主库和衍生表 |
| 自然语言任务 | 本地有界规则解析；任务计划与来源进入私有数据库，不调用云模型 | 计划有会话归属及12小时有效期；过期不再允许操作；创建新计划时清理过期计划，完整删除亦清理；**到期不等于即时物理删除** |
| 凭证图片 | 正式版需独立 OCR 授权；临时私有目录中交给本机 Tesseract | 正常/失败退出临时目录时删除原图；异常进程终止可能留下系统临时文件；提取文字、来源哈希及文字框保留作核对依据 |
| 浏览器内正式数据 | 运行时内存；业务数据不写入 localStorage/sessionStorage；无业务 Service Worker 缓存 | 锁定清空表单、任务、图片、报告等前端引用；页面和 API 返回 no-store；不能承诺内存取证意义的擦除 |
| 会话、语言 | 会话随机令牌放在 HttpOnly、SameSite=Strict Cookie，服务端仅保存令牌哈希；语言偏好是普通 Cookie | 会话12小时，重启、锁定或完整删除使相应会话失效；语言偏好不是金融信息 |
| Demo | 当前来源的 `zhizhang.product-demo.v1` 浏览器存储，**明文**，不写正式 API/数据库 | 只清理自己的命名空间；重置恢复合成样例；浏览器禁存储时只在内存运行 |
| PDF / 普通JSON / 筛选CSV 导出 | 用户明确操作后在浏览器生成并下载，默认未加密 | 下载文件脱离应用控制；删除账本不会删除这些文件 |

分析和 OCR 默认关闭，可分别授权或撤回。撤回后停止相应用途，提交前再次检查授权；基本记账仍可使用。撤回不自动删除之前保存的原始记录和核对证据，需要完整删除时使用隐私页的删除操作。

应用没有银行密码、支付密钥或广告追踪。默认本地任务和E0助手不联网。用户点击的BLS连接器仅发送固定公共系列参数。

新增的可选云解释入口位于 **Settings**：仅服务端读取 `OPENAI_API_KEY`，不返回密钥、不存浏览器、不能配置任意主机。调用固定的 OpenAI Responses API，TLS校验并固定已验证的公网DNS地址；拒绝重定向、限制响应大小和超时。没有密钥就不调用。每次必须先展示完整问题、检索片段和目的地址，再由用户明确确认；两分钟一次性nonce绑定会话与资料版本，撤回、资料变化或锁定后失效。慢服务在确认锁之外运行，避免阻塞锁定/撤回/删除；响应返回后再次核对会话、用途与资料版本，失效结果不返回给界面。已开始传输的内容无法从服务商处撤回。只发送预览中展示的内容，不自动附带账本、不提供写入工具。`store:false` **不等于服务商零保留**，服务商政策仍适用。演示版本只返回明确标记的手写预设，不读取密钥、不联网。`.env.local`及服务环境中的密钥由用户自行移除；删除账本不会修改这些外部配置。

本地资料库支持TXT、Markdown和文本PDF，最多20份、每份50,000字符。分块和384维哈希词法向量在本机计算，不声称神经语义嵌入；正式文本保存在私有SQLite的 `settings.terminal`，Demo保存在自己的浏览器空间。全部导出/删除覆盖这些资料和配置。资料删除允许在撤回分析后进行；检索与导入需分析授权。原PDF仅在浏览器内存解析，不直接上传服务器。

## 已实现的访问保护

- 两个服务只监听 `127.0.0.1`，校验 Host/Origin；启动器拒绝托管模式。访问码使用 scrypt 校验，有错误尝试限流；访问码和会话只在服务内存中。
- SQLite 文件在第一次写入前设为 `0600`，新建数据目录为 `0700`；拒绝数据库符号链接，已存在数据库收紧到 `0600`。自定义目录的既有父目录权限不会被擅自修改。
- 写入使用参数化 SQL、事务、精确金额、稳定 ID 和版本检查。确认绑定会话、具体内容、资源版本及5分钟有效期；幂等键阻止重复提交。全量隐私导出和删除另外要求重新输入访问码。
- 页面使用每次响应独立的脚本 CSP nonce；生产版禁止任意内联脚本和 eval。连接、图片、字体及 Worker 限制在本地来源，保留本地 PDF/上传预览需要的 blob/data。样式允许 inline，供图表/PDF 尺寸使用。拒绝 iframe 嵌入，关闭引用来源信息及相机、麦克风、定位和支付权限。
- React 将导入的商户等内容作为文字显示。图片/CSV 有大小、类型及像素限制，OCR 有并发和超时限制。凭证文字不作为可写命令执行。
- 请求日志不包含账本、URL、请求体、Cookie 或凭证内容。开发启动器会在终端显示访问码，因此不要分享该终端或带访问码的截图。
- 所有账户/确认/编辑对话框使用原生模态隔离和 Tab 焦点循环。手机有独立锁定入口；锁定撤销会话并清空当前敏感视图。锁定/删除还使在途快照失效，旧月份响应不会重新打开工作台。

本地 HTTP 的会话 Cookie 没有 Secure 标记，因为服务使用回环 HTTP；它不能复用为互联网部署的认证方案。拥有同一系统账户权限、浏览器扩展权限或设备管理员权限的人仍可能读取数据。CSP、访问码和文件权限不能保护已被入侵的设备。

## 当前如何安全存储

**应用没有实现 SQLite 内容加密、SQLCipher 或端到端加密。访问码不是数据库加密密钥。** 文件权限不防护磁盘、备份或导出文件被复制后读取。

1. 将正式账本放在启用设备磁盘加密的个人设备或已加密卷上，使用独立系统账户和屏幕锁。需要先确认加密确实已启用；应用不会替用户开启或验证设备加密。
2. 数据目录不要放在共享目录、源码同步目录或自动云同步目录。自定义路径可在 `.env.local` 配置 `WALLET_DB=/path/on/encrypted-volume/financial-agent/wallet.sqlite3`。父目录由用户预先创建为仅本人可访问，例如 `mkdir -m 700 <private-directory>`。已有账本改路径前先关闭服务，并妥善迁移文件；单改路径会打开另一个账本，**不是迁移或加密**。
3. `.env.local`、数据库、真实票据、PDF 和 JSON 不要提交 Git。JSON 包含完整私有记录与核对材料；保存到加密位置，使用完按需删除，不通过客户 Demo 分享。
4. 若自行备份，只保存在受控的加密位置并设保留期。完整删除或撤回后，不应直接恢复旧备份而重新引入已删除数据/授权。应用目前没有经过验证的备份恢复生命周期。
5. 离开时点击 **Lock workspace / 锁定工作台**，再锁系统屏幕。结束使用可 Ctrl+C 关闭服务；重启后旧会话无效。

**加密备份已实现，但运行数据库未加密。** Privacy页可预览并确认加密导出，仍需正式版访问码再验证。备份使用WebCrypto AES-256-GCM、随机16字节salt/12字节IV、PBKDF2-SHA256 600,000次迭代及认证附加数据；口令12–200字符，只在浏览器内存中处理，不传服务器。明文负载上限32 MiB。每次导出产生新salt/IV；密码错误或内容被修改会使认证解密失败。页面可本机验证已有加密文件，只显示成功/失败，不导入或恢复账本。密码丢失无法找回。没有经过验证的自动恢复/密钥轮换生命周期；这不是数据库加密或零知识服务。

屏幕遮罩会移除财务视图、隐藏审计事件和检索内容；它是演示时的视觉保护，不是权限边界。语言、密度和遮罩偏好只写非财务Cookie。哈希链审计展示当前库校验结果，校验失败明确提示；它不能证明整份重写数据库的真实性，也不能替代外部审计。

完整删除启用 SQLite secure_delete 并执行 VACUUM，清理业务、证据、计划、历史报表、幂等回执及派生内容，并撤销全部会话；在途 OCR 不能在删除后重新写回。它不是对 SSD、系统快照、交换区或独立副本的可靠物理擦除承诺。

## 面向真实客户托管前的阻断条件

当前版本应保持本地单用户范围。托管或多人使用前，需要另行实现和验收：成熟身份认证与会话管理、租户隔离/最小权限、TLS、数据库和备份静态加密、密钥独立管理/轮换、恢复及删除传播、隐私保留策略和安全审查。不要把访问码直接当作 SQLCipher 密钥，也不要自行设计加密格式后声称安全。若以后选择 SQLCipher，应使用经过维护的实现与 OS 密钥存储，并验证旧库迁移、重置密码、丢失密钥、备份恢复及删除行为。

验证证据与复跑命令见 [UX_VALIDATION.md](UX_VALIDATION.md)。权限测试为 `tests/test_storage_permissions.py`；业务/授权/删除/跨源/在途 OCR 测试在 `tests/test_security.py` 与 `tests/test_experience.py`；浏览器安全回归在 `tests/e2e/ux-acceptance.spec.mjs`。加入云端依赖后重新运行 `npm audit --omit=dev`，生产依赖已知漏洞数为0，[本轮快照](../reports/review-dependency-audit.json)；结果仅代表该次依赖公告检查。这些是当前实现的回归验证，不是独立渗透测试或合规认证。

### Floating task popup and explicit simulations

The floating Agent reuses the authenticated command/analysis APIs and the existing nonce/hash/version/idempotency confirmation flow. Opening or typing in it sends nothing to an external model. Financial writes require review; a successful write refreshes actual API state. Closing the popup retains the in-memory task, while locking/deletion clears it and the existing private epoch prevents delayed results from reopening private views. Screen masking removes the popup with the other financial UI.

Live Monte Carlo requests require authentication, allowed Origin, analysis consent, complete finite bounded inputs and bounded path counts. They run on the local API and neither save assumptions nor modify financial records. The browser drops stale projections after parameter edits and has no synthetic result fallback. Demo data creation is absent from Live UI; the isolated Demo keeps its own synthetic storage and transport.

## 2026-10-16：本地规划与语音边界

新增诊断与规划工具仅读取已授权快照，金额用最小币种单位整数运算；多币种手动折算不回写原账本。汇率、来源、计划项目和假设配置仅存于当前组件内存，换范围/版本、离开模块或锁定后销毁。正式环境不新增财务 localStorage、Cookie、第三方分析SDK、语音服务器或训练数据收集。

预算调平在提交预览前重读授权与ledger/settings版本，再使用原nonce/hash/版本绑定确认。还款只准备草稿，不调用银行；退款匹配也仅预填可编辑关联。关闭/锁定期间返回的预览不能重新打开私密弹窗。财务建议来源可定位原记录，OCR原始分数明确未校准。

麦克风策略从完全禁用改为同源允许，但应用只在用户点击、本地识别API与语言包可用时启动，强制 `processLocally=true`。不自动安装语言包、不使用云识别后备、不保存音频。关闭任务工作台、模式切换、窗口失焦及组件卸载中止识别。转写仅填入任务框，发送到本人账本API仍需用户点击预览或按Enter。浏览器真实麦克风效果需在用户设备确认；自动化覆盖强制本地、能力不可用和关闭中止分支。

主动下载的Markdown简报包含所选月份与币种的交易来源ID，应按财务导出文件保管。新功能没有改变原数据库加密、备份及托管上线条件。详见 [ADVISORY_WORKSPACE.md](ADVISORY_WORKSPACE.md)。
