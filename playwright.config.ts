import { defineConfig } from "@playwright/test";

// Use a different port than the dev server so tests can run alongside it.
// TEST_PORT overrides it so several checkouts can run tests at the same time.
const TEST_PORT = Number(process.env.TEST_PORT ?? 3466);

export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  // Browser tests only; tests/**/*.test.ts are unit tests run by `tsx --test`
  testMatch: "**/*.spec.ts",
  workers: 1,
  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
    viewport: { width: 1280, height: 720 },
    // Use Chrome's "new headless" (a real browser instance with GPU) rather
    // than the legacy headless_shell, which falls back to software WebGL.
    // Playwright's `headless: true` still routes to the old shell, so we
    // launch non-headless and pass --headless=new ourselves.
    headless: false,
    launchOptions: {
      args: [
        "--headless=new",
        "--ignore-gpu-blocklist",
        ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
        "--mute-audio",
      ],
    },
  },
  webServer: {
    command: `npm run dev-server -- --port ${TEST_PORT}`,
    url: `http://localhost:${TEST_PORT}`,
    // TEST_REUSE_SERVER=1 runs against a dev server you started yourself on
    // TEST_PORT
    reuseExistingServer: process.env.TEST_REUSE_SERVER === "1",
    timeout: 60000,
  },
});
