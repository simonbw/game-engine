# Core

These files make up the game "engine". They are a collection of useful patterns that I have developed over many years and many games. I tend to just copy/paste this folder from project to project as I go, rather than actually publishing this as a library because I tend to make lots of upgrades to it,
but sometimes I also make some game-specific changes to it.

## Game

The `Game` class is the top level data structure that is in charge of making everything happen.
There will be exactly one instance of it.

Some things that `Game` does:

- Initializes the physics, rendering, and input handling systems
- Keeps track of entities
- Runs the game loop: one frame (a `tick` and a `render`) per display refresh, with `dt` the ideal frame time (1 / refresh rate) rather than however long the frame took (see `FramePacing.ts`). The refresh rate is measured from animation frame timestamps, `frameRateLimit` caps it, frames below 60 fps run more than one tick, and a dropped frame is caught up (at most 3 frames, then the game slows down). `manualFrames` and `stepFrames(n)` run frames by hand, for recording video or stepping from the console.
- Runs the event system, dispatching events and calling the appropriate handlers on entities

## Entities

Just about anything you want in the game will be implemented as an `Entity`.
This `Entity` is roughly equivalent to Unity's `GameObject`, or Unreal's `Actor`.

Every entity should extend the `BaseEntity` class and implement the `Entity` interface.

```TypeScript
class Ball extends BaseEntity implements Entity  {
  constructor() {
    super()
    // initialize stuff...
  }
}
```

### Body

If you want an entity to be included in the physics simulation, you can give it a `body`.

```TypeScript
this.body = createRigid2D({ motion: "dynamic", mass: 1, position: V(0, 0) });
this.body.addShape(new Circle({ radius: 1 /** in meters, generally */ }));
```

If you want to give an entity multiple bodies, you can use the `bodies` field instead.

### Children

`this.addChild(entity)` makes an entity part of this one: it's added to the game with its parent (right away if the parent is already in the game) and destroyed along with it.
Prefer it to adding things separately and remembering to clean them up.

`this.game` throws if the entity isn't in a game. For the rare code that can run when it isn't (setup before `game.addEntity`, or something that can be hit again after it's destroyed in the same physics step), check `this.isAdded` or `this.isDestroyed` first.

`await this.wait(seconds)` waits in game time. The timer is a child entity, so code after the `await` never runs once the entity is destroyed, and needs no guard.

### Events

Entities respond to game events by implementing handler methods decorated with `@on`.
The three most important events are probably `add`, `tick`, and `render`.

```TypeScript
import { on } from "./entity/handler";
```

A handler is a method named `on` + the event's name, marked with `@on("eventName")`. The decorator is what registers it (an undecorated `onTick` is never called), checks that the name matches, and type checks the payload.
By convention `on*` names are only used for event handlers, so methods that other code calls directly get other names (`handleDeath`, `hitByBullet`).

#### `@on("add")`

Called when added to the game, before dealing with the body, handlers, or anything else.
Useful for initializing stuff that you need access to the `game` for.

#### `@on("tick")`

If you want an entity to do something every physics step, put that logic in the `onTick()` method.
The tick rate follows the display (60, 120, 144 per second...), so anything that changes per tick has to scale with `dt`: a velocity times `dt`, or a smoothing factor as `Math.pow(kept, dt * 60)`, never a fixed amount per tick.

```TypeScript
  @on("tick")
  onTick({ dt }: GameEventMap["tick"]) {
    if (this.game.io.isKeyDown("Space")) {
      // Accelerate upwards
      this.body.applyForce(V(0, -10));
    }
  }
```

#### `@on("render")`

Called on every frame right before the screen is redrawn.
Useful for logic like syncing a sprite's position to its body.
Keep it to looks: anything that affects the game belongs in `onTick`, and nothing else may depend on a render handler having run.
That way anything there can be many of can check `game.camera.isVisible(x, y, radius)` first and, when it's out of view, hide its sprite (`renderable = false`) and return.
State other code reads should come from bodies or be worked out when it's asked for, not left behind by `onRender`.

```TypeScript
  @on("render")
  onRender({ dt }: GameEventMap["render"]) {
    this.sprite.position.set(...this.body.position);
    this.sprite.rotation = this.body.angle;
  }
```

### Sprite

If you want an entity to have a visual representation in the world, give it a `sprite` (or `sprites`).
It gets added to the stage when the entity is added and destroyed along with it.

```TypeScript
this.sprite = loadGameSprite("ball", "main", { anchor: [0.5, 0.5] });
```

_Note: `imageName` is a helper function that limits the string type to only names of images found in our `resources/` folder. It's really handy for autocomplete_

### Tick layers

Ticks run in phases defined in `src/config/tickLayers.ts` (`input`, `main`, `effects`, `camera`).
Set `tickLayer` on an entity to pick a phase; everything on an earlier layer ticks before anything on a later one.
An entity without a `tickLayer` is in its parent's, so children tick with their parents.
The camera ticks last so it always follows final positions.
`render` handlers run in the same layers, so the profiler reports ticking and rendering per layer.
That makes layers how a frame's time is sorted into categories: put anything new that there can be many of in the layer it belongs to, adding one if needed.

### Less important events

`@on("afterAdded")` — Called when added to the game, _after_ the body, sprite, handlers, and everything else is dealt with.
Most of the time you probably want to use `onAdd`, but there are some times when this comes in handy.

`@on("beforeTick")` — Called at the start of every tick, before any `onTick` handlers.

`@on("pause")` — Called when the game is paused

`@on("unpause")` — Called when the game is unpaused

`@on("destroy")` — Called after being destroyed.

`@on("resize")` — Called when the renderer is resized or recreated for some reason.
You shouldn't need to deal with this often.

### Custom Events

You can define and handle custom events using the `@on` decorator.

First, define your event type in `src/config/CustomEvent.ts`:

```TypeScript
export type CustomEvents = {
  levelStarted: { level: number };
};
```

Then dispatch events using `game.dispatch()`:

```TypeScript
class LevelManager extends BaseEntity implements Entity {
  @on("tick")
  onTick() {
    //...level management stuff
    this.game.dispatch('levelStarted', { level: 1 });
  }
}
```

And handle them in other entities with the `@on` decorator:

```TypeScript
class Ball extends BaseEntity implements Entity {
  @on("levelStarted")
  onLevelStarted({ level }: GameEventMap["levelStarted"]) {
    this.body.velocity = [0, 0];
    console.log(`Starting level ${level}`);
  }
}
```

The `@on` decorator provides compile-time type checking for handler parameters.

## Finding Entities

Entities have a `tags` property you can add to them to make them easy to find.
You can use `game.entities.getTagged("yourTagName")` to get a list of all the entities that have `yourTagName` in their `tags` list.
You can also use `game.entities.getTaggedAll` and `game.entities.getTaggedAny` to find entities that match all of a given list of tags, or any of them, respectively.

If you know there is only ever going to be 1 instance of an entity, you can give it an `id`.
This lets you use `game.entities.getById('entityId')` to easily retrieve your entity.
If you try to add an entity to the game with the same `id` as one that is already in the game, it will throw an error, so be cautious with this.

For a class there's only ever one of, `game.entities.getSingleton(LevelManager)` finds it by class (`tryGetSingleton` returns `undefined` instead of throwing when there isn't one).

For a kind of entity you look up often, register a type guard once with `game.entities.addFilter(isEnemy)`, and `game.entities.getByFilter(isEnemy)` then returns the matches without scanning every entity.

## Graphics

Rendering is done with [Pixi.js](https://pixijs.com/). Every entity's `sprite`/`sprites` is a Pixi `Container`
that gets added to a **layer** when the entity is added to the game.

### Layers

Layers are defined in `src/config/layers.ts` and render in the order they are declared:

```TypeScript
export const LAYERS = {
  main: new LayerInfo(), // Default layer
  lighting: new LayerInfo({ parallax: V(0, 0) }), // Lighting, if there is any (see below)
  hud: new LayerInfo({ parallax: V(0, 0) }), // Fixed to the screen
  debugHud: new LayerInfo({ parallax: V(0, 0) }),
};
```

Pick a sprite's layer with `sprite.layerName = "hud"` or by passing it to `loadGameSprite`.
A parallax of `V(0, 0)` means the layer stays fixed to the screen (like a HUD), while `V(1, 1)` moves 1:1 with the camera.

### Camera

The camera controls the viewport. Access it via `game.camera`:

```TypeScript
game.camera.center(V(100, 200));          // Snap to a position
game.camera.smoothCenter(target.position); // Ease toward a position
game.camera.z = 30;                        // Zoom (bigger is closer)

const worldPos = game.camera.toWorld(game.io.mousePosition);
if (game.camera.isVisible(x, y, radius)) { /* cull offscreen work */ }
```

The camera rejects non-finite or absurdly large positions/zooms with a warning instead of corrupting the view.

### Rendering gotchas (Pixi 8)

- Use a plain Pixi `Container` as the parent of other display objects, not an empty `Sprite` or a `Graphics`. Position sprites from vectors with `sprite.position.copyFrom(v)`.
- `renderer.width` and `height` are already in logical pixels. Don't divide by `resolution` again.
- A `GlProgram` is only compiled as GLSL ES 3.0 if its fragment shader starts with `#version 300 es`. Otherwise Pixi compiles it as ES 1.0 and quietly `#define`s `in`/`out`/`finalColor` into the old keywords, so ES 3.0-only features (`flat`, `gl_ClipDistance`, integer attributes) fail with confusing errors. Extension directives have to come before any code, and Pixi puts lines of its own in front, so they have to be patched in after the version line (see `lighting/ShadowCasters.ts`).
- Filters nested inside another filter render nothing if their `resolution`s differ. Give a filter on the stage `resolution: "inherit"`.
- Rendering into a texture mid-frame (`renderer.render({ container, target, clear })`): pass `clearColor: [0, 0, 0, 0]`, or the target is cleared to the opaque canvas background. Filters don't work in such a pass (they size themselves to the canvas, not the target), and the root container's own `blendMode` is ignored, so wrap it in another `Container` if it needs to erase or add.
- `RenderTexture.resize` doesn't update the texture coordinates of sprites already using the texture. A texture that changes size should be created afresh and reassigned.

## IO

The `IOManager` class (accessible via `game.io`) handles all input from keyboard, mouse, and gamepad.

### Keyboard

```TypeScript
// Check if a key is currently held down
if (this.game.io.isKeyDown("Space")) {
  this.jump();
}

// Handle key press/release events in an entity
class Player extends BaseEntity implements Entity {
  @on("keyDown")
  onKeyDown({ key }: { key: KeyCode }) {
    if (key === "KeyE") {
      this.interact();
    }
  }
}
```

Key codes use the browser's `event.code` format: `"KeyW"`, `"Space"`, `"ArrowUp"`, `"ShiftLeft"`, etc.

### Mouse

```TypeScript
// Check mouse button state
if (this.game.io.lmb) { /* left mouse button down */ }
if (this.game.io.rmb) { /* right mouse button down */ }

// Get mouse position (screen coordinates)
const mousePos = this.game.io.mousePosition;

// Handle click events in an entity
class Clicker extends BaseEntity implements Entity {
  @on("click")
  onClick() {
    console.log("Left clicked!");
  }

  @on("rightClick")
  onRightClick() {
    console.log("Right clicked!");
  }
}
```

### Gamepad

```TypeScript
// Get analog stick input (returns V2d with values -1 to 1)
const leftStick = this.game.io.getStick("left");
const rightStick = this.game.io.getStick("right");

// Get button value (0 to 1 for analog triggers)
const triggerValue = this.game.io.getButton(ControllerButton.RIGHT_TRIGGER);

// Unified movement input (combines WASD/arrows with left stick)
const movement = this.game.io.getMovementVector();
```

### Input Device Detection

```TypeScript
// Check if player is using gamepad (vs keyboard/mouse)
if (this.game.io.usingGamepad) {
  this.showGamepadPrompts();
}

// React to input device changes
class HUD extends BaseEntity implements Entity {
  @on("inputDeviceChange")
  onInputDeviceChange({ usingGamepad }: { usingGamepad: boolean }) {
    this.updateButtonPrompts(usingGamepad);
  }
}
```

## Physics

The physics system is a custom 2D rigid body engine. See [physics/README.md](./physics/README.md) for comprehensive documentation.

Key concepts:

- **World** — The simulation container that manages bodies, constraints, and collision
- **Body** — single `Body` class tagged by `shape` (pm2d/rigid2d) × `motion` (static/kinematic/dynamic); construct via `createRigid2D` / `createPointMass2D` in `physics/body/bodyFactories.ts`
- **Shapes** — Collision geometry: `Circle`, `Box`, `Convex`, `Capsule`, `Line`, `Plane`, `Particle`, `Heightfield`
- **Constraints** — Maintain relationships between bodies: `DistanceConstraint`, `RevoluteConstraint`, `LockConstraint`
- **Springs** — Soft connections: `LinearSpring`, `RotationalSpring`, `RopeSpring`, and more

## Lighting

Optional: lights with soft shadows, in `lighting/`. Nothing is lit until the game adds a `LightingManager`, which goes in a layer that doesn't move with the camera (the template's `lighting` layer) and darkens and colors everything below it.

```TypeScript
game.addEntity(new LightingManager({ layer: "lighting" }));
game.addEntity(new AmbientLight(0x202024));
wall.tags.push(CAST_SHADOW_TAG);
this.addChild(new PointLight({ radius: 8, color: 0xffaa66, position: [x, y] }));
```

Lights are static unless made `dynamic`, which matters for how much they cost. See [lighting/CLAUDE.md](./lighting/CLAUDE.md).

## Sound

Playing sounds in the game is done by creating instances of the `SoundInstance` entity and adding them to the game.
`offset` and `duration` options play part of a sound, and `PositionalSound` pans and fades a sound by where it is.

Browsers keep audio suspended until the player clicks or presses a key, so `Game` resumes `game.audio` on the first `pointerdown` or `keydown` (and again whenever it's been suspended since, as Safari does). Games don't need to call `resume()` themselves, but nothing is heard before that first input.

### Music

Files under `resources/audio/music/` are their own resource type (`MusicName`) and aren't preloaded, since decoded audio takes about 21 MB a minute.
`loadMusic(name)` (in `resources/music.ts`) fetches and decodes a piece when it's wanted, and `keepOnlyMusic(names)` drops the rest.
Once loaded, music plays through `SoundInstance` like any sound.

For music that has to line up, `sound/music/` schedules it on the audio clock: `musicClock.ts` finds the next bar line or phrase boundary from a start time, and `ClockedMusic.ts` starts layers together at an exact time (`ClockedLoop`, with per-layer gain ramps; `ClockedOneShot`) and stops them at a time with a short fade.

### Audio Effects

It is possible to add audio effects to Sound Instances by overriding the `makeChain` method.

## Animation

`animation/` has animation that doesn't know what it animates:

- `Track.ts`, `easing.ts`, `AnimationPlayer.ts` — keyframes of any value, and a player that plays one animation at a time, stretched to a duration, with timed events and blending from the last one.
- `Gait.ts` — a two-footed walk cycle worked out from where a body is and which way it faces, with planted feet and a callback when each lands.
- `Dangle.ts`, `DangleChain.ts` — a spring-driven swing for things hanging off a moving body (a ponytail, a lanyard), the same at any frame rate.

## Util

There are a lot of random utilities I've written over the years. In particular, make sure you check out:

- [MathUtil.ts](./util/MathUtil.ts) — Various math stuff like polar/cartesian conversions, interpolations, clamping, etc.
- [Random.ts](./util/Random.ts) — Useful for all sorts of random number stuff. I particularly like `choose(...options)`. See [Random numbers](#random-numbers) below.
- [ColorUtils.ts](./util/ColorUtils.ts) — For dealing with converting colors between different formats, blending/lerping colors, etc.
- [Profiler.ts](./util/Profiler.ts) — `profiler.measure("label", () => ...)` and the `@profile` decorator. Press Backquote in a dev build to see the results in the stats overlay.
- [Spline.ts](./util/Spline.ts), [Geometry.ts](./util/Geometry.ts), [Triangulate.ts](./util/Triangulate.ts) — Catmull-Rom splines, point-in-polygon, ear-clipping triangulation.
- [SparseSpatialHash.ts](./util/SparseSpatialHash.ts) — Cheap broadphase for your own game objects.

### Random numbers

All randomness goes through a `Random`, a seeded generator, so any run can be played again. Don't call `Math.random()` directly.

```TypeScript
choose("a", "b", "c");         // The free functions draw from the game's own Random...
this.game.random.choose(a, b); // ...which is also game.random: the same one

new Game({ seed: 123 });       // Plays a run again (the template takes ?seed=123)
game.random.seed;              // What this run started from
```

The template logs the seed when it starts, so a run you didn't seed can still be played again.

Something that has to come out the same however much randomness was used before it (a level generated over several frames) should draw from a sequence of its own, made with `fork`, and pass it along rather than using the free functions:

```TypeScript
function generateLevel(rng: Random) {
  const width = rng.integer(20, 40);
  const enemies = rng.shuffle(enemyTypes).slice(0, 3);
}
generateLevel(game.random.fork(`level-${n}`));
```

A fork is worked out from the seed and its name alone, so the same name gives the same sequence. The `Random` methods are the free functions without the `r`: `rUniform` is `uniform`, `rInteger` is `integer`, and so on. `WeightedSelector.pick(rng)` takes one too.

`cosmeticRandom` is for things that only affect looks and sound (particle jitter, a sound's pitch or start time), so that changing them never changes a seeded run. The engine's own sound code uses it.

Don't draw random numbers when a module loads. That happens before the game is seeded.

### Settings and tuning

- `state/PersistedState.ts` — `createPersistedState({ key, default })` gives you a get/set/subscribe setting backed by localStorage. Call `setPersistedStateNamespace("my-game:setting:")` once at startup. Pass `{ migrateLegacyKeys: true }` only if the game saved settings under bare keys before namespacing.
- `tuning/` — Put `//#tunable { min: 0, max: 10 }` on the line above a `let` and a dev-only Vite plugin registers it with the `TuningPanel` (toggle with Backslash) so you can drag it live.

## Vector

The `V2d` class is a 2D vector that extends Array, so it can be used as `[x, y]` tuples.

### Creating Vectors

Use the `V()` factory function to create vectors:

```TypeScript
import { V } from "core/Vector";

const a = V(3, 4);        // Create from x, y
const b = V([1, 2]);      // Create from array
const c = V(a);           // Clone another vector
const d = V();            // Zero vector (0, 0)
```

### Accessing Components

```TypeScript
const v = V(3, 4);
v.x;           // 3
v.y;           // 4
v[0];          // 3 (same as x)
v[1];          // 4 (same as y)
v.magnitude;   // 5 (length)
v.angle;       // angle in radians from east
```

### Immutable vs. In-Place Operations

Most operations come in two forms:

- **Immutable** (e.g., `add`) — returns a new vector, leaves original unchanged
- **In-place** (e.g., `iadd`) — modifies the vector, prefixed with `i`

```TypeScript
const a = V(1, 2);
const b = V(3, 4);

const c = a.add(b);  // c is [4, 6], a is still [1, 2]
a.iadd(b);           // a is now [4, 6]
```

### Common Operations

```TypeScript
v.add(other)       // Vector addition
v.sub(other)       // Vector subtraction
v.mul(scalar)      // Scalar multiplication
v.div(scalar)      // Scalar division
v.normalize()      // Unit vector (length 1)
v.rotate(angle)    // Rotate by angle (radians)
v.dot(other)       // Dot product
v.crossLength(other) // 2D cross product (z component)
v.distanceTo(other)  // Distance between points
v.lerp(other, t)   // Linear interpolation
v.reflect(normal)  // Reflect across a normal
v.limit(max)       // Clamp magnitude
```

### Coordinate Frame Conversion

Useful for converting between world and local coordinates:

```TypeScript
worldPoint.toLocalFrame(bodyPosition, bodyAngle)
localPoint.toGlobalFrame(bodyPosition, bodyAngle)
```
