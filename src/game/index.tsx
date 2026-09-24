import { TextureStyle } from "pixi.js";
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

  const game = new Game();
  await game.init({ rendererOptions: { backgroundColor: 0x000010 } });
  // Make the game accessible from the console
  window.DEBUG = { game };

  const preloader = game.addEntity(GamePreloader);
  await preloader.waitTillLoaded();
  preloader.destroy();

  if (process.env.NODE_ENV === "development") {
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
}

window.addEventListener("load", main);
