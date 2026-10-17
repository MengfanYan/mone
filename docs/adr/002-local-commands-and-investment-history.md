# ADR 002 · Local commands and investment history

Date: 2026-10-15. Status: implemented locally; current Chromium live/demo workflows and responsive checks passed. Evidence and remaining gates: [UX validation](../UX_VALIDATION.md).

The UX 1.0 plan extends the existing Next/Python/SQLite product. The local command parser creates bounded data plans; it neither executes code nor grants financial authority. `/analyses` and the E0 gateway remain read-only. Authenticated basic record CRUD works without analysis consent; summaries/performance require analysis, evidence extraction and later confirmation require OCR consent.

Use schema 2 and the existing SQLite transaction/idempotency/challenge infrastructure. `command_plans` belong to a hashed local session and expire after 12 hours. Plans bind selected operations, stable target IDs/versions, five-minute confirmation nonce, content hash, consent/settings/ledger/resource versions. Confirmation, economic events, outbox, audit and receipt commit together. Posted corrections append reversal and replacement atomically. Active refunds and linked investment cash histories block unsafe reversal.

Budgets/goals keep stable IDs inside planning JSON; commands modify only the target and preserve unrelated fields. Account metadata lives in an overlay; archiving retains opening entries and balances. There is no bank connection or payment execution.

Each old holding ID migrates independently to an investment plus one source observation. Identical names are not merged. `state.holdings` is a compatibility view of each active investment's latest value, never a second pool. Legacy POST/DELETE holdings now return `409 LEGACY_CONFIRMATION_REQUIRED`; consumers must use confirmed investment endpoints. Existing reports retain their frozen snapshots.

Valuations/reported observations append with explicit same-time `supersedes` revisions. Investment performance events append and are protected from SQL UPDATE. Costs, allocated sale costs, distributions, fee capitalization/net inclusion and cost-adjusted distributions determine which gains can be counted. Unknown costs/fees/history retain gaps or `KNOWN_COMPONENTS`; `VERIFIED_HISTORY` denotes a chain declared complete by the user, not independent external verification. Reported cumulative observations can exist without market value. Only positive known cost permits unrealized gain/cost percentage; no TWR/XIRR. Timestamp ranges use the user's timezone. No bank balance or daily price history is invented.

OCR is local Tesseract, with bundled `chi_sim` and `eng` model data and Apache-2.0 license. PNG/JPEG has bounded size/pixels/time/concurrency and temporary image deletion. Extracted text/boxes persist as review evidence; instructions inside evidence never become commands. Three authored synthetic layouts are separately validated; broader vendor/image accuracy remains unmeasured. Multi-page PDF ingestion is deferred.

Demo uses the same UI and bounded command grammar, separate storage and exact BigInt calculations. It rejects arbitrary image recognition and offers typed simulated examples. Its existing storage namespace migrates conservatively, retaining edits and deleted/locked state. Reset changes only Demo. No Git branch was created because this directory is not a Git checkout.

All new plans/imports/investment histories/account overlays/operation receipts are included in private export/deletion. Browser context/attachments clear at lock/reset/delete. Late OCR reauthenticates before commit; mutations and session revocation are serialized to prevent post-delete writes. Downloaded copies remain outside deletion scope.

The migration is additive and idempotent. Before upgrading a real database, stop the app and retain a private copy under the user's own backup policy. No personal database was used for development. Reverting only application code after schema 2 writes does not provide a supported downgrade: original holdings no longer represent new history. Use a tested forward fix. Never restore a stale backup across consent revocation/deletion without applying those registrations.
