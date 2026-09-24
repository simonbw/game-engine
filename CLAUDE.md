# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm start` - Start development server with asset watching and the Parcel dev server (proxied with COOP/COEP headers)
- `npm run build` - Build production version using Parcel
- `npm run tsc` - Run TypeScript type checking (no emit)
- `npm run tsc-watch` - Run TypeScript type checking in watch mode
- `npm test` - Run the Playwright end-to-end smoke tests (see `tests/CLAUDE.md` for testing philosophy)
- `npm run prettier` - Format source code with Prettier
- `npm run generate-manifest` - Generate asset type definitions from resources folder
- `npm run profile-game` - Run the game headless and print a CPU profile (see `.claude/skills/profile-game`)
- `npm run docs` - Generate API docs with typedoc into `api-docs/`

## Core Architecture

This is a custom 2D game engine built on TypeScript, with three main technology pillars:

### Technologies

- **Pixi.js** - 2D rendering engine for graphics and sprites
- **Custom physics** - A 2D rigid body engine in `src/core/physics/` (a TypeScript port of p2.js with a faster solver). See `src/core/physics/CLAUDE.md`.
- **Parcel** - Zero-config bundler and dev server

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
    // Called every physics tick (120fps by default)
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

The `bin/generate-asset-types.ts` script watches the `resources/` folder and generates:

- Individual `.d.ts` files for each asset
- `resources.ts` manifest with typed asset collections
- Type-safe helper functions like `imageName()` and `soundName()`

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

The game loop automatically profiles `Game.nextFrame`, `Game.tick`, each tick layer, `Game.physics`, `Game.render`, and `Game.draw`.
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
