import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Prefer a preinstalled Chromium (sandbox/dev container); fall back to
// Playwright's own download (CI runners after `playwright install`).
const preinstalled = process.env.FF_CHROMIUM || "/opt/pw-browsers/chromium";
const executablePath = existsSync(preinstalled) ? preinstalled : undefined;

export default defineConfig({
  testDir: "games/funkelflotte/tests/e2e",
  timeout: 60000,
  retries: 1,
  webServer: [
    {
      command: "node scripts/serve.mjs 8123 .",
      port: 8123,
      reuseExistingServer: true,
    },
    {
      command: "node scripts/peer-server.mjs 9200",
      port: 9200,
      reuseExistingServer: true,
    },
  ],
  use: {
    baseURL: "http://localhost:8123",
    viewport: { width: 390, height: 844 }, // iPhone-ish, mobile first
    hasTouch: true,
    launchOptions: { executablePath },
  },
});
