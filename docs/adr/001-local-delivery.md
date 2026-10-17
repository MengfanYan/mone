# ADR 001 — runnable local delivery

Date: 2026-10-14. Status: implemented for local use only.

The three original documents are a design and a staged roadmap. Inspection found a Next.js landing page with Clerk sign-in but no financial backend. The first delivery implements the documented deterministic business slice and a rules/tools E0 baseline. The full cloud/regulated/ML roadmap remains a separate set of acceptance gates.

Use the existing Next.js application rather than move it to `apps/web`. Add a Python standard-library API with SQLite transactions. This runs with the existing Node and Python installations, no Python package download, Docker, identity provider, GPU, or cloud credentials. Next.js proxies a fixed loopback API; both processes bind 127.0.0.1. Startup refuses non-local deployment mode.

SQLite is intentionally a **single-operator local** implementation. It has no PostgreSQL RLS, multiple tenants, field encryption, managed KMS, provider token storage, sharing, or qualified reviewer system. The OS account, private file permissions, local access code, HttpOnly session, and CSRF/Host checks are its access boundary. This is not a production multi-tenant substitute. Hosted deployment requires the original OIDC, RLS, encryption, monitoring, recovery, and security gates.

Exact Decimal strings, balanced postings, immutable economic events, reversals, confirmation challenges, resource/settings versions, transactional outbox, and confirmation idempotency are implemented in Python. Currency conversion is not inferred. Cash flow, credit-card repayments, principal and refunds have distinct classifications. Investments are an independent read-only pool, not duplicated in cash/net-asset totals.

Receipt text and local Tesseract English PNG/JPEG recognition are implemented with bounded files, image dimensions, one OCR subprocess at a time, timeout, temporary-file cleanup and word boxes. PaddleOCR, Chinese image-quality calibration, PDF handling, malware scanning, container sandboxing and 500-image accuracy evaluation are not implemented. Every extraction remains a user-confirmed draft.

The assistant uses deterministic intent rules and four read-only tools. There is no LLM integration or paid training. This establishes E0, not E1/SFT/DPO/RLHF/distillation. The fixed synthetic regression suite and model card document its narrow coverage. The BLS connector is an explicit public-data fetch; it does not send private context and is independent of the assistant.

Reports are computed locally on demand and saved as fixed provisional snapshots. The workspace generates a bilingual PDF from the saved snapshot and previews the same PDF using a local PDF.js worker; legacy Markdown API fields remain compatible. Live dashboard daily summaries are available while the app runs. Scheduled generation, separate recoverable worker jobs, notifications, and outbox consumers must not be claimed merely because the ledger stores outbox records. These are pending capabilities in the original production design.

Runtime dependencies were updated from the inherited versions, including Next.js 16.4.0. The local app is verified through the actual launcher, production build and browser workflows. Keep dependency versions locked and run audit again before a later release; an audit result is time-bound.

Rollback: stop both processes, restore compatible application code, and keep the current database unless a tested migration is required. Never restore a backup over current data after a deletion or consent revocation; this local version has no safe backup-restore lifecycle. Keep the export and deletion limitations visible.
