# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm start` - Start the Vite dev server and the asset manifest watcher
- `npm run build` - Build production version with Vite (into `dist/`)
- `npm run tsc` - Run TypeScript type checking (no emit)
- `npm run tsc-watch` - Run TypeScript type checking in watch mode
- `npm test` - Run the unit tests (`node:test`, in Node) and then the Playwright browser tests (see `tests/CLAUDE.md`)
- `npm run prettier` - Format source code with Prettier
- `npm run generate-manifest` - Generate asset type definitions from resources folder
- `npm run profile-game` - Run the game headless and print a CPU profile (see `.claude/skills/profile-game`)
- `npm run docs` - Generate API docs with typedoc into `api-docs/`

## Core Architecture

This is a custom 2D game engine built on TypeScript, with three main technology pillars:

### Technologies

- **Pixi.js** - 2D rendering engine for graphics and sprites
- **Custom physics** - A 2D rigid body engine in `src/core/physics/` (a TypeScript port of p2.js with a faster solver). See `src/core/physics/CLAUDE.md`.
- **Vite** - Bundler and dev server (`vite.config.mts`, plugins in `vite-plugins/`). It doesn't type check, so always run `npm run tsc` too.

### Entity-Component System

The engine follows an Entity-based architecture where everything in the game extends `BaseEntity` and implements the `Entity` interface:

- **Game class** (`src/core/Game.ts`) - Top-level controller managing the game loop, entities, physics, rendering, and input
- **Entity interface** (`src/core/entity/Entity.ts`) - Core interface for all game objects with lifecycle hooks
- **EntityList** - Manages entity collections with tag-based, id-based, and constructor-based querying
- **Event System** - Entities respond to game events like `tick`, `render`, `add`, `destroy` via `@on` handlers

### Key Systems

- **Physics**: Rigid bodies with collision detection, springs, and constraints
- **Rendering**: Layered Pixi sprite system with camera controls
- **Input**: Centralized IO manager for keyboard, mouse, and gamepad input
- **Audio**: Web Audio API integration with positional sound support and a persisted master volume
- **Lighting** (optional): lights with soft shadows from walls, drawn on the GPU, in `src/core/lighting/` (see its `CLAUDE.md`). Off unless the game adds a `LightingManager`
- **Asset Management**: Automatic type generation for resources in `resources/` folder

### Project Structure

- `src/core/` - Engine code (Game, Entity, physics, graphics, IO, utilities)
- `src/game/` - Game-specific code and entities
- `src/config/` - Configuration files (layers, tick layers, collision groups, constants)
- `resources/` - Assets (images, audio, fonts) with auto-generated TypeScript definitions
- `bin/` - Dev scripts (asset type generation, dev server, profiler harness)
- `tests/` - Playwright end-to-end tests

### Entity Lifecycle & Event Handlers

Entities respond to game events by implementing handler methods decorated with `@on`.
A handler without the decorator will never be called.

```typescript
import { on } from "../core/entity/handler";

class MyEntity extends BaseEntity {
  @on("tick")
  onTick({ dt }: GameEventMap["tick"]) {
    // Called every physics tick: one per display refresh (60, 120, 144 Hz...),
    // so scale anything that changes per tick by dt
  }

  @on("render")
  onRender({ dt }: GameEventMap["render"]) {
    // Called every render frame for visual updates
  }
}
```

Common lifecycle events:

- `add` - Called when added to game, before physics/rendering setup
- `afterAdded` - Called after all setup is complete
- `tick` - Called every physics tick. Runs in layers (`src/config/tickLayers.ts`); set `tickLayer` on an entity to choose one.
- `afterPhysicsStep` - Called after each physics step
- `render` / `lateRender` - Called every render frame
- `destroy` - Called when entity is removed

### Asset System

The `bin/generate-manifest.ts` script watches the `resources/` folder and generates `resources/resources.ts`, a manifest with typed asset collections (`ImageName`, `SoundName`, `FontName`, and `MusicName` for files under `resources/audio/music/`, which are loaded on demand rather than preloaded). Each asset is named after its file, camelCased without the extension, and names must be unique per type.
Use the helpers in `src/core/resources/resourceUtils.ts` like `imageName()` and `soundName()` to check names in code.

### Physics Integration

Entities can have:

- `body` - Single physics body
- `bodies` - Multiple physics bodies
- `springs` - Physics springs
- `constraints` - Physics constraints

All automatically added/removed from the physics world when entities are added/destroyed.
Create bodies with the factories in `src/core/physics/body/bodyFactories.ts`, e.g. `createRigid2D({ motion: "dynamic", mass: 1 })`.

### Custom Events

Define custom events in `src/config/CustomEvent.ts` and dispatch them with `game.dispatch()`. Handle them with the `@on` decorator:

```typescript
// In src/config/CustomEvent.ts
export type CustomEvents = {
  levelStarted: { level: number };
};

// In your entity
@on("levelStarted")
onLevelStarted({ level }: GameEventMap["levelStarted"]) {
  console.log(`Starting level ${level}`);
}
```

### Entity Finding

- Use `tags` array on entities for categorization
- Query with `game.entities.getTagged("tagName")`
- Use unique `id` for single entities: `game.entities.getById("entityId")`
- For singleton entities (one instance per game), use `game.entities.getSingleton(ClassName)` or `game.entities.tryGetSingleton(ClassName)` for optional access

### Engine Gotchas

The engine's practical tips are in `src/core/Readme.md` (entities, events, rendering gotchas) and `src/core/physics/README.md` ("Practical tips"). The ones that cause silent bugs:

- `onRender` is only for looks; things out of view may skip it, so nothing else may depend on it having run.
- Use `this.addChild(entity)` for anything that should be destroyed with its owner. Code after `await this.wait(...)` never runs once the entity is destroyed.
- All randomness goes through a `Random` (`src/core/util/Random.ts`): never `Math.random()`, and never at module load. Code that must be reproducible takes a `Random` (e.g. `game.random.fork("level-3")`); looks and sound use `cosmeticRandom`.
- Only pairs with a dynamic body are collision-tested. Moving a body by hand doesn't update its AABB until the next physics step.
- Shaders that need GLSL ES 3.0 must start with `#version 300 es`, or Pixi compiles them as ES 1.0.

### Profiler

Use the `profiler` singleton from `src/core/util/Profiler.ts` to measure performance:

```typescript
import { profiler } from "./util/Profiler";

profiler.measure("myOperation", () => {
  // ... code to measure ...
});

// Just count calls without timing overhead
profiler.count("frequentEvent");
```

The game loop automatically profiles `Game.nextFrame`, `Game.tick`, each tick layer (`tick.<layer>`, and `render.<layer>` for rendering), `Game.physics`, `Game.render`, and `Game.draw`.
The profiler panel also times the GPU's work (`src/core/util/GpuProfiler.ts`, WebGL timer queries), and while it's open, each entity class's handlers (`profiler.entityDetail`).
For benchmarks, `profiler.startCapture()` / `stopCapture()` give exact averages over a window.
In a dev build, press Backquote to cycle through the stats overlay panels, and Backslash to open the tuning panel for `//#tunable` values.

## Development Practice

You never need to run the dev server.
You never need to ask the user if they want you to run the dev server.
The user always has the dev server running and can test things out if you want them to.
Don't try to access their running dev server yourself.

Before presenting any feature, change, or fix as done, run `npm test` and confirm it passes. If a test fails, investigate and fix it before reporting back — don't hand off a broken state for the user to discover. The same goes for `npm run tsc` for type errors.

### Code Style

- Always use named exports, never default exports.
- Do not use barrel exports (`index.ts`) in `src/`; use explicit file imports instead.
- Use built-in classes for math operations. For vector math, use `V2d` and utility functions from `src/core/util/MathUtil.ts`.
- Only use `onAdd()` if you need access to `this.game` during initialization. Otherwise, do all initialization in the constructor.
- Every event handler needs its `@on("eventName")` decorator, and the method must be named `on` + the capitalized event name.
