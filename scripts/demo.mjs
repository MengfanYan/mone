import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
const mode = process.argv[2] || "dev";
if (!["dev", "build", "start"].includes(mode))
  throw new Error("Use dev, build or start");
const port = process.env.DEMO_PORT || "3001";
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
  throw new Error("DEMO_PORT must be between 1024 and 65535");
if (mode === "start" && !existsSync(path.join(root, ".next-demo/BUILD_ID"))) {
  console.error("Run npm run demo:build before npm run demo:start");
  process.exit(1);
}
if (mode !== "build") {
  try {
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(Number(port), "127.0.0.1", () => probe.close(resolve));
    });
  } catch (error) {
    console.error(
      `Unable to start demo: ${error.code === "EADDRINUSE" ? `port ${port} is already in use. Stop its server or set DEMO_PORT to another port.` : error.message}`,
    );
    process.exit(1);
  }
  console.log(
    `\nZhiZhang · Offline product demo\nURL: http://localhost:${port}\nNo API, Python service, access code or external credentials required.\nAll scenarios use preset synthetic data. Ctrl+C stops this demo server.\n`,
  );
}
const args = ["node_modules/next/dist/bin/next", mode];
if (mode === "build") args.push("--webpack");
else args.push("--hostname", "127.0.0.1", "--port", port);
const child = spawn(process.execPath, args, {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, WALLET_UI_MODE: "demo", NEXT_TELEMETRY_DISABLED: "1" },
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 1500);
  timeout.unref();
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
child.once("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.once("exit", (code) => process.exit(stopping ? 0 : (code ?? 1)));
