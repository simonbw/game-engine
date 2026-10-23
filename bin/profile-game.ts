import { chromium } from "@playwright/test";
import { useDevServer } from "./devServer";

/** Mirrors ProfileStats from src/core/util/Profiler.ts */
interface ProfileStats {
  label: string;
  shortLabel: string;
  depth: number;
  callsPerFrame: number;
  msPerFrame: number;
  maxMs: number;
}

interface Options {
  // When set, reuse an existing server at this URL. When null, spawn our own.
  url: string | null;
  // When set, spawn our own server on this port. When null, pick a free one.
  port: number | null;
  duration: number;
  warmup: number;
  json: boolean;
  headless: boolean;
  gameStartTimeout: number;
  serverStartTimeout: number;
  // Settings to inject into localStorage before the page loads. Format:
  // key=value, repeatable.
  localStorage: Record<string, string>;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    url: null,
    port: null,
    duration: 5,
    warmup: 1,
    json: false,
    headless: true,
    gameStartTimeout: 60,
    serverStartTimeout: 60,
    localStorage: {},
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }
      return v;
    };
    switch (arg) {
      case "--url":
        opts.url = next();
        break;
      case "--port":
        opts.port = Number(next());
        break;
      case "--duration":
        opts.duration = Number(next());
        break;
      case "--warmup":
        opts.warmup = Number(next());
        break;
      case "--game-start-timeout":
        opts.gameStartTimeout = Number(next());
        break;
      case "--server-start-timeout":
        opts.serverStartTimeout = Number(next());
        break;
      case "--json":
        opts.json = true;
        break;
      case "--headed":
        opts.headless = false;
        break;
      case "--set":
        {
          const kv = next();
          const eq = kv.indexOf("=");
          if (eq < 0) throw new Error(`--set expects key=value, got ${kv}`);
          opts.localStorage[kv.slice(0, eq)] = kv.slice(eq + 1);
        }
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(
    `Usage: npm run profile-game -- [options]

By default, spawns its own dev-server on a free port (isolated — safe for
worktrees and parallel runs). Pass --url to reuse a server you already have
running (e.g. \`npm start\`).

Options:
  --url <baseUrl>              Reuse an existing dev server at this URL
                               (default: spawn our own)
  --port <number>              Port for the spawned dev server
                               (default: pick a free one)
  --duration <seconds>         Sampling duration after warmup (default: 5)
  --warmup <seconds>           Discard startup spikes before sampling (default: 1)
  --set <key=value>            Inject a localStorage entry before the page
                               loads (repeatable)
  --game-start-timeout <sec>   How long to wait for the game to start (default: 60)
  --server-start-timeout <sec> How long to wait for the spawned server (default: 60)
  --json                       Emit JSON instead of a formatted table
  --headed                     Show the browser window (default: headless)
  -h, --help                   Show this help
`,
  );
}

function buildUrl(base: string): string {
  return `${base.replace(/\/$/, "")}/`;
}

function formatTable(stats: ProfileStats[]): string {
  const lines = ["=== CPU Profiler Report ==="];
  for (const stat of stats) {
    const indent = "  ".repeat(stat.depth);
    const prefix = stat.depth > 0 ? "- " : "";
    const label = (indent + prefix + stat.shortLabel).padEnd(30);
    if (stat.msPerFrame > 0) {
      lines.push(
        `${label} calls/frame: ${stat.callsPerFrame.toFixed(1).padStart(6)}  ` +
          `ms/frame: ${stat.msPerFrame.toFixed(2).padStart(7)}  ` +
          `max: ${stat.maxMs.toFixed(2).padStart(7)}ms`,
      );
    } else {
      lines.push(
        `${label} calls/frame: ${stat.callsPerFrame.toFixed(1).padStart(6)}  (count only)`,
      );
    }
  }
  lines.push("===========================");
  return lines.join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const { baseUrl, stop } = await useDevServer({
    url: opts.url,
    port: opts.port,
    timeoutSeconds: opts.serverStartTimeout,
  });

  try {
    const args = [
      // Let the real GPU drive WebGL instead of falling back to SwiftShader.
      "--ignore-gpu-blocklist",
      // Keep the render loop running at full rate when not focused.
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-background-timer-throttling",
      "--mute-audio",
    ];
    if (process.platform === "darwin") args.push("--use-angle=metal");
    // Use Chrome's "new headless" mode (a real browser instance with GPU),
    // not the legacy headless_shell (software-only rendering).
    if (opts.headless) args.push("--headless=new");
    const browser = await chromium.launch({ headless: false, args });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      page.on("pageerror", (err) => {
        console.error(`[browser error] ${err.message}`);
      });
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          console.error(`[browser console.error] ${msg.text()}`);
        }
      });

      // Inject localStorage values BEFORE the page loads so that settings are
      // picked up by their modules' initial reads.
      if (Object.keys(opts.localStorage).length > 0) {
        await page.addInitScript((entries: Record<string, string>) => {
          for (const [k, v] of Object.entries(entries)) {
            localStorage.setItem(k, v);
          }
        }, opts.localStorage);
      }

      const target = buildUrl(baseUrl);
      console.error(`Navigating to ${target}`);
      await page.goto(target);

      // Wait for the game to exist and its loop to be ticking.
      await page.waitForFunction(
        () => ((window as any).DEBUG?.game?.ticknumber ?? 0) > 0,
        null,
        { timeout: opts.gameStartTimeout * 1000 },
      );
      console.error(
        `Game started. Warming up for ${opts.warmup}s, then sampling ${opts.duration}s...`,
      );

      await page.waitForTimeout(opts.warmup * 1000);
      await page.evaluate(() => {
        (window as any).profiler?.reset();
      });

      await page.waitForTimeout(opts.duration * 1000);

      const cpu: ProfileStats[] = await page.evaluate(
        () => (window as any).profiler?.getStats() ?? [],
      );

      if (opts.json) {
        process.stdout.write(JSON.stringify({ cpu }, null, 2) + "\n");
      } else {
        process.stdout.write(formatTable(cpu) + "\n");
      }
    } finally {
      await browser.close();
    }
  } finally {
    await stop();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
