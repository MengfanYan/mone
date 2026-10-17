import { spawnSync } from "node:child_process";
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
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
