# Run and use 知账 / Financial Agent

2026-10-16: the eight modules now share the supplied dark SaaS design, with home notifications and an unread bell. Alerts use confirmed records and saved prices; no real-time bank or market feed is implied. Restart the existing development service and refresh the browser to load the new Python endpoints. See [UI and notifications](UI_NOTIFICATIONS.md).

This is a working **local, single-operator MVP** of the three design documents. No cloud account, bank password, model key, or GPU is required. Node 22+ and Python 3.11+ are required. `.nvmrc` pins the validated Node 22.23.3 runtime (matching `Dockerfile.cloud` and CI), and `.npmrc` enforces `engine-strict=true` and `save-exact=true`; with nvm installed, run `nvm install && nvm use` before `npm ci`. Launcher scripts (`run.mjs`, `demo.mjs`, `build.mjs`, `cloud.mjs`, `check.mjs`) also automatically delegate to the workspace-pinned `node_modules/node/bin/node` (22.23.3) if invoked under an older shell Node. Chinese/English image OCR additionally needs a local `tesseract` executable; text receipts work without it.


The cloud staging build shares the same Node 22.23.3 baseline and adds a Supabase/PostgreSQL setup: [CLOUD_RUNNING](CLOUD_RUNNING.md). Run `npm run cloud` after configuration; it uses port 3002 and `.next-cloud`. Billing stays off. Local commands below retain their existing single-operator behavior. For locked package versions and conflict-prevention rules across collaborators and cloud builds, see [Dependency review](DEPENDENCY_REVIEW.md).

```bash
npm ci
npm run dev
```

Open the URL printed in the terminal, normally **http://localhost:3000**, and enter its generated **Local access code**. Keep the terminal running. Ctrl+C stops the frontend and API. The default API port is 8765; both servers bind to 127.0.0.1. Use the exact localhost/127.0.0.1 URL, not a LAN hostname.

For a production-optimized local build:

```bash
npm run build
npm start
```

This is still local mode. It is not a hosted production deployment.

## Customer demo without APIs

Run `npm run demo` and open **http://localhost:3001** for a populated, bilingual product demo. It requires no Python service, access code, API key or external provider. All market, AI and receipt outputs are preset simulations; bookkeeping changes and scenario amounts update locally. **Reset demo** restores the original scenarios. Demo changes use a separate browser storage key and do not change the live database or sessions.

For the optimized demo, run `npm run demo:build` then `npm run demo:start`. Use `DEMO_PORT` to choose another port. The live commands above remain unchanged; `/demo` is also available from the live sign-in page. Full customer walkthrough and isolation details: [Demo guide](DEMO.md).

## Language and interface

The interface opens in **English**. Use **EN / 中文** on the sign-in screen or workspace header to switch languages; the preference is remembered on this browser and applied on the first server-rendered page. Navigation, forms, confirmations, notices, analysis and PDF statements support both languages. Switching retains unsaved form values and uses the same frozen statement snapshot. Account names, merchants, categories and imported text retain their original content. CSV headers and API identifiers stay stable.

The dashboard uses a white workspace, a compact sidebar, dark green and lime highlights, weekly income/expense bars, approved budget progress and recent confirmed transactions. Its visual direction was informed by [Fundcy Finance Dashboard](https://dribbble.com/shots/25178389-Fundcy-Finance-Dashboard); the implementation and chart data are original to this project. Charts follow the ledger’s exact-money rules, including refunds and reversals, and keep currencies separate. No sample chart amounts appear in an empty personal workspace.

## First workflow

1. Open **Privacy & consent / 隐私与授权**, enable **Local analysis consent / 本地分析授权**, review the preview and confirm. Both analysis and receipt recognition start off.
2. In **Dashboard / 财务概览**, choose **Try the demo / 体验合成案例** to try the documented example, or **Add account / 添加账户** for your own local records. A liability opening balance is the positive amount owed. The opening date is its observation date; for monthly cash bridges use the actual balance from before the month starts.
3. In **Transactions / 账本与导入**, review each imported draft, correct mistakes, then choose **Review & confirm / 核对并确认**. Reject accidental or duplicate drafts. Unconfirmed drafts never change the ledger.
4. For the four-record synthetic example, confirmed income is 12,000 CNY, expenses 7,500, cash change 3,500, and closing cash 33,500. The 1,000 principal repayment is not another expense. Every synthetic record and report remains marked MOCK.
5. Add approved cash-flow assumptions, budgets and goals in **Budgets & goals / 预算与目标**. Blank means unknown. The scenario deducts earmarked funds and does not assume investment returns.
6. Use **Statements / 月度账单** to preview and download a PDF from a fixed snapshot. Later data produces a new version; old versions retain their original numbers. Reports are provisional because bank reconciliation and coverage verification are not implemented.
7. **Analysis / 分析助手** contains the shared local task entry; choose **Read-only analysis** for E0 explanations. `/analyses` itself cannot modify records, authorize, export, delete, share, pay or trade. **Portfolio / 投资记录** accepts stable local entries and append-only estimates/history, marking unknown costs and incomplete sources.

PDF statements include separate currency summaries, the cash bridge, category expenses and a coverage/evidence appendix. Saved versions open directly in the PDF viewer; use its page arrows, zoom selector and **Download PDF / 下载PDF**. Changing language renders the same snapshot in English or Chinese. Font and viewer assets are served locally, without a CDN, remote renderer or new API requirement. The demo warms these assets before opening the workspace for offline use. Evidence mode now accepts text PDFs (up to 5 pages / 20,000 characters) and single-page scanned PDFs (5 MiB); parsing/rendering happens locally. Scanned PDFs use the existing separately consented local OCR flow. Multi-page scans must be split.

## CSV

Required headers: `date,amount,currency,merchant`. Optional: `category,kind,account_id,counterparty_id,refund_of,external_id`.

```csv
date,amount,currency,merchant,category,kind,external_id
2026-09-03,12000.00,CNY,Synthetic salary,工资,income,source-001
2026-09-05,138.50,CNY,Synthetic groceries,食品,expense,source-002
```

Select an account in the UI if `account_id` is omitted. For the provided synthetic fixtures, enable the CSV/account **MOCK** checkbox so demo provenance remains visible. Amounts must be positive decimal strings; `kind` sets direction. Currency must match the account. A CSV uses one explicit date format, UTF-8, at most 1 MiB and 500 rows. Bad rows roll back the entire import. Stable source IDs deduplicate across files; exact same files without IDs also deduplicate. Similar transactions without strong IDs require review, not automatic deletion.

Supported kinds: `income`, `expense`, `transfer`, `card_payment`, `loan_received`, `debt_principal`, `interest`, `dividend`, `investment_buy`, `investment_sell`, `refund`. Transfers and debt operations require a same-currency counterparty account. Refunds require the original confirmed expense ID and cannot exceed it. Investment buy/sell records are explicitly **principal amounts**, not inferred gains or performance. Enter realized income/fees separately using the appropriate income/expense type.

Currencies: AUD, CNY, USD, EUR, GBP, NZD, CAD, HKD, SGD (2 decimals), JPY/KRW (0), KWD/BHD (3). There is no guessed FX conversion. Negative holdings and future observed prices are rejected. Future transaction drafts cannot be confirmed as already occurred events.

## Receipt recognition and public market data

Enable **Local receipt recognition / 本地凭证识别** separately. The shared **Evidence & screenshots** task mode accepts receipt, bank-row and investment text, or PNG/JPEG up to 5 MiB / 25 million pixels. Local Tesseract uses bundled `models/ocr/chi_sim.traineddata` and `eng.traineddata` (Apache-2.0); install the Tesseract executable itself if missing. It preserves text/word boxes and uncalibrated scores. Currency/account/date/transfer counterparty gaps require correction; `$`, `dollars` or `元` alone do not establish currency. Bank balances are excluded from transaction amounts. A fund's daily and cumulative gains remain separate and neither creates salary income. Only three authored clean Chinese layouts have been validated, not general vendor screenshots. The evidence workbench displays the source preview and word-box links. Text PDFs are extracted locally; one-page scans render to the same bounded OCR path. Images are temporary; extracted review evidence persists until deletion. The expandable legacy receipt tool still supports its original English-only route.

In **Analysis / 分析助手**, the explicit **Fetch public BLS history / 获取BLS公共历史数据** button requests one fixed public series, [CUUR0000SA0](https://data.bls.gov/timeseries/CUUR0000SA0), from the [official BLS API](https://www.bls.gov/developers/api_signature_v2.htm). The series is the US city average all-items CPI-U, not seasonally adjusted, index base 1982–84=100. Only public series parameters leave the device. Publication time is unknown/null, retrieval time is separate, and corrections are appended. The connector accepts no caller URLs, refuses private DNS addresses/redirects, has network limits, and allows one successful refresh per hour. Provider/network failures leave historical data unchanged; no mock fallback is generated. It is historical US background, not Australian CPI, current securities pricing, or a forecast of personal spending.

## Data and privacy

The default database is **`.local-data/wallet.sqlite3`**, outside version control. The directory and file have private permissions. SQLite data is **not field-encrypted**; use device disk encryption and a private OS account. This application does not provide server-unreadable end-to-end encryption.

The access code is generated at each launch. Sessions last 12 hours and restart invalidates them. A fixed code is optional: copy `.env.example` to `.env.local`, set a private `LOCAL_ACCESS_CODE` of 12–200 characters, and restart. The launcher reads only the documented local configuration keys. Shell variables override the file. Never commit `.env.local`, the database, exports or real receipt fixtures.

Use **Lock workspace** when leaving, including the lock icon on phones. It revokes the session and clears sensitive open forms and previews. The database is created with private permissions before the first write; the browser receives a per-response script CSP nonce and security headers. These protections do not encrypt files. For data flow, encrypted-device storage, export/backup handling, deletion limits and hosted-deployment requirements, see [Security and storage](SECURITY.md).

To export or delete, re-enter the local code in **Privacy & consent / 隐私与授权**, review the resource counts and confirm. Delete clears the database's private content, reports, draft evidence, audit metadata and derived data, compacts it, and revokes all sessions. It cannot erase downloaded files, OS snapshots, disk remnants or independently copied backups; manage those yourself. No automatic backup restore is offered. Changing the local access code does not encrypt the database.

## Configuration

| Key | Default | Use |
|---|---|---|
| `PORT` | `3000` | Local frontend port |
| `API_PORT` | `8765` | Python API port |
| `LOCAL_ACCESS_CODE` | generated | Local login / reauthentication |
| `WALLET_DB` | `.local-data/wallet.sqlite3` | Private database path |
| `PYTHON` | `python3` | Python executable |
| `WALLET_MODE` | `local` | Other modes are refused |

If a port is occupied, an earlier server may still be running. Open its URL, or stop it with Ctrl+C in the terminal that started it before running `npm run dev` again. To run another independent instance, choose different frontend/API ports in `.env.local` or your shell. The launcher checks ports before starting and never silently selects a different one. Start the Python API and Next together via the launcher; running only `next dev` will not start the backend.

## Verification

```bash
npm test              # exact money, ledger, confirmations, consent, privacy, market contracts
npm run eval          # 200 synthetic E0 regressions and 50 tool traces
npm run lint
npm run test:pdf       # bilingual PDF glyphs, exact decimals and long-content pagination
npm run build
npx playwright install chromium
npm run test:e2e      # isolated temporary database, desktop + mobile
npm audit
```

`npm run check` runs Python tests, demo logic tests, PDF regression tests, lint and both live/demo builds. Browser tests require a build first. To reuse an existing local Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its full executable path. Browser fixtures never use the default personal database. `reports/e0-eval.json` and `reports/e0-traces.jsonl` contain synthetic results; generated UI screenshots are ignored by git.

The architecture and pending gates are recorded in [ADR 001](adr/001-local-delivery.md). The original roadmap remains useful, but its cloud, bank, regulated advice, qualified review, general vendor PDF accuracy, training, GPU and automatic backup recovery claims must not be treated as implemented.

## One sentence, reviewed local changes

The shared composer on Dashboard, Transactions and Analysis supports local English/Chinese rules without API keys. Choose an account only when you approve that context. Try `Coffee 7 AUD`, `2026-09-10 Coffee 7 AUD, Salary 200 CNY`, `find this month Dining`, `change just Coffee to 6.50`, or `delete Coffee <stable-id>`. Ambiguous currencies/accounts/targets appear on result cards. Edit a card, save selected drafts, or review and confirm the selected operations. Inputs and results persist between tabs and languages. `cancel task` / `取消任务` stops an unsubmitted plan; `keep only first` / `只要第一条` changes selection. Confirmed records are corrected by reversal + replacement, preserving history. Refund-linked records require their dependencies to be handled first.

The grammar is bounded, not a general LLM: use separate clauses, ISO dates and exact IDs/names when a phrase is unclear. More than one unresolved amount in a clause requires correction. Commands for local budgets/goals/accounts/investments also produce plans; account creation/renaming/archiving preserves opening entries. No command pays, trades, shares or deletes the full database. Basic record operations work with analysis disabled; analytical totals/performance need analysis, evidence extraction needs OCR.

Portfolio now uses stable investment entries. Add an observation to the same item; supplying market value directly does not invent a quantity. Update the same timestamp only with an explicit revision. Complete known histories show cumulative net gain; incomplete ones show known components, a reported-only curve or valuation/unknown state. Add buy/sale allocated costs/dividends/fees as actual history events. Unrealized rate is available only with positive known cost; no TWR/XIRR. Currency and monthly timestamp boundaries follow the selected scope and user timezone. Traditional forms open in an editor; CSV/legacy receipt tools are under an expandable section. Phone navigation has four primary items plus More.

Schema 2 migration runs on startup, maps each old holding ID independently and retains fixed reports. See [ADR 002](adr/002-local-commands-and-investment-history.md) before upgrading a real database. Current Chromium acceptance passed 22 live and 21 executed demo checks, including eight widths, landscape/short windows, 200% CSS zoom, PDF, offline and privacy. Evidence and coverage limits: [UX validation](UX_VALIDATION.md).

Additional local verification:

```bash
python3 scripts/validate_ux_ocr.py       # actual local OCR, three synthetic PNGs
python3 scripts/benchmark_experience.py # synthetic 100/500-event Store timings
```


## Six-reference terminal workspace

The current UI uses the six supplied dark terminal references: navy panels, emerald/blue/violet states, compact global search, eight bilingual modules and a responsive floating task Agent. **Cmd/Ctrl+K** opens module search; the eye icon hides financial content. Density is adjustable in Settings.

- **Dashboard**: recorded-asset allocation, exact weekly cash-flow facts, review queue and traceable local-rule prompts. Different currencies are never pooled.
- **Transactions**: source/word-box inspection, text or one-page scanned PDF input, type/date/search filters, exact-amount sorting, selection and filtered CSV download. Exports preserve original currency and flag synthetic records.
- **Portfolio**: user-defined target weights must total exactly 100%; review/export a currency-exact worksheet. No broker orders. The risk lab accepts 21–500 regular unit-price observations and computes a single-series historical loss percentile and interval volatility. It does not infer prices from holding values or claim whole-portfolio VaR.
- **Budgets & goals**: the original approved budgets remain intact. A separate seeded monthly Monte Carlo scenario supports editable assumptions, 5th–95th percentile charts, model success rate, required contribution, reset and JSON export. Figures are approximate illustrations in today's purchasing power, not ledger facts or guarantees.
- **Privacy & consent**: actual audit chain, capability boundaries, screen privacy, reviewed encrypted backup export and local password/file verification. Working SQLite and ordinary exports remain plaintext; see [security](SECURITY.md).
- **Settings**: persistent model/output/retrieval parameters, local TXT/MD/text-PDF library and attributed lexical search. The optional model adapter uses a fixed OpenAI Responses endpoint. Set `OPENAI_API_KEY` in `.env.local`, restart live mode and review the exact payload before each request. The E0 assistant and local command parser remain separate and read-only as before. No key is required for the product demo.

No LangChain, LangGraph or external vector database was added. The small local corpus uses hashed lexical vectors with explicit limits, not a neural embedding service. No real API key, customer data or paid model request was used in validation. See [ADR 003](adr/003-terminal-reference-workspace.md).

### Floating Agent and Live empty states

The Agent icon opens a task popup on every authenticated module (desktop corner; phone top bar). It starts closed; there is no reserved right column or inline task composer. Enter a record/query task or an analysis question. Read-only analysis questions use the existing local analysis API; this does not imply a connected cloud model. Review and confirm financial changes in the popup before posting them. Successful posting refreshes the affected module and, for a single dated/currency task, selects that month/currency. Minimizing preserves the current task; locking clears its private UI state.

Live starts with data returned by the local API. The planning simulator starts with blank financial assumptions and no projection; fill the inputs and choose **Run simulation** to request a calculation. API failure displays an error without a Demo fallback. Example accounts/transactions are available through the isolated `/demo` workspace, rather than being created inside Live. Fresh browser preferences default to English; an explicitly saved language preference remains respected. Original user record text is preserved. Previously saved MOCK records remain labelled as such; existing data is never silently deleted by a UI update.
