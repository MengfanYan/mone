import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
const localEnv = path.join(root, ".env.local");
const envKeys = new Set([
  "PORT",
  "API_PORT",
  "WALLET_MODE",
  "WALLET_DB",
  "LOCAL_ACCESS_CODE",
  "PYTHON",
  "OPENAI_API_KEY",
]);
if (existsSync(localEnv)) {
  for (const line of readFileSync(localEnv, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match || !envKeys.has(match[1]) || process.env[match[1]] !== undefined)
      continue;
    const value = match[2]
      .trim()
      .replace(/^(?:"(.*)"|'(.*)')$/, (_, double, single) => double ?? single);
    process.env[match[1]] = value;
  }
}
const mode = process.argv[2] || "dev";
if (!["dev", "start"].includes(mode)) throw new Error("Use dev or start");
if (process.env.WALLET_MODE && process.env.WALLET_MODE !== "local")
  throw new Error("Only local mode is supported");
if (mode === "start" && !existsSync(path.join(root, ".next/BUILD_ID")))
  throw new Error("Run npm run build before npm start");
const port = process.env.PORT || "3000";
const apiPort = process.env.API_PORT || "8765";
for (const value of [port, apiPort]) {
  if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535)
    throw new Error("Ports must be between 1024 and 65535");
}
if (port === apiPort) throw new Error("PORT and API_PORT must be different");
async function checkPort(value) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error) => {
      const message =
        error.code === "EADDRINUSE"
          ? `Port ${value} is already in use. Stop the existing server with Ctrl+C in its terminal, then run npm run ${mode} again. If the app is already running, open http://localhost:${port}.`
          : `Cannot check port ${value}: ${error.code || error.message}`;
      reject(new Error(message));
    });
    probe.listen(Number(value), "127.0.0.1", () => probe.close(resolve));
  });
}
try {
  await checkPort(port);
  await checkPort(apiPort);
} catch (error) {
  console.error(`\nUnable to start Financial Agent: ${error.message}\n`);
  process.exit(1);
}
const code =
  process.env.LOCAL_ACCESS_CODE || randomBytes(18).toString("base64url");
if (code.length < 12 || code.length > 200)
  throw new Error("LOCAL_ACCESS_CODE must be 12–200 characters");
const env = {
  ...process.env,
  WALLET_UI_MODE: "live",
  PORT: port,
  API_PORT: apiPort,
  LOCAL_ACCESS_CODE: code,
  NEXT_TELEMETRY_DISABLED: "1",
  PYTHONUNBUFFERED: "1",
};
console.log(
  `\nMone · Local workspace\nURL: http://localhost:${port}\nLocal access code: ${code}\nKeep this terminal open. Ctrl+C stops both services.\n`,
);
const children = [];
let stopping = false;
function stop(status = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(status);
  }, 1200);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
function launch(command, args) {
  const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (status) => {
    if (!stopping) stop(status || 1);
  });
  return child;
}
launch(process.env.PYTHON || "python3", ["-m", "services.api.server"]);
let ready = false;
for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
  try {
    const response = await fetch(`http://127.0.0.1:${apiPort}/v1/health`);
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    /* The API is still starting. */
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!ready) {
  console.error("Python API did not become ready");
  stop(1);
} else
  launch(process.execPath, [
    "node_modules/next/dist/bin/next",
    mode,
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ]);
