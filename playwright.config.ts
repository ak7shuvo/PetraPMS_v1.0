import { defineConfig } from "@playwright/test";
// Chromium path: PLAYWRIGHT_CHROMIUM (CI downloads one via `playwright install chromium`; this sandbox has one preinstalled).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_URL || "http://127.0.0.1:3199",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined, args: ["--no-sandbox"] },
    trace: "retain-on-failure",
  },
});
