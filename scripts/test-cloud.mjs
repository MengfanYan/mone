import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, readFile, readdir, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (process.env.CLOUD_TEST_SMOKE === "true" && existsSync(".env.cloud.local"))
  throw new Error(
    "The synthetic launcher smoke must not load a configured .env.cloud.local; run it in a clean test checkout",
  );

const root = await mkdtemp(path.join(tmpdir(), "finagent-cloud-synthetic-"));
const port = Number(process.env.CLOUD_TEST_PORT || 55439);
const pg = new EmbeddedPostgres({
  databaseDir: path.join(root, "pg"),
  user: "postgres",
  password: "synthetic-migration-only-password",
  port,
  persistent: false,
  authMethod: "scram-sha-256",
  postgresFlags: [
    "-h",
    "127.0.0.1",
    "-k",
    root,
    "-c",
    "ssl=on",
    "-c",
    `ssl_cert_file=${path.join(root, "test.crt")}`,
    "-c",
    `ssl_key_file=${path.join(root, "test.key")}`,
  ],
  onLog: () => {},
  onError: (message) => process.stderr.write(`${message}\n`),
});
try {
  const certificate = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      path.join(root, "test.key"),
      "-out",
      path.join(root, "test.crt"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=IP:127.0.0.1,DNS:localhost",
    ],
    { stdio: "pipe" },
  );
  if (certificate.status !== 0)
    throw new Error("Could not create an isolated test TLS certificate");
  await chmod(path.join(root, "test.key"), 0o600);
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("wallet_test");
  const admin = pg.getPgClient("wallet_test", "127.0.0.1");
  await admin.connect();
  for (const file of (await readdir("migrations/cloud"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await admin.query(
      await readFile(path.join("migrations/cloud", file), "utf8"),
    );
  await admin.query(
    "CREATE ROLE wallet_test LOGIN PASSWORD 'synthetic-runtime-only-password' NOSUPERUSER NOBYPASSRLS NOINHERIT; GRANT wallet_api TO wallet_test",
  );
  await admin.end();
  const dsn = `host=127.0.0.1 port=${port} dbname=wallet_test user=wallet_test password=synthetic-runtime-only-password sslmode=verify-full sslrootcert=${path.join(root, "test.crt")}`;
  const adminDsn = `host=127.0.0.1 port=${port} dbname=wallet_test user=postgres password=synthetic-migration-only-password`;
  const child = spawn(
    process.env.CLOUD_PYTHON || ".venv-cloud/bin/python",
    ["-m", "unittest", "discover", "-s", "tests/cloud", "-v"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        CLOUD_TEST_DSN: dsn,
        CLOUD_TEST_ADMIN_DSN: adminDsn,
      },
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.on("exit", resolve);
    child.on("error", reject);
  });
  if (process.exitCode === 0 && process.env.CLOUD_TEST_SMOKE === "true") {
    const server = spawn(
      path.resolve("node_modules/node/bin/node"),
      ["scripts/cloud.mjs", "start"],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          CLOUD_DATABASE_URL: dsn,
          SUPABASE_URL: "https://synthetic.supabase.co",
          SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_only",
          CLOUD_PUBLIC_ORIGIN: "http://127.0.0.1:3108",
          CLOUD_AUTH_FLOW_SECRET:
            "synthetic-bff-only-recovery-key-32-characters",
          CLOUD_PUBLIC_SIGNUP: "false",
          BILLING_ENABLED: "false",
          CLOUD_JOURNAL_SUPABASE_URL: "",
          PORT: "3108",
          API_PORT: "8768",
        },
      },
    );
    const closed = new Promise((resolve) => server.once("exit", resolve));
    let ready = false;
    try {
      for (let i = 0; i < 100 && server.exitCode === null; i++) {
        try {
          const health = await fetch("http://127.0.0.1:3108/api/health", {
            signal: AbortSignal.timeout(500),
          });
          if (health.ok && (await health.json()).data.mode === "cloud") {
            ready = true;
            break;
          }
        } catch {
          /* private synthetic server is starting */
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (!ready)
        throw new Error("The real cloud launcher did not become healthy");
      const page = await fetch("http://127.0.0.1:3108/");
      const blocked = await fetch(
        "http://127.0.0.1:3108/api/state?period=2026-09",
      );
      if (
        !page.ok ||
        !(await page.text()).includes("Mone") ||
        blocked.status !== 401
      )
        throw new Error("Cloud startup or unauthenticated boundary failed");
      console.log(
        "Cloud launcher smoke: verified-TLS PostgreSQL + real ASGI/BFF startup + unauthenticated denial passed; no provider requests made.",
      );
    } finally {
      server.kill("SIGTERM");
      await closed;
    }
  }
} finally {
  await pg.stop().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
