/**
 * Records a short video of the game, for looking at effects and animations
 * without capturing the screen by hand. Starts its own dev server unless
 * `--url` points at one that's running.
 *
 *   npm run clip -- [--path "/?level=2"] [--ready "<expression>"]
 *     [--setup "<code>" | --setup setup.js] [--skip 0] [--seconds 6] [--fps 60] [--size 1280x720] [--dpr 1] [--crf 12]
 *     [--out tests/output/clip.mp4] [--keep-frames] [--url http://localhost:<port>]
 *
 * It's recorded a frame at a time rather than as a screen recording: once
 * the page is ready, the game's own loop is stopped (`Game.manualFrames`),
 * and each frame is run (`Game.stepFrames`, at exactly `fps`), then
 * screenshotted losslessly, so the video has every frame, evenly spaced,
 * however slowly the machine draws them, and none of a screen recording's
 * compression. Frames are screenshots of the page, so the HTML over the
 * canvas is in them too.
 *
 * Loads `path`, waits in real time until `ready` (a JavaScript expression,
 * with the game as `game`) is true, by default once the game is running and
 * the preloader is gone. Then it runs `setup`, if there is one: JavaScript
 * (or a file of it) run once in the page, with the game as `game`, that can
 * `await import("/core/...")` engine modules to put something on screen. Then
 * it steps `skip` seconds of game time, records
 * `seconds` of it at `size` (times `dpr`, the device pixel ratio: 2 is a
 * retina display), and writes an mp4 (H.264 at quality `crf`, lower is
 * better, 0 lossless; 4:2:0 so it plays anywhere) to `out`, and 12 of its
 * frames side by side to `<out>-sheet.png`. `--keep-frames` keeps the PNGs,
 * in `<out>-frames/`.
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "child_process";
import ffmpegPath from "ffmpeg-static";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "fs";
import { writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { useDevServer } from "./devServer";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const url = arg("url", "") || null;
const pagePath = arg("path", "/");
const ready = arg(
  "ready",
  'game.ticknumber > 0 && [...game.entities.getTagged("preloader")].length === 0',
);
const setupArg = arg("setup", "");
const setup = existsSync(setupArg) ? readFileSync(setupArg, "utf8") : setupArg;
const skip = Number(arg("skip", "0"));
const seconds = Number(arg("seconds", "6"));
const fps = Number(arg("fps", "60"));
const [width, height] = arg("size", "1280x720").split("x").map(Number);
const dpr = Number(arg("dpr", "1"));
const crf = arg("crf", "12");
const out = arg("out", "tests/output/clip.mp4");
const keepFrames = process.argv.includes("--keep-frames");

async function main() {
  const { baseUrl, stop } = await useDevServer({
    url,
    port: null,
    timeoutSeconds: 60,
  });
  let framesDir: string;
  try {
    framesDir = await record(baseUrl);
  } finally {
    await stop();
  }
  encode(framesDir);
}

/** Records the frames into a temporary folder, and returns it */
async function record(baseUrl: string): Promise<string> {
  const framesDir = mkdtempSync(path.join(tmpdir(), "game-clip-"));
  const browser = await chromium.launch({
    headless: false,
    args: ["--headless=new", "--ignore-gpu-blocklist", "--mute-audio"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: dpr,
    });
    page.on("pageerror", (error) => console.error("pageerror:", error.message));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        console.error(`console.${message.type()}:`, message.text());
      }
    });

    await page.goto(new URL(pagePath, baseUrl).href);
    await page.waitForFunction(
      `(() => { const game = window.DEBUG?.game; return !!game && (${ready}); })()`,
      undefined,
      { timeout: 180000, polling: 20 },
    );

    if (setup) {
      await page.evaluate(
        `(async () => { const game = window.DEBUG.game; ${setup}\n})()`,
      );
    }

    // Take over the game's loop, and run the frames to skip
    await page.evaluate(
      ({ fps, skipFrames }) => {
        const game = (window as any).DEBUG.game;
        game.refreshRateOverride = fps;
        game.manualFrames = true;
        game.stepFrames(skipFrames);
      },
      { fps, skipFrames: Math.round(skip * fps) },
    );

    // Straight from Chrome, with the PNG compressed for speed rather than size
    const cdp = await page.context().newCDPSession(page);
    const frames = Math.round(seconds * fps);
    const started = Date.now();
    const writes: Promise<void>[] = [];
    for (let i = 0; i < frames; i++) {
      await page.evaluate(() => (window as any).DEBUG.game.stepFrames(1));
      const { data } = await cdp.send("Page.captureScreenshot", {
        format: "png",
        optimizeForSpeed: true,
        // Device pixels: without a clip it's CSS pixels whatever the dpr
        clip: { x: 0, y: 0, width, height, scale: dpr },
      });
      writes.push(
        writeFile(
          path.join(framesDir, `frame-${String(i).padStart(5, "0")}.png`),
          Buffer.from(data, "base64"),
        ),
      );
      if (i % fps === fps - 1) {
        process.stdout.write(`\r${i + 1}/${frames} frames`);
      }
    }
    await Promise.all(writes);
    console.log(
      `\r${frames} frames in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
  } finally {
    await browser.close();
  }
  return framesDir;
}

/** Encodes the frames into the mp4 and the contact sheet */
function encode(framesDir: string) {
  mkdirSync(path.dirname(out), { recursive: true });
  execFileSync(
    ffmpegPath as unknown as string,
    [
      "-y",
      "-loglevel",
      "error",
      "-framerate",
      String(fps),
      "-i",
      path.join(framesDir, "frame-%05d.png"),
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-tune",
      "animation",
      "-crf",
      crf,
      "-pix_fmt",
      "yuv420p",
      // Even dimensions, which 4:2:0 needs
      "-vf",
      "pad=ceil(iw/2)*2:ceil(ih/2)*2",
      "-movflags",
      "+faststart",
      out,
    ],
    { stdio: "inherit" },
  );
  const base = out.replace(/\.mp4$/, "");
  if (keepFrames) {
    rmSync(`${base}-frames`, { recursive: true, force: true });
    cpSync(framesDir, `${base}-frames`, { recursive: true });
  }
  rmSync(framesDir, { recursive: true, force: true });

  // Frames side by side, for looking at it without playing it
  const sheet = `${base}-sheet.png`;
  execFileSync(
    ffmpegPath as unknown as string,
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      out,
      "-vf",
      `fps=${12 / seconds},scale=640:-1,tile=3x4`,
      "-frames:v",
      "1",
      sheet,
    ],
    { stdio: "inherit" },
  );
  console.log(`Wrote ${out} and ${sheet}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
