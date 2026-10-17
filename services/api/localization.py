"""Presentation localization only. Never translate stored records or confirmation payloads."""
import copy
import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path

CATALOG = json.loads((Path(__file__).resolve().parents[2] / "locales/catalog.json").read_text())


def language(header):
    return "zh" if isinstance(header, str) and header.lower().startswith("zh") else "en"


@lru_cache(maxsize=1)
def template_patterns():
    result = []
    for key, value in CATALOG.items():
        if not re.search(r"\{\w+\}", key):
            continue
        for source in (key, value):
            names = []
            pieces = []
            for part in re.split(r"(\{\w+\})", source):
                if re.fullmatch(r"\{\w+\}", part):
                    names.append(part[1:-1])
                    pieces.append("([\\s\\S]*?)")
                else:
                    pieces.append(re.escape(part))
            result.append((key, names, re.compile("^" + "".join(pieces) + "$")))
    return result


def text(value, locale):
    if not isinstance(value, str) or locale == "zh":
        return value
    if value in CATALOG:
        return CATALOG[value]
    for key, names, pattern in template_patterns():
        match = pattern.fullmatch(value)
        if match:
            variables = dict(zip(names, match.groups()))
            if "field" in variables:
                variables["field"] = CATALOG.get(variables["field"], variables["field"])
            return re.sub(r"\{(\w+)\}", lambda part: variables.get(part[1], part[0]), CATALOG[key])
    return value


def error_message(message, code, locale):
    translated = text(message, locale)
    if locale == "en" and re.search(r"[\u3400-\u9fff]", translated):
        # Field errors remain actionable without exposing untranslated internal labels.
        return f"{code.replace('_', ' ').capitalize()}. Check the details and try again."
    return translated


def _notes(record, locale):
    for key in ("limitations", "assumptions", "actions", "remaining"):
        if isinstance(record.get(key), list):
            record[key] = [text(item, locale) for item in record[key]]
    for key in ("label", "message"):
        if key in record:
            record[key] = text(record[key], locale)


def statement_markdown(snapshot, version):
    """Render English from the same immutable snapshot; categories retain source text."""
    lines = [f"# {snapshot['period']} Personal Financial Statement",
             f"Version: v{version} | Status: Provisional | mock: {str(snapshot['mock']).lower()}",
             f"Analysis cutoff: {snapshot['cutoff']} | Time zone: {snapshot['timezone']}",
             f"Ledger version: {snapshot['ledger_version']} | Calculation: {snapshot['calc_version']}",
             "This is personal financial analysis, not an official bank statement or audit certificate.",
             "", "## Coverage and limitations",
             f"Unconfirmed drafts: {snapshot['pending_drafts']}. Coverage is unknown; currencies remain separate without FX evidence."]
    lines.extend(text(item, "en") for item in snapshot["limitations"])
    lines.extend(["", "## Income, expenses and cash bridge"])
    for summary in snapshot["summary"]:
        lines.extend([f"### {summary['currency']}",
                      f"Income {summary['income']}; expenses (net of refunds) {summary['expenses']}; income less expenses {summary['surplus']}.",
                      f"Opening cash {summary['opening_cash']} + cash movement {summary['cash_change']} = closing cash {summary['closing_cash']}.",
                      "Credit-card purchases count as expenses; principal repayments do not count twice. Investment and loan principal are not salary.",
                      "", "| Category | Expenses |", "|---|---:|"])
        for category, amount in summary["categories"].items():
            safe = category.replace("|", "\\|").replace("<", "&lt;").replace(">", "&gt;")
            lines.append(f"| {safe} | {amount} |")
    lines.extend(["", "## Revisions and evidence", text(snapshot["revision_reason"], "en"),
                  f"Snapshot: {snapshot['snapshot_id']}", "Transaction IDs: " + ", ".join(snapshot["event_ids"]),
                  "", "## Market and investment limitations",
                  "No live market context or trading advice without valid sources and month-end valuation evidence."])
    return "\n".join(lines)


def result_for(path, result, locale):
    # Export and challenges must preserve original financial content/hash/version bindings.
    if locale == "zh" or (path == "/v1/privacy/export" or path.startswith("/v1/confirmation-challenges")):
        return result
    output = copy.deepcopy(result)
    _notes(output, locale)
    if path == "/v1/state":
        for item in output.get("portfolio", []):
            _notes(item, locale)
        for item in output.get("market_evidence", []):
            _notes(item, locale)
        for draft in output.get("drafts", []):
            _notes(draft["evidence"], locale)
        if output.get("risk"):
            _notes(output["risk"], locale)
            for finding in output["risk"]["findings"]:
                _notes(finding, locale)
    if path == "/v1/analyses":
        for key in ("facts", "calculations"):
            for item in output.get(key, []):
                _notes(item, locale)
    if path.startswith("/v1/statements/") and "markdown" in output:
        output["markdown"] = statement_markdown(output["snapshot"], output["version"])
        output["sha256"] = hashlib.sha256(output["markdown"].encode()).hexdigest()
        output["language"] = "en"
    return output
