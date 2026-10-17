import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { randomBytes, createHash } from "node:crypto";

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
if (existsSync(path.join(root, ".env.cloud.local")))
  process.loadEnvFile(path.join(root, ".env.cloud.local"));
const mode = process.argv[2] || "dev";
if (
  !["dev", "build", "start", "migrate", "preflight", "restore"].includes(mode)
)
  throw new Error("Use cloud dev, build, start, migrate or preflight");
const python =
  process.env.CLOUD_PYTHON ||
  (existsSync(path.join(root, ".venv-cloud/bin/python"))
    ? path.join(root, ".venv-cloud/bin/python")
    : "python3");
const env = {
  ...process.env,
  WALLET_UI_MODE: "cloud",
  NEXT_TELEMETRY_DISABLED: "1",
  API_PORT: process.env.API_PORT || "8766",
};
// Migration credentials are never inherited by the API or Next.js runtime.
const runtimeEnv = { ...env };
delete runtimeEnv.CLOUD_MIGRATION_DATABASE_URL;
delete runtimeEnv.CLOUD_RESTORE_DATABASE_URL;
const webEnv = { ...runtimeEnv },
  apiEnv = { ...runtimeEnv };
for (const key of [
  "CLOUD_DATABASE_URL",
  "CLOUD_JOURNAL_SERVICE_KEY",
  "CLOUD_DELETION_KEYS_JSON",
  "CLOUD_MIGRATION_DATABASE_URL",
  "CLOUD_RESTORE_DATABASE_URL",
  "OPENAI_API_KEY",
])
  // An empty value also prevents Next's .env loader from restoring local secrets.
  webEnv[key] = "";
for (const key of ["CLOUD_AUTH_FLOW_SECRET", "OPENAI_API_KEY"])
  delete apiEnv[key];
function run(command, args, childEnv = runtimeEnv) {
  return spawn(command, args, { cwd: root, stdio: "inherit", env: childEnv });
}
if (["migrate", "preflight", "restore"].includes(mode)) {
  const child = run(
    python,
    ["-m", `services.cloud.${mode}`],
    ["migrate", "restore"].includes(mode) ? env : runtimeEnv,
  );
  child.on("exit", (code) => process.exit(code ?? 1));
} else if (mode === "build") {
  const child = run(
    process.execPath,
    ["node_modules/next/dist/bin/next", "build", "--webpack"],
    webEnv,
  );
  child.on("exit", (code) => process.exit(code ?? 1));
} else {
  const authSecret = webEnv.CLOUD_AUTH_FLOW_SECRET || "";
  if (authSecret.length < 32 || authSecret.startsWith("replace"))
    throw new Error(
      "Generate a unique CLOUD_AUTH_FLOW_SECRET of at least 32 random characters",
    );
  const port = Number(process.env.PORT || 3002),
    apiPort = Number(env.API_PORT);
  if (
    ![port, apiPort].every(
      (p) => Number.isInteger(p) && p >= 1024 && p <= 65535,
    ) ||
    port === apiPort
  )
    throw new Error("PORT/API_PORT must be different valid unprivileged ports");
  if (mode === "start" && !existsSync(path.join(root, ".next-cloud/BUILD_ID")))
    throw new Error("Run npm run cloud:build first");
  for (const candidate of [port, apiPort]) {
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", () =>
        reject(
          new Error(
            `Port ${candidate} is busy or unavailable; choose different PORT/API_PORT values`,
          ),
        ),
      );
      probe.listen(candidate, "127.0.0.1", () => probe.close(resolve));
    });
  }
  const bootToken = randomBytes(32).toString("hex");
  apiEnv.CLOUD_BOOT_TOKEN = bootToken;
  const bootId = createHash("sha256").update(bootToken).digest("hex");
  const api = run(
    python,
    [
      "-m",
      "uvicorn",
      "services.cloud.app:create_app",
      "--factory",
      "--host",
      "127.0.0.1",
      "--port",
      String(apiPort),
      "--no-access-log",
      "--limit-concurrency",
      "64",
      "--timeout-keep-alive",
      "5",
    ],
    apiEnv,
  );
  let web,
    stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    api.kill("SIGTERM");
    web?.kill("SIGTERM");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  api.on("error", () => {
    console.error(
      "Cloud API could not start. Check the cloud Python environment.",
    );
    stop();
    process.exitCode = 1;
  });
  api.on("exit", (code) => {
    if (!stopping) {
      process.exitCode = code || 1;
      stop();
    }
  });
  // Readiness probes carry no identity or financial content.
  let ready = false;
  for (let attempt = 0; attempt < 50 && !stopping; attempt++) {
    try {
      const r = await fetch(`http://127.0.0.1:${apiPort}/v1/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (r.ok && (await r.json()).data?.boot_id === bootId) {
        ready = true;
        break;
      }
    } catch {
      /* startup in progress */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) {
    console.error("Cloud API is not ready; no frontend was started.");
    stop();
    process.exitCode = 1;
  } else {
    console.log(
      `ZhiZhang cloud preview: http://localhost:${port}\nBilling, bank sync, trading and external AI remain disabled.`,
    );
    web = run(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        mode,
        "--hostname",
        process.env.CLOUD_BIND_HOST || "127.0.0.1",
        "--port",
        String(port),
      ],
      webEnv,
    );
    web.on("exit", (code) => {
      if (!stopping) {
        process.exitCode = code || 0;
        stop();
      }
    });
  }
}
