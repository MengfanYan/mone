import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build", "--webpack"],
  {
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
