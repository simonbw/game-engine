import { TextureStyle } from "pixi.js";
import { smokeTestReady } from "../core/desktop";
import { Game } from "../core/Game";
import { setPersistedStateNamespace } from "../core/state/PersistedState";
import { TuningPanel } from "../core/tuning/TuningPanel";
import { createLeanPanel } from "../core/util/stats-overlay/LeanPanel";
import { createProfilerPanel } from "../core/util/stats-overlay/ProfilerPanel";
import { createRenderPanel } from "../core/util/stats-overlay/RenderPanel";
import { StatsOverlay } from "../core/util/stats-overlay/StatsOverlay";
import { ExampleEntity } from "./ExampleEntity";
import { GamePreloader } from "./GamePreloader";

// Do this so we can access the game from the console
declare global {
  interface Window {
    DEBUG: { game?: Game };
  }
}

async function main() {
  // Keep this game's persisted settings separate from other games' localStorage
  setPersistedStateNamespace("game-engine:setting:");

  // Make the pixel art crisp
  TextureStyle.defaultOptions.scaleMode = "nearest";

  // ?seed=123 plays a run again; the seed is logged either way
  const seed = new URLSearchParams(window.location.search).get("seed");
  const game = new Game({ seed: seed ? Number(seed) : undefined });
  console.info(`Random seed ${game.random.seed} (play again with ?seed=)`);
  await game.init({ rendererOptions: { backgroundColor: 0x000010 } });
  // Make the game accessible from the console
  window.DEBUG = { game };

  const preloader = game.addEntity(GamePreloader);
  await preloader.waitTillLoaded();
  preloader.destroy();

  if (import.meta.env.DEV) {
    // Backquote cycles through the stats panels
    game.addEntity(
      new StatsOverlay([
        createLeanPanel(),
        createProfilerPanel(),
        createRenderPanel(),
      ]),
    );
    // Backslash toggles the live tuning sliders for `//#tunable` values
    game.addEntity(new TuningPanel());
  }

  game.addEntity(new ExampleEntity());
  game.dispatch("exampleEvent", {
    level: 1,
    message: "Hello from main!",
  });

  // In the desktop app (`npm run electron`), its smoke test waits for this
  smokeTestReady();
}

window.addEventListener("load", main);
