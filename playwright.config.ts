import { defineConfig } from "@playwright/test";

// Use a different port for tests to avoid conflicts with dev server
// (dev server uses 1234 with Parcel on 1235, so we use 3000+)
const TEST_PORT = 3466;

export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  use: {
    // Use Chrome's "new headless" (a real browser instance with GPU) rather
    // than the legacy headless_shell, which falls back to software WebGL.
    // Playwright's `headless: true` still routes to the old shell, so we
    // launch non-headless and pass --headless=new ourselves.
    headless: false,
    baseURL: `http://localhost:${TEST_PORT}`,
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
    command: `PORT=${TEST_PORT} NODE_ENV=test npm run dev-server`,
    url: `http://localhost:${TEST_PORT}`,
    // Always spin up a fresh server for tests
    reuseExistingServer: false,
    timeout: 60000,
  },
});
