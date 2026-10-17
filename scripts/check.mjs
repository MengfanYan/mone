import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (Number(process.versions.node.split(".")[0]) < 22) {
  const runtime = path.join(root, "node_modules/node/bin/node");
  if (!existsSync(runtime))
    throw new Error(
      "Financial Agent requires Node 22+ (validated 22.23.3 in .nvmrc). Run 'nvm use' or 'npm ci' first.",
    );
  const result = spawnSync(
    runtime,
    [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit", env: process.env },
  );
  process.exit(result.status ?? 1);
}

for (const [command, args] of [
  [
    process.env.PYTHON || "python3",
    ["-m", "unittest", "discover", "-s", "tests", "-v"],
  ],
  [
    process.execPath,
    [
      "--test",
      "tests/demo/client.test.mjs",
      "tests/demo/experience.test.mjs",
      "tests/demo/page-insights.test.mjs",
      "tests/demo/terminal.test.mjs",
      "tests/demo/advisory.test.mjs",
      "tests/demo/notifications.test.mjs",
    ],
  ],
  [process.execPath, ["--test", "tests/pdf/statement.test.mjs"]],
  [process.execPath, ["--test", "tests/cloud/recovery.test.mjs"]],
  [process.execPath, ["node_modules/eslint/bin/eslint.js", "."]],
  [process.execPath, ["scripts/build.mjs"]],
  [process.execPath, ["scripts/demo.mjs", "build"]],
]) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
