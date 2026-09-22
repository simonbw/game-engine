import { test, expect } from "@playwright/test";

/**
 * E2E Testing Philosophy
 *
 * E2E tests are slow due to browser startup and game initialization overhead.
 * Rather than writing many small isolated tests (unit test style), we prefer
 * fewer tests that each make multiple assertions. This keeps the test suite
 * fast while still providing good coverage.
 *
 * See tests/CLAUDE.md for more details.
 */

test("game initializes and runs without errors", async ({ page }) => {
  // Collect any errors during the test
  const issues: string[] = [];
  page.on("pageerror", (err) => issues.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") issues.push(msg.text());
  });

  await page.goto("/");

  // Wait for game to initialize (DEBUG.game exists)
  await page.waitForFunction(() => window.DEBUG?.game, { timeout: 30000 });

  // --- Assertion: Game loop starts ticking ---
  await page.waitForFunction(() => window.DEBUG.game!.ticknumber > 0, {
    timeout: 30000,
  });
  const initialTicks: number = await page.evaluate(
    () => window.DEBUG.game!.ticknumber,
  );
  expect(initialTicks).toBeGreaterThan(0);

  // --- Assertion: No errors during initialization ---
  expect(issues).toHaveLength(0);

  // Let the game run for a couple of seconds to catch any post-start errors
  await page.waitForTimeout(2000);

  // --- Assertion: Game loop kept running ---
  const laterTicks: number = await page.evaluate(
    () => window.DEBUG.game!.ticknumber,
  );
  expect(laterTicks).toBeGreaterThan(initialTicks);

  // --- Assertion: No errors while running ---
  expect(issues).toHaveLength(0);
});
