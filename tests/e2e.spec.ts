import { expect, Page, test } from "@playwright/test";

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

/** Collects page errors and console errors, which should fail any test */
function collectIssues(page: Page): string[] {
  const issues: string[] = [];
  page.on("pageerror", (err) => issues.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") issues.push(msg.text());
  });
  return issues;
}

test("game initializes and runs without errors", async ({ page }) => {
  const issues = collectIssues(page);

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

  // --- Assertion: The dev server's headers make the page cross-origin
  // isolated, which the profiler needs for fine-grained timers ---
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);

  // --- Assertion: An entity gets contact events against a body that no
  // entity owns (a bare static plane) ---
  const contacts = await page.evaluate(async () => {
    // The dev server serves source modules by path, and these are the same
    // module instances the game is using
    const load = <T>(path: string): Promise<T> => import(path);
    const { BaseEntity } = await load<
      typeof import("../src/core/entity/BaseEntity")
    >("/core/entity/BaseEntity.ts");
    const { createRigid2D } = await load<
      typeof import("../src/core/physics/body/bodyFactories")
    >("/core/physics/body/bodyFactories.ts");
    const { Circle } = await load<
      typeof import("../src/core/physics/shapes/Circle")
    >("/core/physics/shapes/Circle.ts");
    const { Plane } = await load<
      typeof import("../src/core/physics/shapes/Plane")
    >("/core/physics/shapes/Plane.ts");
    const game = window.DEBUG.game!;

    const floor = createRigid2D({ motion: "static", position: [0, -1000] });
    floor.addShape(new Plane({}));
    game.world.bodies.add(floor);

    const counts = { beginContact: 0, impact: 0 };
    class Ball extends BaseEntity {
      body = createRigid2D({
        motion: "dynamic",
        mass: 1,
        position: [0, -999],
        velocity: [0, -10],
      });
      constructor() {
        super();
        this.body.addShape(new Circle({ radius: 0.5 }));
      }
      onBeginContact() {
        counts.beginContact++;
      }
      onImpact() {
        counts.impact++;
      }
    }
    const ball = game.addEntity(new Ball());
    await new Promise((resolve) => setTimeout(resolve, 500));
    ball.destroy();
    game.world.bodies.remove(floor);
    return counts;
  });
  expect(contacts.beginContact).toBeGreaterThan(0);
  expect(contacts.impact).toBeGreaterThan(0);

  // Let the game run for a couple of seconds to catch any post-start errors
  await page.waitForTimeout(2000);

  // --- Assertion: Game loop kept running ---
  const laterTicks: number = await page.evaluate(
    () => window.DEBUG.game!.ticknumber,
  );
  expect(laterTicks).toBeGreaterThan(initialTicks);

  // --- Assertion: Frame pacing found the display's refresh rate, and runs
  // ticks at it (or a multiple, below 60 fps) ---
  const pacing = await page.evaluate(() => {
    const game = window.DEBUG.game!;
    return {
      refreshRate: game.refreshRate,
      ticksPerSecond: game.ticksPerSecond,
      targetFrameRate: game.targetFrameRate,
    };
  });
  console.log("Frame pacing:", pacing);
  expect(pacing.refreshRate).toBeGreaterThanOrEqual(28);
  expect(pacing.ticksPerSecond).toBeGreaterThanOrEqual(60);

  // --- Assertion: With manual frames, only stepFrames moves the game on,
  // a frame and its ticks at a time ---
  const stepped = await page.evaluate(async () => {
    const game = window.DEBUG.game!;
    game.manualFrames = true;
    const before = { frames: game.framenumber, ticks: game.ticknumber };
    await new Promise((resolve) => setTimeout(resolve, 200));
    const idle = game.framenumber - before.frames;
    game.stepFrames(10);
    const result = {
      idle,
      frames: game.framenumber - before.frames,
      ticks: game.ticknumber - before.ticks,
      ticksPerFrame: game.ticksPerFrame,
    };
    game.manualFrames = false;
    return result;
  });
  expect(stepped.idle).toBe(0);
  expect(stepped.frames).toBe(10);
  expect(stepped.ticks).toBe(10 * stepped.ticksPerFrame);

  // --- Assertion: The mouse wheel reaches entities as `wheel` events ---
  await page.evaluate(async () => {
    const load = <T>(path: string): Promise<T> => import(path);
    const { BaseEntity } = await load<
      typeof import("../src/core/entity/BaseEntity")
    >("/core/entity/BaseEntity.ts");
    const { on } = await load<typeof import("../src/core/entity/handler")>(
      "/core/entity/handler.ts",
    );
    class WheelWatcher extends BaseEntity {
      id = "wheelWatcher";
      deltas: number[] = [];
      onWheel({ deltaY }: { deltaY: number }) {
        this.deltas.push(deltaY);
      }
    }
    // The decorator, applied by hand (this code isn't compiled with them)
    on("wheel")(
      WheelWatcher.prototype,
      "onWheel",
      Object.getOwnPropertyDescriptor(WheelWatcher.prototype, "onWheel")!,
    );
    window.DEBUG.game!.addEntity(new WheelWatcher());
  });
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(
    () =>
      (window.DEBUG.game!.entities.getById("wheelWatcher") as any).deltas
        .length > 0,
  );

  // --- Assertion: The first filter on the stage can be added and removed
  // (Pixi leaves `filters` unset until there is one) ---
  const filterCount = await page.evaluate(() => {
    const renderer = window.DEBUG.game!.renderer;
    // Added and removed before anything draws, so it needn't be a real one
    const filter = {} as Parameters<typeof renderer.addStageFilter>[0];
    renderer.addStageFilter(filter);
    renderer.removeStageFilter(filter);
    const filters = renderer.stage.filters;
    return Array.isArray(filters) ? filters.length : filters ? 1 : 0;
  });
  expect(filterCount).toBe(0);

  // --- Assertion: No errors while running ---
  expect(issues).toHaveLength(0);
});

test("entity studio loads without errors", async ({ page }) => {
  const issues = collectIssues(page);

  await page.goto("/core/entity-studio/entity-studio.html");

  // --- Assertion: The app rendered something, with Pico's styles applied ---
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, {
    timeout: 30000,
  });
  const fontFamily = await page.evaluate(
    () => getComputedStyle(document.body).fontFamily,
  );
  expect(fontFamily).not.toMatch(/^"?Times/);

  // --- Assertion: No errors while loading ---
  expect(issues).toHaveLength(0);
});
