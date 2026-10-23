# /bin

Utility scripts.

## `generate-manifest.ts`

Generates `resources/resources.ts`, a manifest of every image, sound, font and piece of music (anything under `resources/audio/music/`) in `resources/`. Each asset is named after its file (camelCased, without the extension; see `src/core/resources/resourceName.ts`), which gives typed names like `ImageName` and `SoundName`, and the preloader loads everything in it. Names have to be unique per type; the generator fails if two files would share one.

Run with `npm run generate-manifest`, or `npm run watch-manifest` to regenerate as files are added and removed (`npm start` does this).

## `profile-game.ts`

Launches the game in headless Chromium via Playwright, waits for the game loop to start, and prints a per-label CPU profile table from `window.profiler` (see `src/core/util/Profiler.ts`). Spawns its own dev server on a free port unless `--url` is given.

Run with `npm run profile-game -- [--duration <sec>] [--warmup <sec>] [--json] [--set key=value] [--url <baseUrl>] [--headed]`. See `--help` for all options.

## `record-clip.ts`

Records a short video of the game a frame at a time, for looking at effects and animations. It stops the game's own loop (`Game.manualFrames`), runs each frame with `Game.stepFrames` at exactly the frame rate, and screenshots it, so the video has every frame, evenly spaced, however slowly the machine draws them. It writes an mp4 (with `ffmpeg-static`) and a contact sheet of 12 frames next to it. Like `profile-game.ts`, it spawns its own dev server unless `--url` is given.

Run with `npm run clip -- [--path "/?level=2"] [--setup "<code>" | --setup setup.js] [--skip <sec>] [--seconds 6] [--fps 60] [--size 1280x720] [--dpr 1] [--out tests/output/clip.mp4]`. `--setup` is JavaScript run once in the page before recording, with the game as `game`, that can `await import("/core/...")` engine modules to put something on screen. `--ready "<expression>"` changes what it waits for before that (by default, the game running and the preloader gone). The full list of options is in the comment at the top of the file.

## `devServer.ts`

Helpers the scripts above share for starting their own dev server on a free port, or checking one that's already running.

## `sync-agents-symlinks.sh`

Creates an `AGENTS.md -> CLAUDE.md` symlink next to every `CLAUDE.md` in the repo.
