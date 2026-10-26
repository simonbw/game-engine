import path from "node:path";
import { defineConfig } from "vite";
import { PORTS } from "./ports.mjs";
import { plainManifestUrls } from "./vite-plugins/plainManifestUrls.mjs";
import { tunables } from "./vite-plugins/tunables.mjs";

// Cross-origin isolation. Without it, browsers coarsen performance.now() to
// about 100µs, which makes the profiler's numbers mostly noise.
const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// The pages live in src/: the game at /, and in development the entity studio
// at /core/entity-studio/entity-studio.html. Assets come from resources/,
// outside that root.
export default defineConfig({
  root: "src",
  publicDir: false,
  plugins: [tunables(), plainManifestUrls()],
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : PORTS.dev,
    strictPort: true,
    headers: ISOLATION_HEADERS,
    // The game can't hot swap modules, and a reload in the middle of playing
    // is worse than reloading by hand
    hmr: false,
    watch: {
      // The manifest watcher regenerates resources/resources.ts itself; the
      // rest of resources/ is only ever loaded by URL
      ignored: ["**/resources/{audio,images,fonts}/**"],
    },
    fs: {
      allow: [".."],
    },
  },
  preview: {
    headers: ISOLATION_HEADERS,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // One file per asset, never inlined, the same as every other asset
    assetsInlineLimit: 0,
    rolldownOptions: {
      // The entity studio is development only
      input: path.resolve(import.meta.dirname, "src/index.html"),
      // Class names show up in the profiler and in error messages
      output: { keepNames: true },
    },
  },
});
