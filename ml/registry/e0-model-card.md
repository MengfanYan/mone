# wallet-e0-1

Implemented baseline: deterministic intent rules, four read-only tools, exact Decimal calculations and Chinese explanation templates. No neural weights, model API, tokenizer, adapter, training or GPU runtime.

Versions: `decimal-ledger-1`, `local-risk-1`, `readonly-1`, `zh-templates-1`.

Intended use: one local operator inspecting confirmed ledger summaries, cash scenarios, budgets and manually entered holdings. Unknown requests ask for clarification. The assistant cannot confirm, change consent, share, export, delete, trade or make personalized product recommendations.

Evaluation: `npm run eval` generates the report and 50 plan traces from the frozen synthetic dataset. Results apply only to these cases. Rules rely on keywords and are conservative; negation, multi-turn references, nuanced classification and arbitrary questions are not validated language understanding. There is no claim of SFT/DPO/RLHF or distillation performance.

Rollback: disable generation by revoking analysis consent, or revert the baseline code while retaining current permission rules. Ledger access and manual confirmation are independent of the assistant. Never restore old consent/deletion state to roll back an artifact.
