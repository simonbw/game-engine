---
name: profile-game
description: Measure runtime performance of the game by running it headless under Playwright and reading back profiler stats. Use when the user asks to profile the game, measure frame time, find hot spots, compare perf before/after a change, or check whether something regressed. Also invoked via /profile-game.
argument-hint: [--duration <sec>] [--json] [extra profile-game flags]
allowed-tools: Bash, Read, Grep, Glob, Edit
---

# Profile Game

Runs `bin/profile-game.ts` — a headless Chromium harness that loads the game at `/`, waits for `window.DEBUG.game` to start ticking, samples `profiler.getStats()` for N seconds, and prints a table:

- **CPU Profiler Report** — per-label `ms/frame`, `calls/frame`, and `max` from the CPU `profiler` (`src/core/util/Profiler.ts`, instrumented via `profiler.measure` / `@profile` / `profiler.count`).

## When to use

- "Is this slow?" / "profile X" / "why is the frame time high?"
- Comparing performance before vs after a change (stash → run → unstash → run)
- Verifying a perf-sensitive change (physics, rendering, entity ticks, etc.) didn't regress

## Basic invocation

```bash
npm run profile-game
```

That's it — by default it spawns its own isolated dev server on a free port (safe in worktrees and when the user already has `npm start` running). It prints the profile table to stdout and server logs to stderr prefixed with `[server]`.

## Common flags

| Flag | Purpose |
|---|---|
| `--duration <sec>` | Sample window after warmup. Default 5. Use 10+ for noisy signals. |
| `--warmup <sec>` | Settle time before sampling (discards startup spikes). Default 1. |
| `--json` | Emit JSON instead of the formatted table (useful for programmatic comparison). |
| `--set <key=value>` | Inject a localStorage entry before the page loads (repeatable). Useful for settings the game reads at startup. |
| `--headed` | Show the browser window (for debugging the harness itself). |
| `--url <baseUrl>` | Reuse an existing dev server (e.g. `http://localhost:1234`) instead of spawning. |
| `--port <n>` | Force the spawned server to a specific port. |
| `--game-start-timeout <sec>` | Raise if the game takes >60s to initialize (cold cache). |

Run `npm run profile-game -- --help` for the full list.

## Reading the output

The table is hierarchical (indented by depth). Labels come from wherever the code calls `profiler.measure(...)`, `profiler.start/end`, `profiler.count(...)`, or uses the `@profile` decorator; nested calls appear under their parent scope.

Interpret:
- `ms/frame` = total time spent in that label each frame (summed across all calls).
- `calls/frame` = how often it ran. A value <1 means that label didn't run every frame.
- `max` = worst single-call duration observed in the sample window — useful for catching spikes the average hides.
- `(count only)` labels are `profiler.count()` calls — no timing, just a rate.

## Comparing before/after a change

For any perf-sensitive diff, capture both sides and diff the tables:

```bash
# After change
npm run profile-game -- --duration 10 --json > /tmp/after.json

# Roll back to the baseline (git stash or checkout the parent commit) and run again
git stash
npm run profile-game -- --duration 10 --json > /tmp/before.json
git stash pop
```

Then diff or skim side by side. Keep every variable constant (duration, warmup, injected settings) between runs, and close other CPU-heavy apps — thermal throttling and background work introduce a lot of noise. Run each side twice if the delta you're chasing is small.

## Drilling into a specific system

If the user is investigating a specific subsystem and the existing labels aren't granular enough:

1. `Grep` for `profiler\.` in the relevant directory to see what's already instrumented.
2. If you need more detail, add `profiler.measure("subsystem.step", () => { ... })` around the suspect code.
3. Re-run profile-game.
4. Remove the temporary measurements before committing (or keep them if they're reasonable permanent instrumentation — ask first).

## Gotchas

- First-run startup can be slow while Parcel does an initial cold build — bump `--server-start-timeout` if the spawn times out.
- Rendering uses WebGL through Pixi.js; the harness passes `--ignore-gpu-blocklist` (and `--use-angle=metal` on macOS) so headless Chrome uses the real GPU rather than SwiftShader.
- The profiler resets right after warmup, so `--warmup 0` will include load spikes in the sample.
- Headless Chrome on Apple Silicon can be scheduled onto efficiency cores, so absolute CPU numbers may be pessimistic compared to `--headed`. Relative before/after comparisons remain valid as long as both sides use the same mode.
