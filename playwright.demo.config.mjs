import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  outputDir: "test-results/demo",
  testDir: "./tests/demo/browser",
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [["list"]],
  use: {
    actionTimeout: 10000,
    baseURL: "http://127.0.0.1:3101",
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
    command: "node scripts/demo.mjs start",
    url: "http://127.0.0.1:3101/demo",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      DEMO_PORT: "3101",
      PYTHON: "/nonexistent-python-demo-must-not-launch",
      API_PORT: "1",
      WALLET_DB: "/nonexistent-demo-must-not-open.sqlite3",
    },
  },
});
