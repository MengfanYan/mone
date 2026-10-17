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

const result = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build", "--webpack"],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      WALLET_UI_MODE: "live",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
