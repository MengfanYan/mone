import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";

// Inspect only Git-visible source candidates; never read ignored private files.
const files = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean),
  ),
];
const forbidden =
  /(^|\/)(?:\.local-data|\.cloud-test-data|\.aws|\.ssh|\.codex|\.agents|node_modules|\.next[^/]*|\.venv[^/]*|reports|test-results|playwright-report)(\/|$)|\.(?:sqlite3?|db)(?:-[^/]*)?$|\.(?:pem|key|p12|pfx|log)$/i;
const signatures = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
];
const failures = [];
for (const file of files) {
  const base = file.split("/").at(-1);
  if (
    forbidden.test(file) ||
    (base.startsWith(".env") &&
      ![".env.example", ".env.cloud.example"].includes(file))
  ) {
    failures.push(`${file}: private/generated path`);
    continue;
  }
  let stat;
  try {
    stat = lstatSync(file);
  } catch (e) {
    if (e.code === "ENOENT") continue;
    throw e;
  }
  if (stat.isSymbolicLink()) {
    failures.push(`${file}: review symlink before publication`);
    continue;
  }
  if (!stat.isFile()) continue;
  if (stat.size > 50 * 1024 * 1024) {
    failures.push(`${file}: larger than 50 MiB; review distribution`);
    continue;
  }
  const data = readFileSync(file);
  if (data.includes(0)) continue;
  const body = data.toString("utf8");
  if (signatures.some((pattern) => pattern.test(body)))
    failures.push(`${file}: possible credential signature (value withheld)`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Repository candidate check passed (${files.length} files). Review staged changes before commit; this is not a complete secret scan.`,
  );
