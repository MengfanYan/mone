# Local API contract

Current terminal additions are described below and in [ADR 003](adr/003-terminal-reference-workspace.md). These do not change the existing ledger confirmation contract or E0 tool gateway.

The interfaces below remain the live-mode contract. The independent `npm run demo` server disables `/api/*` with `503 DEMO_API_DISABLED`; its UI uses browser presets without HTTP API calls. The `/demo` page in live mode also uses that isolated adapter while live API endpoints remain available. See [Demo guide](DEMO.md).

Next.js exposes `/api/*`, forwarding only to a fixed `http://127.0.0.1:API_PORT/v1/*`. The Python API is not a public service. Responses are `{data, trace_id, as_of}` or `{error:{code,message,...},trace_id}`. Financial amounts and quantities are decimal strings. Private responses have `Cache-Control: no-store`.

Presentation language is selected by `Accept-Language: en` (default) or `zh` / `zh-CN`. The BFF forwards this header and upstream `Content-Language`. Only system labels, notes, errors and report presentation are localized; user-entered financial text, exports, IDs and hash-bound confirmation payloads remain original. `GET /statements/{id}` returns `language` and the requested language’s Markdown from the **same immutable snapshot**, without creating a new version. Its `sha256` describes the returned artifact.

The workspace now displays and downloads a PDF generated locally from the returned `snapshot`. Its bundled PDF.js viewer renders those same PDF bytes, with page navigation and zoom. The legacy `markdown` and `sha256` API fields remain available for existing clients; that hash describes the Markdown, not the locally generated PDF.

`GET /state` includes `money_flow:[{currency,points:[{label,income,expenses}],calc_version}]`, split into calendar-week blocks of the selected month. Exact decimal totals use the same refund/reversal rules as the monthly summary; principal and internal transfers are excluded. With analysis consent off, `money_flow` is empty. `summary.expense_income_percent` is null without positive income; approved budget summaries include exact `used_percent` and `budget_remaining`. Currencies remain separate.

Every endpoint except health/login requires the HttpOnly `wallet_session` cookie. Write requests require JSON objects and an exact local frontend `Origin`. Unknown identity/tenant and business fields are rejected. Body limit is approximately 7 MiB; per-file limits are smaller. Only one authenticated local operator exists: there are no tenant IDs, role escalations or shared users.

| Method | `/v1` path | Body / behavior |
|---|---|---|
| GET | `/health` | Liveness, no financial data |
| POST | `/session` | `access_code` → 12-hour session cookie |
| GET / DELETE | `/session` | Inspect / lock local session |
| GET | `/state?period=YYYY-MM` | Accounts, postings, drafts, monthly/daily calculations, planning, holdings, report index, public evidence, explicit quality/mode flags |
| POST | `/accounts` | `name,type,currency,opening_balance,opened_on,mock?` |
| POST | `/drafts` | `amount,currency,date,merchant,category?,kind?,account_id,counterparty_id?,refund_of?,external_id?,mock?` |
| PUT | `/drafts/{id}` | `version,content` → versioned draft correction |
| POST | `/imports` | `csv,account_id?,mock?` → atomic normalized drafts |
| POST | `/receipts` | `text?` or `image_base64?`, `account_id`, optional `amount,date,currency,merchant` corrections |
| POST | `/confirmation-challenges` | `purpose,resource_id,payload?`, `access_code` additionally for privacy purposes |
| POST | `/drafts/{id}/confirm` | `nonce,content_hash` → balanced immutable event |
| POST | `/drafts/{id}/reject` | `nonce,content_hash` → rejected draft, no posting |
| POST | `/transactions/{id}/reverse` | `nonce,content_hash` → append exact opposite postings |
| PUT | `/planning` | `nonce,content_hash,payload` → approved planning version |
| PUT | `/consents` | `nonce,content_hash,payload:{analysis:bool,ocr:bool}` |
| POST / DELETE | `/holdings` / `/holdings/{id}` | Deprecated: 409; use confirmed investment endpoints below |
| POST | `/analyses` | `text,period?,currency?` → read-only E0 task, references, template explanations, bounds |
| POST | `/market/refresh` | `{}` only → fixed BLS public source, no private query or URLs |
| POST | `/statements` | `period` → frozen provisional report; unchanged source versions reuse the same report |
| GET | `/statements/{id}` | Fixed snapshot, Markdown and content hash |
| POST | `/privacy/export` | `nonce,content_hash` → full private JSON export |
| POST | `/privacy/delete` | `nonce,content_hash` → cleanup and session revocation |

Challenge purposes are `confirm_draft`, `reject_draft`, `reverse_event`, `planning`, `consents`, `privacy_export`, `privacy_delete`. They bind purpose, resource, canonical content, resource version, consent version, session actor and five-minute expiry to a one-time nonce. Draft edits, expired/reused nonces, forged hashes, session changes and relevant resource/consent changes are rejected. Privacy previews also track unconfirmed drafts, holdings and report creation through `resource_version`.

`Idempotency-Key` is supported atomically for **ledger confirmation and reversal**. Same key and content/session return the stored response; changed content returns `409 IDEMPOTENCY_CONFLICT`. Other operations rely on their documented uniqueness/version behavior, not the full future README's all-write idempotency contract. Challenge consumption and ledger/outbox writes share one SQLite transaction. Nonce reuse without the same idempotency key is rejected.

Planning fields: `currency,monthly_income,essential_spend,debt_payment,earmarked,budgets:[{category,amount}],goals:[{name,target,saved,deadline}],life_status:[student|employed|unemployed|planning_family|parent],timezone`. Null/empty unknown amounts remain unknown. No product weights, suitability or trade instructions are accepted.

Holding fields: `name,issuer,asset_type:stock|etf|bond|cash|complex,currency,quantity,price,cost_basis?,observed_at,mock?`. Timestamps require explicit offsets and must not be in the future. Unknown cost produces null gain. Quotes older than 15 minutes are labeled stale; all manually entered quotes remain user-provided. No return/volatility series is invented.

This implemented contract is intentionally smaller than the design endpoint catalogue. There are no bank tokens, webhooks, cloud OCR/LLM, payment/trading, qualified reviewer, shared-user, notification channel or hosted administrator endpoints.

## UX 1.0 · schema 2 (2026-10-15)

The following local endpoints retain the existing authentication, Host/Origin checks and no-store responses. The BFF exports PATCH and the Python handler supports it. `/analyses` remains read-only. New command/confirmation endpoints do not call a financial platform or cloud model.

| Method | `/v1` path | Body / behavior |
|---|---|---|
| POST | `/commands/plan` | `text,account_id?,currency?,period?,recent_resource_ids?` → session-owned plan; no posting |
| GET | `/commands/{id}` | Current plan/version/state; another session gets 404 |
| PATCH | `/commands/{id}` | `version,operations:[{op_id,fields?,selected?,resource_id?}]` → only allowed fields and matched stable targets |
| POST | `/commands/{id}/cancel` | `version` → terminal cancellation; already saved drafts remain drafts |
| POST | `/commands/{id}/drafts` | `version` + required Idempotency-Key → selected complete transaction candidates saved atomically |
| POST | `/commands/{id}/apply` | `nonce,content_hash,plan_version` + required Idempotency-Key → selected operations commit atomically |
| POST | `/evidence-imports` | `doc_type:receipt\|bank\|investment,text?\|image_base64?,account_id?,currency?,period?` → typed import plan and source batch; requires OCR |
| GET | `/import-batches/{id}` | Import evidence plus session-owned command |
| POST | `/draft-batches/confirm` | `nonce,content_hash,payload:{drafts:[{id,version}]}` + required Idempotency-Key |
| POST | `/transactions/{id}/corrections` | `nonce,content_hash,payload:{content:<event fields>}` + required Idempotency-Key; reversal + replacement |
| GET / POST | `/investments` | Stable entries / confirmed creation using `investment_change`, resource `new` |
| PATCH | `/investments/{id}` | Confirmed `metadata` or `archive` only; version required |
| POST | `/investments/{id}/valuations` | Confirmed `valuation`; append observation or explicit same-time revision |
| POST | `/investments/{id}/performance-events` | Confirmed `performance_event`; immutable buy/sell/distribution/fee/tax/reinvestment history |
| GET | `/investments/{id}/history` | Raw entry/valuations/events/observations; authenticated CRUD evidence, no analytical permission required |
| GET | `/investments/{id}/performance` | Analysis-authorized points/reported points/quality/components/event refs; UI applies timezone date range |

New confirmation purposes: `command_apply`, `confirm_draft_batch`, `correct_event`, `investment_change`. The exact payload is submitted to `/confirmation-challenges` and repeated unchanged at execution. The selected plan, record versions and ledger/settings/resource/portfolio versions are revalidated on consumption. Changing selected fields, consent or a target requires a fresh preview. All selected operations either commit together or roll back, including nonce consumption. Idempotent retries return the original receipt for the same session/operation/body; changed bodies return 409. The original confirmation/reversal key support remains.

A transaction example:

```json
{"text":"Coffee 7 AUD","account_id":"<approved-local-account-id>"}
```

Use its `command_id` in `{"purpose":"command_apply","resource_id":"<command-id>"}`. Confirm by POSTing `{"nonce":"<nonce>","content_hash":"<hash>","plan_version":1}` to `/commands/{id}/apply`, with a fresh UUID `Idempotency-Key`. Ambiguous candidates must first be PATCHed with user-approved fields. Plans permit at most 20 operations and queries display at most 100 matches with `query_total`; narrow a larger search. Plans expire after 12 hours and confirmations after 5 minutes.

Investment execution body is `nonce,content_hash,payload`. Payload shapes:

- Creation: `{action:"create",entry:{name,issuer?,currency,asset_type?,account_ref?,history_complete?,mock?},valuation?}`.
- Observation: `{action:"valuation",version,valuation:{observed_at,market_value? OR quantity+price,cost_basis?,reported_gain?,daily_gain?,reported_semantics?,fees_taxes_known?,supersedes?,evidence?}}`.
- History event: `{action:"performance_event",version,event:{type,amount,observed_at,cost_allocated?,cost_added?,fee?,tax?,capitalized?,included_in_net?,distribution_in_cost?,ledger_event_ref?,source_key?,evidence?}}`.
- Metadata/archive: `{action:"metadata",version,patch:{name?,issuer?,archived?}}` / `{action:"archive",version}`.

Money stays exact decimal strings. Currency/observation time are mandatory; unknown values are null, explicit zero is different. Same-time observations need the latest point ID as `supersedes`; a reported-only observation does not create a holding value. Percentages are unrealized gain / positive remaining basis, four decimals. `history_complete`/fee completeness are user assertions. Capitalized/net-included fees and distributions already reflected in cost reductions are not counted twice. Optional cash links must match an effective confirmed dividend/buy/sell event and amount/currency, and never create another cash event.

Planning arrays now contain `id,version`; text patches retain other planning fields. Archived accounts reject new transactions and retain their original ledger. No local command invokes full privacy deletion.

**Compatibility:** POST/DELETE `/holdings` return `409 LEGACY_CONFIRMATION_REQUIRED`. `state.holdings` remains the latest-value compatibility view; schema 2 adds `investments`, `portfolio_version`, scoped presentation facts, counts, cash bridge and month comparison. Old reports and the legacy Markdown download API remain available; the statement UI previews real PDF. Export/delete include schema 2 tables and idempotent operation receipts. Slow OCR rechecks the authenticated session and consent before persistence, so lock/delete cannot be undone by a late recognition result.

## Terminal configuration, evidence library and optional explanation

All routes below require the existing authenticated session; writes retain the exact local Origin check and fixed local BFF. Configuration/document changes increment settings/resource versions, invalidating stale previews. These endpoints cannot post ledger entries or execute payments/trades.

| Method | `/v1` path | Contract |
|---|---|---|
| GET | `/terminal/settings` | Model identifier/output/retrieval parameters, local source documents, fixed provider/endpoint, `key_configured` boolean. No key value. `cloud_automatic:false`, `database_encrypted:false` |
| PUT | `/terminal/settings` | Exactly `{model,max_tokens,temperature,top_k,threshold}`; model identifier 1–80 safe characters, output 100–4000 integer, temperature 0–2, top-K 1–10 integer, threshold 0–1; finite numbers only. Does not call provider |
| POST | `/terminal/documents` | Exactly `{name,text}`; 1–100-character name, 1–50,000-character nonempty text, maximum 20 documents. Requires analysis consent. Returns updated settings |
| DELETE | `/terminal/documents` | Exactly `{id}`; removes local source/search material, even after analysis revocation; returns updated settings. UI asks for explicit source deletion confirmation |
| POST | `/terminal/search` | Exactly `{query}` of 1–2000 nonempty characters; requires analysis consent. Returns attributed `{id,name,offset,text,score}` chunks and `local:true`, `method:hashed-lexical-cosine` |
| GET | `/terminal/audit` | Verifies the current SHA256 chain and returns up to 100 latest events, full-chain `verified`, count and method. No raw query, key, password or document text in the log |
| POST | `/terminal/model-preview` | Exactly `{query}`; requires analysis consent and configured server key. Returns fixed destination, complete provider payload, opaque nonce, 120-second validity and retention warning. No network call |
| POST | `/terminal/model-explanation` | Exactly `{nonce,confirmed:true}`; single-use nonce bound to session, resource version, exact saved payload and expiry; rechecks consent. Sends only the reviewed payload to the fixed TLS OpenAI Responses endpoint. Read-only text response. No tool execution or automatic ledger context |

Local retrieval chunks are 1,000 characters with 150-character overlap; vectors are 384-dimensional hashed lexical vectors with cosine ranking, not a neural embedding model. Retrieval and stored text/configuration are included in full privacy export/delete. Pending model payloads are cleared on lock/delete. Environment keys remain user-managed outside ledger deletion. Real cloud availability is not claimed from key presence alone; validation used mocks and no paid requests.

PDF evidence is decoded/rendered in browser memory, so `/evidence-imports` keeps its existing text/PNG/JPEG contract. At most five text pages/20,000 extracted characters or one scanned PDF page are accepted, with a 5 MiB source limit. Original PDF bytes are not submitted. The scanner path submits a bounded PNG to the existing separately consented OCR validation/confirmation flow. The local library accepts text from up to 20 PDF pages/50,000 characters. General vendor/scanned multi-page PDF accuracy is not certified.

Encrypted backup uses the existing reauthenticated `/privacy/export` challenge/confirmation. The returned export is encrypted locally with WebCrypto; no backup password or encryption key is sent to any API. Envelope: `format:zhizhang-encrypted-backup`, `version:1`, `algorithm:AES-256-GCM`, `kdf:PBKDF2-SHA256`, `iterations:600000`, base64 `salt`, `iv`, `ciphertext`. This is a download format, not SQLite encryption. Local verification does not import/restore a ledger.

### Explicit Live planning simulation

`POST /v1/terminal/simulation` (BFF: `/api/terminal/simulation`) requires a local authenticated session, allowed Origin and analysis consent. Body: `{ "parameters": { "age": 35, "retirementAge": 36, "initial": 100, "monthly": 10, "goal": 200, "annualReturn": 0, "inflation": 0, "volatility": 0, "seed": 4819 }, "paths": 600 }`. These numbers are a request example, never Live defaults. Every parameter must be supplied as a finite numeric value; the horizon is 1–60 whole years and path count 100–2400. Missing fields, empty strings, booleans, nonfinite/out-of-range values are rejected.

Returns computed points, sample paths, probability, ending quantiles, required monthly contribution and the exact input parameters with `source: LOCAL_API`. This is a read-only, locally executed statistical model, with no external market source or LLM call and no saved financial assumptions or ledger changes. Python uses a seeded local random generator; Demo retains its separate browser simulation, so individual random paths can differ between transports. Each implementation is reproducible within its own method/version. Errors never return a preset projection.

## 2026-10-15 audit contract updates

`POST /analyses` accepts optional `currency` for backward compatibility; the UI always supplies it. Results include `scope:{period,currency,currencies,ledger_version,settings_version,calculation_version,event_ids}`. Financial calculations stay in the requested original currency; missing records/assumptions degrade instead of reusing another currency's result. The UI invalidates late responses on scope/session changes.

Confirmation previews for `confirm_draft`, `confirm_draft_batch` and `command_apply` can include `duplicate_review` and `duplicate_ledger_version`. Each review contains `candidate_id`, candidate fields, matching record fields/source, and the match reason. Final requests with matches require `duplicate_resolutions:[{candidate_id,reason}]` covering the exact candidates; reasons are 5–500 trimmed characters. This applies to single/batch/Agent commits. A ledger change invalidates the preview. Overrides remain in event evidence; transport idempotency remains separate.

## Cloud staging transport

Cloud mode keeps domain paths and uses a separate ASGI service. Browser `/api/*` requests use server-managed Supabase SSR cookies; the BFF forwards a verified provider bearer token to the loopback API. No client `tenant_id/user_id/workspace_id` is accepted. Backend JWT verification, confirmed non-anonymous identity, closed-preview admission, membership and device-session checks precede domain access. Roles/GUCs are transaction-local. Query parameters are limited to public `period` scope.

| Browser API | Contract |
|---|---|
| `POST /api/session` | `{email,password,captchaToken?}`; returns authenticated or MFA-required state; never accepts a local access code in cloud mode |
| `POST /api/auth/sign-up` | Same credentials, password at least12 characters; disabled unless public signup is explicitly configured |
| `POST /api/auth/recover` | `{email,captchaToken?}`; generic response; PKCE callback and five-minute token-bound recovery marker |
| `POST /api/auth/reset` | `{password}`; requires verified recovery session/marker; revokes application sessions before provider password update |
| `POST /api/auth/mfa/list,enroll,verify,unenroll` | Managed TOTP; enrollment requires AAL2 if another factor is verified; verification uses `{factor_id,code}`; no model grants MFA |
| `GET /api/account` | Own devices, personal rules, closed billing state; no plan prices/quotas invented |
| `POST /api/account/sessions/revoke` | `{session_id}` from the authenticated user's device list |
| `POST /api/account/sessions/revoke-all` | Empty object; affects only this user's space |
| `POST /api/personal-rules` | `{merchant,category,currency,confirmed:true}`; future uncategorized drafts only |
| `DELETE /api/personal-rules/{id}` | `{version}`; revokes rule without changing ledger history |
| `POST /api/feedback` | `{kind,comment,resource_id?}`; no training opt-in accepted |
| `GET /api/documents` | Own private metadata and quarantine state |
| `POST /api/documents` | `{base64,mime_type,purpose}`; <=5MB, fixed private bucket and server-generated owner key; quarantined until an isolated worker validates it |
| `GET /api/documents/{id}/download` | Reauthenticated proxy download for clean, unexpired, owned objects; no permanent public URL |
| `DELETE /api/documents/{id}` | `{confirmed:true}`; removes original file, leaves financial facts separate |
| `POST /api/migration/preview` | `{archive}`; schema-2 local JSON, manifest/source hash, session/version-bound two-minute preview |
| `POST /api/migration/commit` | `{nonce,content_hash,access_code}`; `access_code` means cloud account password; atomic rows/nonce/receipt; old grants/sessions/confirmations do not migrate |
| `GET /api/billing` | Explicit disabled state |
| `POST /api/billing/*` | 503 `BILLING_DISABLED`; no checkout/payment/paid entitlement |

In cloud mode, the existing privacy confirmation field `access_code` is reinterpreted only as the authenticated cloud account password; it is not stored. Cloud erasure requires independent signed deletion control and removal of private file objects. The current operation deletes application data and revokes sessions; identity-provider account deletion remains a separate pending lifecycle integration.

Cloud OCR/evidence parsing and external model-preview/explanation requests return explicit unavailable errors until their worker/provider/budget gates are implemented and configured. They do not fall back to Demo presets. The existing local OCR and optional local OpenAI adapter retain their separate behavior.
## 站内通知补充 · 2026-10-16

`GET /v1/notifications?period=YYYY-MM`返回当前用户的记录派生通知；`GET /v1/state`同样附带`notifications`。字段包含`items/unread_count/period/as_of/ledger_version/settings_version/analysis_authorized/delivery/live_bank_or_market`，其中`delivery=in_app`、实时银行/行情标记为false。通知包含结构化来源与跳转范围，不修改账本。

`POST /v1/notifications/read`只接受`{period,ids}`，最多50个当前空间的通知ID；无效归属或已变化的通知返回404。已读设置保留最多500个ID，不推进金融版本，不消耗确认nonce，隐私导出/删除覆盖。正式接口没有预设回退；Demo实现相同契约且保持离线。[详细规则](UI_NOTIFICATIONS.md)。
