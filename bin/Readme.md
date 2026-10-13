# /bin

Utility scripts.

## `generate-manifest.ts`

Generates `resources/resources.ts`, a manifest of every image, sound, font and piece of music (anything under `resources/audio/music/`) in `resources/`. Each asset is named after its file (camelCased, without the extension; see `src/core/resources/resourceName.ts`), which gives typed names like `ImageName` and `SoundName`, and the preloader loads everything in it. Names have to be unique per type; the generator fails if two files would share one.

Run with `npm run generate-manifest`, or `npm run watch-manifest` to regenerate as files are added and removed (`npm start` does this).

## `profile-game.ts`

Launches the game in headless Chromium via Playwright, waits for the game loop to start, and prints a per-label CPU profile table from `window.profiler` (see `src/core/util/Profiler.ts`). Spawns its own dev server on a free port unless `--url` is given.

Run with `npm run profile-game -- [--duration <sec>] [--warmup <sec>] [--json] [--set key=value] [--url <baseUrl>] [--headed]`. See `--help` for all options.

## `sync-agents-symlinks.sh`

Creates an `AGENTS.md -> CLAUDE.md` symlink next to every `CLAUDE.md` in the repo.
