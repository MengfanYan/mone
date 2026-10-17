# Contributing

## Branches and review

Use `main` as the releasable baseline. Create short-lived branches such as
`feat/budget-rebalance`, `fix/agent-focus` or `docs/cloud-setup`. Local, Demo and
Cloud are runtime modes of the same source; do not maintain divergent long-lived
production/demo branches.

Open a pull request with the concrete behavior change, validation and relevant
risk. Prefer squash merge, with a Conventional Commit PR title that becomes the
final commit subject. Do not force-push shared `main`. If working alone, do not
configure an approval requirement that nobody else can satisfy.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```text
fix(agent): stop local dictation when the task panel closes

Closing the task panel now aborts the active local recognizer so a hidden
panel cannot continue receiving transcripts.

Validation: describe only checks actually run for this change.
```

One commit should represent one reviewable purpose, with its code, meaningful
checks and relevant docs together. Prefer a short imperative English subject;
explanations may be English or Chinese. Mark breaking API/storage changes with
`!` or `BREAKING CHANGE:` and explain migration. Do not invent issue IDs,
reviewers, sign-offs or historical validation results.

The existing application has no prior Git history. Preserve the destination
repository's initial license commit; the application import may be one
honest `chore(repo): import existing ZhiZhang application baseline` commit.
Do not split this completed snapshot into a fictional implementation history.
Repository conventions introduced now may be a separate `ci(repo)` commit only
when each resulting snapshot remains understandable and buildable.

To use the optional template (repository-local configuration):

```bash
git config --local commit.template .gitmessage
```

## Validation and source hygiene

```bash
node scripts/repository-check.mjs
npm run lint
npm test
npm run test:demo
npm run test:pdf
```

For UI changes, build the affected modes and run the relevant Playwright suites
as described in `docs/UX_VALIDATION.md`. For cloud schema/security changes, run
the PostgreSQL/cloud suites in `docs/CLOUD_RUNNING.md`; passing the basic CI job
alone is not a cloud production release gate.

Before committing, review `git diff --cached --stat`, `git diff --cached` and
`git diff --cached --check`. Commit `package-lock.json`, synthetic fixtures,
required fonts/OCR language files and their existing license notices. Do not
commit actual env files, databases, customer uploads, exports, logs, caches,
Playwright traces or local reports. The repository checker flags forbidden
paths, oversized files and some common credential signatures; it is not a
complete secret scanner. Review new text and binary assets before publishing.

CI uses read-only permissions, pinned official actions and synthetic tests.
Do not add production secrets to PR workflows or use `pull_request_target`
to execute untrusted changes. Hosted Actions must run successfully after the
first push before its `quality` check is made mandatory.
