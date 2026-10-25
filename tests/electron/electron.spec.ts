import { _electron as electron, expect, Page, test } from "@playwright/test";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * The desktop app, built by `npm run package` (which `npm run test:electron`
 * runs first). Each launch gets its own user data folder, so the tests never
 * touch the real save.
 */

const ROOT = path.resolve(__dirname, "../..");
const MAIN = path.join(ROOT, ".vite/build/main.cjs");
const PRODUCT_NAME: string = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
).productName;
const PACKAGED = path.join(
  ROOT,
  `out/${PRODUCT_NAME}-darwin-${process.arch}/${PRODUCT_NAME}.app/Contents/MacOS/${PRODUCT_NAME}`,
);

function newUserData(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "game-electron-test-"));
}

/** Collects page errors, console errors, and assets that failed to load */
function collectIssues(page: Page): string[] {
  const issues: string[] = [];
  page.on("pageerror", (err) => issues.push(err.message));
  page.on("console", (message) => {
    if (message.type() === "error" || /failed to load/i.test(message.text())) {
      issues.push(`${message.type()}: ${message.text()}`);
    }
  });
  return issues;
}

/** Launches the built app (not the packaged one) hidden, and waits for the game to run */
async function launch(userData: string) {
  const app = await electron.launch({
    args: [MAIN, "example=1"],
    cwd: ROOT,
    env: {
      ...process.env,
      GAME_HEADLESS: "1",
      GAME_USER_DATA: userData,
    },
  });
  const page = await app.firstWindow();
  const issues = collectIssues(page);
  await page.waitForFunction(
    () => (window.DEBUG?.game?.ticknumber ?? 0) > 0,
    null,
    {
      timeout: 60000,
    },
  );
  return { app, page, issues };
}

test("the desktop app boots, keeps its save, and quits", async () => {
  expect(fs.existsSync(MAIN), `${MAIN} is missing: run npm run package`).toBe(
    true,
  );
  const userData = newUserData();

  // First launch
  let { app, page, issues } = await launch(userData);
  // Served over app://, with `key=value` arguments as the query string
  expect(page.url()).toBe("app://game/index.html?example=1");
  const state = await page.evaluate(() => ({
    platform: window.desktop?.platform,
    smoke: window.desktop?.smoke,
    // Headless windows are never fullscreen
    fullscreen: window.desktop?.isFullscreen(),
    displayFrequency: window.desktop?.displayFrequency(),
    // The app:// protocol sends the same isolation headers as the dev server
    crossOriginIsolated: window.crossOriginIsolated,
  }));
  expect(state).toEqual({
    platform: process.platform,
    smoke: false,
    fullscreen: false,
    displayFrequency: expect.any(Number),
    crossOriginIsolated: true,
  });
  // The display's own refresh rate, which the game runs at no faster than
  expect(state.displayFrequency).toBeGreaterThan(0);
  await page.evaluate(() =>
    window.localStorage.setItem("electronTest", "kept"),
  );
  await app.close();
  expect(issues).toEqual([]);

  // Second launch: localStorage is still there
  ({ app, page, issues } = await launch(userData));
  expect(
    await page.evaluate(() => window.localStorage.getItem("electronTest")),
  ).toBe("kept");

  // The bridge's quit closes the app
  const closed = app.waitForEvent("close");
  await page.evaluate(() => window.desktop!.quit());
  await closed;
  expect(issues).toEqual([]);
  fs.rmSync(userData, { recursive: true, force: true });
});

test("the packaged app passes its smoke test", async () => {
  test.skip(
    process.platform !== "darwin",
    "The app is only packaged for macOS",
  );
  expect(fs.existsSync(PACKAGED), `${PACKAGED} is missing`).toBe(true);
  const userData = newUserData();
  // In smoke mode the app quits by itself once the game calls
  // smokeTestReady() (exit code 0) or after a timeout (1). Playwright can't
  // drive the packaged app, whose fuses turn off the debugging it needs.
  const result = spawnSync(PACKAGED, [], {
    env: { ...process.env, GAME_SMOKE: "1", GAME_USER_DATA: userData },
    encoding: "utf8",
    timeout: 90000,
  });
  fs.rmSync(userData, { recursive: true, force: true });
  const errors = result.stdout
    .split("\n")
    .filter((line) => /^\[renderer:error\]|failed to load/i.test(line));
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("[smoke] ready");
  expect(errors, errors.join("\n")).toEqual([]);
});
