import path from "node:path";
import { mergeConfig } from "vite";
import { PORTS } from "../ports.mjs";
import gameConfig from "../vite.config.mjs";

// The desktop app's game is the web build (vite.config.mts), with its own dev
// server and output folder for Forge
export default mergeConfig(gameConfig, {
  server: {
    port: PORTS.electron,
    strictPort: false,
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "../.vite/renderer/main_window"),
  },
});
