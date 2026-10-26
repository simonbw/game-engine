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

  // --- Assertion: A suspended audio context is resumed by a click, and by a
  // key press, and its clock moves again. Suspended by hand, since headless
  // Chrome never suspends it for autoplay ---
  for (const gesture of ["click", "key"] as const) {
    await page.evaluate(() => window.DEBUG.game!.audio.suspend());
    const suspendedAt = await page.evaluate(() => {
      const audio = window.DEBUG.game!.audio;
      return { state: audio.state, time: audio.currentTime };
    });
    expect(suspendedAt.state).toBe("suspended");
    if (gesture === "click") {
      await page.mouse.click(640, 360);
    } else {
      await page.keyboard.press("Shift");
    }
    await page.waitForFunction(
      (time) => {
        const audio = window.DEBUG.game!.audio;
        return audio.state === "running" && audio.currentTime > time;
      },
      suspendedAt.time,
      { timeout: 5000 },
    );
  }

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

test("lighting draws lights, shadows and ambient light", async ({ page }) => {
  const issues = collectIssues(page);

  await page.goto("/");
  await page.waitForFunction(() => (window.DEBUG?.game?.ticknumber ?? 0) > 0, {
    timeout: 30000,
  });

  const result = await page.evaluate(async () => {
    const load = <T>(path: string): Promise<T> => import(path);
    const { BaseEntity } = await load<
      typeof import("../src/core/entity/BaseEntity")
    >("/core/entity/BaseEntity.ts");
    const { createRigid2D } = await load<
      typeof import("../src/core/physics/body/bodyFactories")
    >("/core/physics/body/bodyFactories.ts");
    const { Box } = await load<typeof import("../src/core/physics/shapes/Box")>(
      "/core/physics/shapes/Box.ts",
    );
    const { CAST_SHADOW_TAG } = await load<
      typeof import("../src/core/lighting/casters")
    >("/core/lighting/casters.ts");
    const { LightingManager } = await load<
      typeof import("../src/core/lighting/LightingManager")
    >("/core/lighting/LightingManager.ts");
    const { PointLight } = await load<
      typeof import("../src/core/lighting/PointLight")
    >("/core/lighting/PointLight.ts");
    const { AmbientLight } = await load<
      typeof import("../src/core/lighting/AmbientLight")
    >("/core/lighting/AmbientLight.ts");
    const { V } =
      await load<typeof import("../src/core/Vector")>("/core/Vector.ts");
    const game = window.DEBUG.game!;
    game.manualFrames = true;
    const step = () => {
      game.camera.center(V(0, 0));
      game.camera.z = 25;
      game.stepFrames(1);
    };

    // A wall a few meters to the right of the light
    class Wall extends BaseEntity {
      tags = [CAST_SHADOW_TAG];
      body = createRigid2D({ motion: "static", position: [3, 0] });
      constructor() {
        super();
        this.body.addShape(new Box({ width: 0.5, height: 4 }));
      }
    }

    // Lights and walls before there's a manager: nothing draws them, and
    // nothing breaks
    const wall = game.addEntity(new Wall());
    const ambient = game.addEntity(new AmbientLight(0x202020));
    const light = game.addEntity(
      new PointLight({ radius: 8, position: [0, 0] }),
    );
    step();

    // Then the manager, which finds them
    const manager = game.addEntity(new LightingManager({ layer: "lighting" }));
    let draws = 0;
    const m = manager as any;
    const drawLights = m.drawLights.bind(manager);
    m.drawLights = (...args: unknown[]) => {
      draws++;
      return drawLights(...args);
    };
    step();

    /** The red channel of the lighting at a point in the world, 0 to 255 */
    const brightness = (x: number, y: number) => {
      const renderer = game.renderer.app.renderer;
      const texture = manager.texture;
      const { pixels, width } = renderer.extract.pixels({ target: texture });
      const scale = texture.source.pixelWidth / texture.width;
      const [sx, sy] = game.camera.toScreen(V(x, y));
      const i = (Math.round(sy * scale) * width + Math.round(sx * scale)) * 4;
      return pixels[i];
    };
    const lit = brightness(1.5, 0);
    const shadowed = brightness(4.5, 0);
    const sameDistance = brightness(0, 4.5);
    const outOfReach = brightness(20, 0);
    const drawsAtFirst = draws;

    // A static light that hasn't changed isn't drawn again, and nor is one
    // that only got brighter; one that moved is
    draws = 0;
    step();
    step();
    light.setIntensity(0.5);
    step();
    const drawsUnchanged = draws;
    light.setPosition([0, 1]);
    step();
    const drawsMoved = draws - drawsUnchanged;

    for (const e of [manager, light, ambient, wall]) {
      e.destroy();
    }
    game.manualFrames = false;
    return {
      lit,
      shadowed,
      sameDistance,
      outOfReach,
      drawsAtFirst,
      drawsUnchanged,
      drawsMoved,
    };
  });
  console.log("Lighting:", result);

  // --- Assertion: Lit near the light, ambient (0x20) out of its reach ---
  expect(result.lit).toBeGreaterThan(100);
  expect(Math.abs(result.outOfReach - 0x20)).toBeLessThanOrEqual(2);
  // --- Assertion: The wall's shadow is as dark as the ambient light, and
  // as far away the other way isn't shadowed ---
  expect(Math.abs(result.shadowed - 0x20)).toBeLessThanOrEqual(2);
  expect(result.sameDistance).toBeGreaterThan(result.shadowed + 10);
  // --- Assertion: Static lights are drawn once, and again only when they
  // change in a way that shows in their square ---
  expect(result.drawsAtFirst).toBe(1);
  expect(result.drawsUnchanged).toBe(0);
  expect(result.drawsMoved).toBe(1);

  // --- Assertion: No errors ---
  expect(issues).toHaveLength(0);
});
