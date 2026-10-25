# Simon's Game Engine

TODO: Write intro

## How to run locally

1. Make sure you have a recent version of [node.js](https://nodejs.org/en) installed
2. Clone this repo
3. Run `npm install` inside this repo
4. Run `npm start` to start the dev server
5. You should now be able to play the game at http://localhost:1234

To run it as a desktop app instead, run `npm run electron`. `npm run make` builds the app into `out/`.

## Structure of this project

### `src/`

The folder where all our source code (TypeScript) goes.

- `src/index.html` — This is the entrypoint to our code from the browser.
  This file then imports `src/game/index.tsx` which is the entrypoint to our typescript code.

- `src/core/` — This is the engine code that I (Simon) have built up over many years and games.
  See [src/core](src/core/) for more details about the engine.

- `src/game/`
  This is where our game's code lives.
  Basically all the code you'll be writing will probably live in here.

- `src/game/index.tsx` — The entrypoint for our TypeScript code on the page. All our code that runs can eventually be traced up to this file.

### `dist/`

This is where our compiled game goes.
You shouldn't need to poke around in here.

### `resources/`

This is where all of our assets like images, sound effects, music, fonts, etc. go.
The build system watches this folder for added/removed files and generates `.d.ts` files that make typescript aware that it can import these files. It also generates `resources.ts`, which contains lists of all the resources that we use to automatically preload them.

- `resources/audio` — This is where all of our audio files go.
- `resources/images` — This is where all of our images go.
- `resources/fonts` — This is where all of our fonts go.

## Technologies Used

This game is built on an engine I have cobbled together over the years.
There are a few big libraries in it that do the heavy lifting.

### TypeScript

The code for this project is written in [TypeScript](https://www.typescriptlang.org/), a superset of JavaScript that adds static type analysis.

### Pixi.js

This game uses a 2d rendering engine called [Pixi.js](https://pixijs.com/).

### Physics

This game uses a custom 2d physics engine that lives in `src/core/physics/`.
It started life as a TypeScript port of [p2.js](https://github.com/schteppe/p2.js/) (whose simple API I liked),
and has since gained a much faster solver, substepping, sleeping, and continuous collision detection.
See `src/core/physics/README.md` for the details.

### Vite

This project uses [Vite](https://vite.dev/) as the bundler and dev server (`vite.config.mts`).
The dev server starts in about a second, serves the game at `/` and the entity studio at `/core/entity-studio/entity-studio.html`,
and sends the cross-origin isolation headers the profiler needs for fine-grained timers.
The project's own Vite plugins are in `vite-plugins/`.
Vite doesn't type check, so run `npm run tsc` too.
