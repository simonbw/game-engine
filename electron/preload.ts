// The only bridge between the game and Electron. The page runs with context
// isolation and without Node, so `window.desktop` is all it can reach;
// keep it small. `src/core/desktop.ts` is the game's side of it, and says what
// each of these is for.

import { contextBridge, ipcRenderer } from "electron";

let fullscreen = ipcRenderer.sendSync("desktop:is-fullscreen") as boolean;
ipcRenderer.on("desktop:fullscreen", (_, value: boolean) => {
  fullscreen = value;
});

let displayFrequency = ipcRenderer.sendSync(
  "desktop:display-frequency",
) as number;
ipcRenderer.on("desktop:display-frequency", (_, value: number) => {
  displayFrequency = value;
});

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  smoke: process.argv.includes("--desktop-smoke"),
  quit: () => ipcRenderer.send("desktop:quit"),
  isFullscreen: () => fullscreen,
  displayFrequency: () => displayFrequency,
  setFullscreen: (value: boolean) =>
    ipcRenderer.send("desktop:set-fullscreen", value),
});
