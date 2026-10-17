# Cloud staging · 免费优先部署与使用

2026-10-15。按 [PRODUCT_STRATEGY](PRODUCT_STRATEGY.md) 的首轮工程顺序实现云端基础。当前是**关闭公众注册的开发/受邀合成数据验证版本**；[实施矩阵](STRATEGY_IMPLEMENTATION.md) 记录真实上线前的剩余条件。原本地版和离线 Demo 继续独立运行。

## 平台与区域

| 组件 | 当前选择 | 边界 |
|---|---|---|
| 身份、财务 PostgreSQL、私有文件 | Supabase Free；项目选择具体 Sydney / `ap-southeast-2` 区域 | 使用非 owner、非 BYPASSRLS 的专用数据库角色；浏览器不持有 service-role key |
| 独立删除控制记录 | 第二个 Supabase Free 项目的私有 bucket | 仅保存签名的租户散列、请求散列和删除代次；与财务库的备份恢复分开 |
| Next.js + Python ASGI | Render Free 单容器，Singapore，`render.yaml` | 免费开发参考；休眠、内存、构建和流量限制需要实际验证，尚未部署 |
| Stripe、银行、行情产品、外部模型 | 关闭 | 不收款，不提供付费套餐，不自动发送资料或换源 |

截至本次核对，Supabase Free 提供两个免费项目、500MB 数据库和 1GB 文件存储，低活跃项目可能在一周后暂停；免费层不包含 Pro 的日常备份保障。[官方价格](https://supabase.com/pricing)、[暂停规则](https://supabase.com/docs/guides/platform/free-project-pausing)。Render 明确将免费实例用于预览而非生产；空闲15分钟会休眠，临时文件会随重启丢失。[免费限制](https://render.com/docs/free)。因此财务数据写入 PostgreSQL/私有存储，不能写 Render 本地 SQLite。

数据库主区可选悉尼；本参考计算区在新加坡，认证、日志和支持链路也需单独核实。**这不是“所有数据只在澳洲”的方案。** [Supabase 区域](https://supabase.com/docs/guides/platform/regions)、[Render 区域](https://render.com/docs/regions)。价格、资源及条款以创建项目时的官方页面为准；本轮没有创建账号、接受服务条款或产生付费调用。

## 本机准备

```bash
npm ci
python3 -m venv .venv-cloud
.venv-cloud/bin/pip install -r requirements-cloud.lock
cp .env.cloud.example .env.cloud.local
```

云端 SDK 要求 Node 22+。工作区开发依赖已提供 Node 22，`scripts/cloud.mjs` 会在系统 Node 20 下使用它，不改系统安装。本地版仍保留原启动方式。云 API 使用 FastAPI/Uvicorn、psycopg、PyJWT；领域金额和确认逻辑与本地版共用。

在自己的 Supabase 控制台建立专用开发项目，配置真实项目 URL、publishable key 和数据库连接。不要将账号密码、数据库 DSN、service-role key 或签名密钥粘贴到聊天中；填写被 Git/Docker 忽略的 `.env.cloud.local` 或托管平台 Secrets。文件权限建议 `chmod 600 .env.cloud.local`。构建环境使用干净源码及运行时密钥注入；不要把含私人数据库或 `.env` 的目录上传为公开制品。

连接必须使用 `sslmode=verify-full`，并使用系统信任根或 Supabase 提供的 CA。示例为 `sslrootcert=system`；连接失败时配置正确 CA，保持证书校验。IPv4 环境可使用控制台给出的 pooler 连接信息；不要猜项目主机或账号后缀。适配器禁用自动 prepared statements，并在每个事务重新设置角色、命名空间和租户上下文。

## 建库与权限

先使用单独的迁移凭据：

```bash
npm run cloud:migrate
```

迁移文件在 `migrations/cloud/`。迁移校验 SHA-256，已应用的文件不能修改，应增加向前迁移。迁移回执与迁移本身一起提交。随后在可信数据库管理环境创建运行登录角色；将下列占位密码换成新的随机值：

```sql
CREATE ROLE wallet_runtime LOGIN PASSWORD '<new-random-password>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS;
GRANT wallet_api TO wallet_runtime;
```

将运行角色连接填写为 `CLOUD_DATABASE_URL`。应用拒绝管理员、BYPASSRLS、可到达管理角色及表 owner 的凭据。运行程序不接收迁移/恢复 DSN；Next.js 子进程也不接收数据库、删除签名和控制项目密钥。单容器并不构成进程失陷后的完整安全隔离，真实数据发布前仍需平台硬化。

私有财务表使用非空租户、复合键/外键、`ENABLE/FORCE RLS`、`USING/WITH CHECK`；金额分录为精确 `NUMERIC`，数据库延期约束检查事件平衡与币种精度。运行角色没有 DDL、TRUNCATE 或原始 SQL API。复核项目中其他 Storage policy：任何更宽的既有策略都可能通过 OR 放开私有 bucket。

## Auth 与受邀访问

1. 使用 Supabase 的 ES256/RS256 签名密钥；旧 HS256 项目需先按供应商流程迁移。后端固定验证 issuer、audience、签名、有效期和 session ID，再查询 Auth 用户；禁止匿名/未验证账号。
2. 配置 Site URL 为 `CLOUD_PUBLIC_ORIGIN`，允许回调 `/auth/callback`。恢复邮件回到 `/auth/callback?next=recovery`。实际邮件模板、SMTP、限流、验证码和送达需要项目联调。
3. 保持 `CLOUD_PUBLIC_SIGNUP=false`，并在 Auth 项目关闭公开注册。BFF 之外注册的账号也必须通过后端邀请表，不能直接建立空间。
4. 从可信 Auth 控制台取得已验证的用户 UUID，在管理连接中添加受邀身份：

```sql
INSERT INTO wallet_admission.invites(user_id,expires_at,approved_by)
VALUES ('<verified-auth-user-uuid>', now()+interval '7 days', '<operator-reference>');
```

5. 为 `CLOUD_AUTH_FLOW_SECRET` 生成至少32字符的独立随机密钥。恢复链接经 PKCE 验证后，另有绑定当前 token 的五分钟 HttpOnly 签名标记；更新密码前撤销应用设备会话。

登录 Cookie 由服务端 SSR 适配器管理，HTTPS 下使用 Secure、HttpOnly、SameSite=Lax；没有浏览器 Auth localStorage。已启用的身份验证器在私人数据访问前要求 AAL2。Settings 提供 TOTP 设置/验证与设备退出；敏感导出/删除再次验密码，有 MFA 时还要求新近验证。完整恢复/MFA 丢失后的人工支持流程仍需供应商联调和运营规则。

## 独立删除控制

在第二个控制项目创建**私有** `finagent-deletion-control` bucket，上传 `key-manifest.json`：

```json
{"required_key_ids":["v1"]}
```

配置控制项目 URL/key，以及 `CLOUD_DELETION_KEYS_JSON`（每个值是至少32随机字节的 Base64）和 `CLOUD_DELETION_ACTIVE_KEY`。控制项目 service-role key 只用于控制记录，不可使用财务项目的 service-role key；后者不进入 Web 运行环境。保留旧验证密钥，轮换时先更新 manifest，再切换活动密钥。缺控制服务、缺历史密钥或签名错误会阻断删除/恢复。

删除先持久化独立签名回执，再在财务事务中清除私人业务、个人规则、反馈、任务和缓存挑战，并撤销全部应用会话。私有文件须先在 Settings 移除；不能把残留对象写成“全部删除成功”。当前按钮删除的是应用数据，Auth 身份账号删除及必要账单留存属于尚待完成的生命周期接入。

## 启动和验证

```bash
npm run cloud:preflight
npm run cloud
```

打开精确配置的 `CLOUD_PUBLIC_ORIGIN`，默认 `http://localhost:3002`。原本地版 `npm run dev` 默认3000，离线 `npm run demo` 默认3001。正式构建：

```bash
npm run cloud:build
npm run cloud:start
```

预检查只输出配置/权限的检查结果，不打印 DSN 或密钥，也不自动批准公众发布。尚未配置项目时预检查失败是预期行为；本轮记录为 `reports/cloud-preflight-unconfigured.json`。

复现合成测试：

```bash
npm run check
npm run test:cloud
node --test tests/cloud/recovery.test.mjs
npm run test:e2e:cloud
```

`test:cloud` 在临时目录启动真正的 PostgreSQL、创建非管理运行角色并在结束后清理，不访问 `.local-data/wallet.sqlite3`。云端浏览器测试使用合成 Auth/Storage 响应，不能替代真实注册、邮件恢复或 Storage ACL 验收。

如需同时验证实际启动链路，先完成 `cloud:build`，再运行 `CLOUD_TEST_SMOKE=true npm run test:cloud`。该测试为临时数据库生成仅测试使用的证书，以 `verify-full` 校验连接，启动真实 ASGI/BFF、检查健康响应和未登录拒绝，随后停止并清理。它使用3108/8768与55439端口，不调用真实Auth；为防止误用已配置项目，检测到 `.env.cloud.local` 会拒绝该启动测试，应在干净测试副本中运行。

## 归档、恢复与发布

Settings 支持本人明确选择本地 schema-2 JSON 导出，核对数量、再次验密码、两分钟确认后原子导入。保留事件和历史报表，精确核对分录总额及每个事件内容与分录的一致性；平衡但金额被篡改的归档也拒绝。重复导入返回原回执。旧会话、nonce、幂等回执和处理授权不继承。原始 SQLite 不自动上传，也不按邮箱猜归属。

灾难恢复先由平台在**隔离、未服务用户**的目标中恢复数据库与对象，再配置单独的恢复凭据和 `CLOUD_RESTORE_ISOLATED=true`，执行：

```bash
npm run cloud:restore
```

它重放独立删除代次、清除旧授权挑战、撤销会话及任务、关闭分析/OCR 授权，并要求恢复后新近认证。该命令是恢复围栏，不负责下载数据库备份、恢复对象字节或证明 RPO/RTO；需要真实平台完整演练。控制日志不可随财务库回滚。

`render.yaml`、`Dockerfile.cloud` 为待联调部署制品。本轮未构建运行 Docker 镜像、未连接真实 Supabase、未创建 Git 远端或发布网站。云端 OCR Worker、自动过期文件清扫、身份账号彻底删除、托管加密/密钥轮换证明、真实恢复及责任人/条款尚待验收。收费依照用户决定保持关闭。
