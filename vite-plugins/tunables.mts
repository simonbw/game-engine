/**
 * Vite plugin for runtime-tunable values.
 *
 * Scans TypeScript files for `//#tunable` comment annotations above `let`
 * declarations and injects registration calls that wire each variable to
 * the global TunableRegistry via a setter callback.
 *
 * It only runs in the dev server. In production builds the annotations are
 * just comments and the variables remain plain constants.
 *
 * Source syntax:
 *
 *   //#tunable { min: 0.1, max: 5 }
 *   let ZOOM_SPEED: number = 0.75;
 *
 *   //#tunable("Boat/Physics") { min: 0, max: 10 }
 *   let RUDDER_CHORD: number = 1.5;
 *
 * Dev output (injected after the declaration):
 *
 *   let ZOOM_SPEED: number = 0.75;
 *   (globalThis).__tunableRegistry?.register(
 *     "CameraController/ZOOM_SPEED", 0.75,
 *     { min: 0.1, max: 5 }, (v) => { ZOOM_SPEED = v; });
 */

import path from "node:path";
import type { Plugin } from "vite";

export function tunables(): Plugin {
  return {
    name: "tunables",
    apply: "serve",
    // Before TypeScript is stripped, so the injected code can use it too
    enforce: "pre",
    transform(code, id) {
      const filePath = id.split("?")[0];
      if (
        !/\.(ts|tsx|js|jsx)$/.test(filePath) ||
        !code.includes("//#tunable")
      ) {
        return null;
      }

      const moduleName = path.basename(filePath, path.extname(filePath));

      const lines = code.split("\n");
      const result: string[] = [];
      let transformed = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match: //#tunable  or  //#tunable { opts }  or  //#tunable("Group") { opts }
        const tunableMatch = line.match(
          /\/\/#tunable\s*(?:\("([^"]+)"\))?\s*(\{[^}]*\})?\s*$/,
        );

        if (tunableMatch && i + 1 < lines.length) {
          const nextLine = lines[i + 1];

          // Match: let NAME: type = value;  or  let NAME = value;
          const declMatch = nextLine.match(
            /^(\s*)let\s+(\w+)(?:\s*:\s*\w+)?\s*=\s*([^;]+);/,
          );

          if (declMatch) {
            const [, indent, varName, value] = declMatch;
            const explicitGroup = tunableMatch[1];
            const opts = tunableMatch[2] || "{}";
            const group = explicitGroup || moduleName;
            const entryPath = `${group}/${varName}`;

            // Keep the original comment and declaration unchanged
            result.push(line);
            result.push(nextLine);

            // Inject registration call after the declaration. It goes on the
            // declaration's line so the lines after it keep their numbers.
            result[result.length - 1] +=
              ` (globalThis as any).__tunableRegistry?.register("${entryPath}", ${value.trim()}, ${opts}, (v: number) => { ${varName} = v; });`;

            transformed = true;
            i++; // Skip the declaration line (already pushed)
            continue;
          }
        }

        result.push(line);
      }

      return transformed ? { code: result.join("\n"), map: null } : null;
    },
  };
}
