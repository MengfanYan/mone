import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import path from "node:path";

const testDataDir = mkdtempSync(path.join(tmpdir(), "wallet-browser-test-"));

export default defineConfig({
  outputDir: "test-results/live",
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [["list"]],
  use: {
    actionTimeout: 10000,
    baseURL: "http://127.0.0.1:3097",
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "node scripts/run.mjs start",
    url: "http://127.0.0.1:3097/api/health",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PORT: "3097",
      API_PORT: "8797",
      LOCAL_ACCESS_CODE: "synthetic-browser-access-code",
      WALLET_DB: path.join(testDataDir, "wallet.sqlite3"),
      NEXT_TELEMETRY_DISABLED: "1",
      OPENAI_API_KEY: "",
    },
  },
});
