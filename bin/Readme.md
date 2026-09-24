# /bin

Utility scripts.

## `generate-asset-types.ts`

A script to generate typescript declaration (.d.ts) files for assets like images, sounds, and fonts so that they can be imported with type safety.

It also generates a `resources.ts` manifest file that these resources can be easily iterated through.

This script is run with `npm run generate-manifest` or `npm run watch-manifest`.

## `dev-server.ts`

Starts Parcel on `PORT + 1` (default `1235`) and proxies it on `PORT` (default `1234`), adding the COOP/COEP headers needed for cross-origin isolation (high-resolution `performance.now()`). Serves `src/index.html` and the entity studio.

Run with `npm run dev-server` (or `npm start`, which also watches the asset manifest).

## `profile-game.ts`

Launches the game in headless Chromium via Playwright, waits for the game loop to start, and prints a per-label CPU profile table from `window.profiler` (see `src/core/util/Profiler.ts`). Spawns its own dev server on a free port unless `--url` is given.

Run with `npm run profile-game -- [--duration <sec>] [--warmup <sec>] [--json] [--set key=value] [--url <baseUrl>] [--headed]`. See `--help` for all options.

## `sync-agents-symlinks.sh`

Creates an `AGENTS.md -> CLAUDE.md` symlink next to every `CLAUDE.md` in the repo. Requires `rg` (ripgrep).
