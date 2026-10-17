import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  outputDir: "test-results/cloud",
  testDir: "./tests/cloud/browser",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    baseURL: "http://127.0.0.1:3107",
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
    command:
      "node_modules/node/bin/node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3107",
    url: "http://127.0.0.1:3107/",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      WALLET_UI_MODE: "cloud",
      CLOUD_PUBLIC_ORIGIN: "http://127.0.0.1:3107",
      SUPABASE_URL: "https://synthetic.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_test_only",
      BILLING_ENABLED: "false",
      CLOUD_PUBLIC_SIGNUP: "false",
    },
  },
});
