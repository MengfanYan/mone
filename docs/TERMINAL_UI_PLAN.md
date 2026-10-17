# Six-reference terminal UI · 2026-10-15

User request: implement the visual style and missing usable modules from the six images at https://chatgpt.com/s/m_6ad018de2cc481919f71cbd28357f387. Reference images were read in the user's Chrome tab and downloaded through its visible page-assets interface; local QA copies: `reports/reference-01.png`–`reference-06.png`.

Visual direction: near-black navy workspace, slim full-height navigation, compact global search/status header, blue/violet active states, emerald positive amounts, amber uncertainty, blue asset charts, violet insight panels; full-width module content with a single floating task Agent, sized popup layouts on smaller screens. Preserve English default/Chinese switch, exact currency arithmetic and PDF statements.

Implementation checklist:

- [x] Terminal theme and responsive shell; searchable command palette; screen-privacy control and floating Agent popup.
- [x] Dashboard asset allocation and known-data insight panels without invented real-time/LLM claims.
- [x] Billing side-by-side source preview, OCR word-box highlighting, record selection/filter/export, local PDF text / one-page scan extraction.
- [x] Portfolio allocation, a single-series historical unit-price risk lab (not whole-portfolio VaR), user-defined allocation worksheet and reviewed export; no broker execution.
- [x] Seeded Monte Carlo planning with adjustable assumptions, percentile curve and reproducible success-rate/contribution calculations, separate from ledger facts.
- [x] Security view with actual access capabilities, actual hash-chain audit log, visual masking and password-encrypted backup download; distinguish this from database-at-rest encryption.
- [x] Settings view for saved model/retrieval choices, local document indexing/search, connection status and optional server-side model interface. No real keys or financial data used during development/testing.
- [x] Formal API / offline Demo parity, consent/confirmation/export/delete coverage, relevant business tests, dual builds, bilingual/browser/responsive/contrast validation and new screenshots.

Image-only claims such as live Bloomberg/Yahoo, zero knowledge, bank-grade full database encryption, tax-provider connectivity, guaranteed performance and automatic trading must not be presented as active when absent. Implement real local capabilities and explicit optional integration paths; preserve existing single-user access and reviewed immutable ledger writes. Demo remains synthetic and offline.

2026-10-15 correction: the user clarified that the Agent must be a chat-style launcher, not a permanent activity rail. Live financial scenario assumptions now start blank and require an explicit successful local API request. Demo retains illustrative defaults.
