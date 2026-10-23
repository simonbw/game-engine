import { ChildProcess, spawn } from "child_process";
import net from "net";

/** Dev server helpers shared by the scripts that drive the game in a browser */

export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (typeof address === "object" && address) {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error("Failed to find a free port"));
      }
    });
  });
}

export async function checkServer(url: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok && response.status !== 304) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Dev server not reachable at ${url} (${msg}). Start it with \`npm start\` or omit --url to spawn one.`,
    );
  }
}

export async function waitForServer(
  url: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 304) return;
      lastErr = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    `Dev server at ${url} did not become ready within ${timeoutMs / 1000}s: ${msg}`,
  );
}

export interface ServerHandle {
  url: string;
  port: number;
  kill: () => Promise<void>;
}

export async function startOwnServer(port: number): Promise<ServerHandle> {
  const url = `http://localhost:${port}`;
  // detached: true puts the child in its own process group so we can signal
  // the whole tree (npm spawns Vite as a child) via process.kill(-pid).
  const child: ChildProcess = spawn("npm", ["run", "dev-server"], {
    env: { ...process.env, PORT: String(port), NODE_ENV: "development" },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const prefix = (stream: NodeJS.WritableStream) => (chunk: Buffer) => {
    const text = chunk.toString();
    for (const line of text.split("\n")) {
      if (line.length > 0) stream.write(`[server] ${line}\n`);
    }
  };
  child.stdout?.on("data", prefix(process.stderr));
  child.stderr?.on("data", prefix(process.stderr));

  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  const kill = async (): Promise<void> => {
    if (exited || child.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Process may already be gone
    }
    await new Promise<void>((resolve) => {
      if (exited) return resolve();
      const timer = setTimeout(() => {
        if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {}
        }
        resolve();
      }, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  return { url, port, kill };
}

/**
 * Reuses the server at `url` if one is given, else starts one of our own (on
 * `port`, or a free one) and shuts it down on Ctrl+C. Returns the base URL and
 * a function that stops the server if we started it.
 */
export async function useDevServer(options: {
  url: string | null;
  port: number | null;
  timeoutSeconds: number;
}): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  if (options.url) {
    await checkServer(options.url);
    return { baseUrl: options.url, stop: async () => {} };
  }

  const port = options.port ?? (await findFreePort());
  console.error(`Starting dev server on port ${port}...`);
  const server = await startOwnServer(port);
  // Install signal handlers so Ctrl+C tears the server down cleanly.
  const onSignal = async () => {
    await server.kill();
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    await waitForServer(server.url, options.timeoutSeconds * 1000);
  } catch (err) {
    await server.kill();
    throw err;
  }
  console.error(`Dev server ready at ${server.url}`);
  return {
    baseUrl: server.url,
    stop: async () => {
      console.error("Shutting down dev server...");
      await server.kill();
    },
  };
}
