# GitHub 仓库与提交指南

目标仓库：[MengfanYan/mone](https://github.com/MengfanYan/mone)。主分支为 `main`。
保留远端已有的初始化提交和许可证，在其上导入当前项目，不重写已有历史。

## 首次导入

本次应用快照使用一个真实的基线提交：

```text
chore(repo): import existing ZhiZhang application baseline
```

正文说明 Local、Demo、Cloud 的交付范围、实际运行的检查，以及未完成的云平台验收。
不要把既有快照拆成虚构的开发历史。作者沿用本机 Git 配置，不添加虚假的签名、审阅者或 issue。

上传前检查：

```bash
node scripts/repository-check.mjs
git status --short
git diff --cached --stat
git diff --cached --check
git diff --cached
```

`.gitignore` 排除真实环境变量、数据库、用户上传所在的本地数据目录、构建缓存、日志、截图和运行报告。
保留示例配置、依赖锁文件、合成测试数据、运行所需字体/OCR 资源及其许可证。
仓库检查脚本仅检测部分已知路径和凭据特征，不能替代内容审查。
历史验收文档中的 `reports/` 链接指向本地生成产物；这些产物不上传，按验收步骤重新生成。

如果推送时要求登录，请通过 GitHub Desktop、已配置的 SSH，或 GitHub CLI 的浏览器登录完成认证。
不要把密码或 Token 放入聊天、remote URL、源码或提交。GitHub CLI 是可选工具。
认证后可重试：

```bash
git push -u origin main
```

如果远端已有新的提交，先获取并审查差异，合并后再推送；不要使用 `--force`。

## 后续日常提交

```bash
git switch main
git pull --ff-only
git switch -c fix/agent-focus
# 修改、运行相关检查、审查差异后：
git add path/to/changed-file
git diff --cached --check
git commit
git push -u origin fix/agent-focus
```

已提供 `.gitmessage` 模板，可在本仓库启用：

```bash
git config --local commit.template .gitmessage
```

使用 `feat(scope): ...`、`fix(scope): ...`、`docs(scope): ...` 等 Conventional Commits 标题。
每次提交对应一个可审查目的；正文解释原因、结果、真实验证及必要的迁移影响。
通过 PR 合并，推荐 squash merge 并让 PR 标题成为最终提交标题。具体要求见 [CONTRIBUTING](../CONTRIBUTING.md)。

## CI 与仓库设置

`.github/workflows/ci.yml` 在主分支推送和 PR 时运行源码检查、lint、Python/Demo/PDF 单元测试、
三种模式构建及 Demo 浏览器验收。使用只读权限、固定版本的官方 Actions，不配置生产密钥或自动部署。
Cloud 供应商、PostgreSQL 集成与 Live OCR 验收仍按各自运行文档执行；此 CI 不是生产发布的全部门槛。
本地检查通过不代表 GitHub Actions 已通过，推送后须查看仓库 Actions 的实际运行结果。

首次 `quality` 检查成功后，在账号套餐支持的仓库 Rulesets / Branch protection 中配置：

- `main` 通过 PR 合并，要求 `quality` 检查通过，禁止强推及删除。
- 团队协作时要求至少一位其他维护者审阅；只有一人维护时，不设置无人能满足的审阅人数。
- 启用 squash merge；提交签名按组织要求和真实签名密钥配置，不伪造 Verified 状态。
- 核对仓库可见性、协作者权限与现有 LICENSE；这些仓库设置不由源码自动更改。

官方参考：[导入已有代码](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)、
[Rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)、
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)。
