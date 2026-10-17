# 依赖升级与版本对齐评估（2026-10-17）

范围：已关闭的 Dependabot PR #1–#8，以及多人协作与云端上线前的本地/云端全量依赖精确锁版、ESLint 配置现代化改造与运行环境统一。基于包含 CODEOWNERS 的远端 `main`，在本地 `chore/dependency-review` 分支验证；不改变收费或部署设置。

## 采用的本地升级与精确版本基线

为防止多人协作及后续推送云端时因浮动版本号（`^` 或 `>=`）拉取到不兼容的次版本/补丁版本，`package.json`、`package-lock.json`、`requirements-cloud.txt` 与 `requirements-cloud.lock` 已全部对齐为精确锁定版本，并通过 `.npmrc` 强制开启 `engine-strict=true` 与 `save-exact=true`。

### 1. 本轮升级与重构的核心前端及工具链依赖

| 依赖 | 原版本 | 当前锁定版本 | 原因与防冲突说明 |
| --- | --- | --- | --- |
| `@radix-ui/react-select` | 2.2.5 | 2.4.1 | 同主版本维护；官方发布记录包含表单空值、触屏滚动和退出动画修复。现有组件 API 保持兼容。 |
| `tailwindcss` | 4.1.11 | 4.3.3 | 同主版本修复；与 PostCSS 插件及生产 CSS 构建同步锁定。 |
| `@tailwindcss/postcss` | 4.1.11 | 4.3.3 | 与 Tailwind 编译器严格同版本锁定，避免工具链混用。 |
| `tailwind-merge` | 3.3.1 | 3.7.0 | 官方明确支持 Tailwind 4.0–4.3，配套更新类名合并逻辑。 |
| `eslint` / `@eslint/js` | 9.31.0 | 9.39.5 | 升级至本地已缓存的最新 `9.39.5`，并在 `eslint.config.mjs` 中重构 JSX 作用域规则，彻底解耦旧插件限制。 |
| `eslint-plugin-react` | 7.37.5 | **已移除** | 原仅用于 `jsx-uses-vars` 和 `jsx-uses-react` 两条规则，但其 `peerDependencies` 限制 `eslint <= 9` 且引入 119 个旧版 CJS polyfill 间接依赖。已改用 ESLint 9/10 原生 `context.sourceCode.markVariableAsUsed` 在 `eslint.config.mjs` 内置实现并卸载该包，清理 120 个冗余包，使配置直接兼容 ESLint 9 与 ESLint 10。 |

### 2. 已移除浮动范围并精确锁定的全部直接依赖（`package.json`）

| 类别 | 精确锁定版本清单 |
| --- | --- |
| 框架与核心 UI | `next@16.4.0`、`react@19.1.9`、`react-dom@19.1.9`、`lucide-react@0.525.0`、`clsx@2.1.1`、`class-variance-authority@0.7.1`、`tailwind-merge@3.7.0`、`tw-animate-css@1.3.5` |
| Radix / 交互组件 | `@radix-ui/react-checkbox@1.3.2`、`@radix-ui/react-dialog@1.1.14`、`@radix-ui/react-dropdown-menu@2.1.15`、`@radix-ui/react-popover@1.1.14`、`@radix-ui/react-progress@1.1.7`、`@radix-ui/react-select@2.4.1`、`@radix-ui/react-slot@1.2.3`、`@radix-ui/react-switch@1.2.5`、`@radix-ui/react-tooltip@1.2.7`、`date-fns@4.1.0`、`react-day-picker@9.8.0`、`vaul@1.1.2` |
| 云端 SDK 与 PDF 引擎 | `@supabase/ssr@0.12.7`、`@supabase/supabase-js@2.117.3`、`pdf-lib@1.17.1`、`@pdf-lib/fontkit@1.1.1`、`pdfjs-dist@4.10.38` |
| 开发、测试与运行时 | `node@22.23.3`、`@playwright/test@1.64.0`、`embedded-postgres@18.4.0-beta.17`、`eslint@9.39.5`、`@eslint/js@9.39.5`、`eslint-plugin-react-hooks@7.1.1`、`prettier@3.9.10`、`tailwindcss@4.3.3`、`@tailwindcss/postcss@4.3.3` |

### 3. 云端 Python 依赖精确对齐（`requirements-cloud.txt` & `requirements-cloud.lock`）

`requirements-cloud.txt` 已由原先的宽松区间（`>=...,<...`）改为与 `requirements-cloud.lock` 完全一致的精确版本声明，防止本地虚拟环境或云端镜像构建时因直接安装 `requirements-cloud.txt` 引发版本偏移：

- `fastapi==0.143.1`（锁定 `starlette==1.8.0`、`pydantic==2.14.1`）
- `uvicorn==0.54.0`
- `psycopg[binary,pool]==3.3.6`、`psycopg-pool==3.3.3`
- `PyJWT[crypto]==2.15.1`、`cryptography==50.0.2`
- `httpx==0.28.1`

上述所有更新均未使用 `--force`、`--legacy-peer-deps` 或自动 `npm audit fix` 绕过冲突。

## 跨大版本冲突约束与 Dependabot PR 处理状态

| PR | 建议 | 本轮决定与防冲突条件 |
| --- | --- | --- |
| #1 | `actions/setup-python` 7.0.0 | 暂缓；包含 ESM 迁移和输入项删除，需要 GitHub runner 联调验收。保留 `.github/workflows/ci.yml` 中已固定 SHA 的 v6.3.0。 |
| #2 | `actions/setup-node` 7.1.0 | 暂缓；涉及 ESM、认证环境变量和缓存行为。当前将 `.github/workflows/ci.yml` 的 `node-version-file` 绑定至 `.nvmrc`（`22.23.3`），确保 CI 与本地/云端版本一致。 |
| #3 | `actions/checkout` v6 SHA | 暂缓；后续与其他 GitHub Actions 一起在托管 runner 上统一验证。 |
| #4 | `@eslint/js` 10.0.1 | 已完成 `eslint.config.mjs` 的 ESLint 10 兼容改造并移除唯一的 peer 阻碍包 `eslint-plugin-react`（`eslint-plugin-react-hooks@7.1.1` 已原生支持 `eslint@^10.0.0`）。因当前沙箱离线环境仅包含已安装的 `eslint@9.39.5` / `@eslint/js@9.39.5` 二进制包，锁定在 `9.39.5` 以保证本地与离线 CI 构建可用；在可访问 npm 注册表的终端只需执行 `npm i -D --save-exact eslint@10.0.1 @eslint/js@10.0.1` 即可无冲突升至 10.x。 |
| #5 | `lucide-react` 1.56.0 | 暂缓并锁定 `0.525.0`；跨越 0.x 到 1.x 需先全量核对图标导出别名与视觉变化。 |
| #6 | `tailwindcss` 4.3.3 | 采用并锁定 `4.3.3`，同时固定 `@tailwindcss/postcss@4.3.3` 和 `tailwind-merge@3.7.0`。 |
| #7 | `@radix-ui/react-select` 2.4.1 | 采用并锁定 `2.4.1`。 |
| #8 | `pdfjs-dist` 6.4.299 | 暂缓并锁定 `4.10.38`；v6 改变了 `getDocument()` / `PDFWorker` 销毁生命周期，且项目离线自托管的 `public/pdf/pdf.worker.min.mjs` 必须与 `pdfjs-dist` 版本严格一致。升级 v6 时须同步替换静态 worker 并重新验收中英账单渲染与扫描/文本 PDF 导入。 |

## 本地、CI 与云端运行环境一致性

- **Node.js 22.23.3 全链路统一**：
  - `.nvmrc`：固定 `22.23.3`
  - `package.json`：`"engines": { "node": ">=22.0.0" }`，`devDependencies.node` 固定 `"22.23.3"`
  - `.npmrc`：`engine-strict=true` 与 `save-exact=true`
  - `Dockerfile.cloud`：构建与运行阶段均固定为 `node:22.23.3-bookworm-slim`
  - `.github/workflows/ci.yml`：`actions/setup-node` 使用 `node-version-file: ".nvmrc"`
  - 启动与构建脚本（`scripts/run.mjs`、`scripts/demo.mjs`、`scripts/build.mjs`、`scripts/cloud.mjs`、`scripts/check.mjs`）：若检测到宿主机默认 Node 低于 22，均自动切换到工作区锁定的 `node_modules/node/bin/node`（`22.23.3`）执行。
- **Python 3.11+（本机与 `.venv-cloud` 已验证 `3.12.3`）**：
  - 本地标准库服务与云端 `.venv-cloud` 使用一致的 Python 3.11+ 语法与精确 Decimal 领域逻辑；云端容器与本地虚拟环境统一通过 `requirements-cloud.lock` 安装完全相同的二进制版本。

## 验证记录

- `node scripts/repository-check.mjs`：通过（源码卫生、受控路径与敏感凭据扫描）
- `npm run lint`（基于原生 `sourceCode.markVariableAsUsed` 的 ESLint 检查）：通过
- `npm test`（Python 77 项领域、账本、确认、隐私与市场契约测试）：通过
- `npm run test:demo`（Node Demo 43 项逻辑测试）：通过
- `npm run test:pdf`（双语 PDF 字体、精确金额与分页测试）：通过
- `node --test tests/cloud/recovery.test.mjs`（云端恢复签名测试）：通过

## 官方依据

- [Radix 发布记录](https://www.radix-ui.com/primitives/docs/overview/releases)
- [Tailwind 4.3.3](https://github.com/tailwindlabs/tailwindcss/releases/tag/v4.3.3)
- [tailwind-merge 支持范围](https://github.com/dcastil/tailwind-merge)
- [ESLint 维护周期](https://eslint.org/version-support/)
- [PDF.js 6 API 变更](https://github.com/mozilla/pdf.js/releases/tag/v6.0.227)
- [Lucide 1.56.0](https://github.com/lucide-icons/lucide/releases/tag/1.56.0)
- [setup-node 7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0)
- [setup-python 7.0.0](https://github.com/actions/setup-python/releases/tag/v7.0.0)
- [checkout 变更](https://github.com/actions/checkout/blob/main/CHANGELOG.md)
