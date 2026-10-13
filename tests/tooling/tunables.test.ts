import assert from "node:assert/strict";
import { test } from "node:test";
import { tunables } from "../../vite-plugins/tunables.mts";

/** Runs the plugin's transform on some source, as if it were in `id` */
function transform(code: string, id = "/src/game/CameraController.ts") {
  const plugin = tunables();
  const fn = plugin.transform as (
    code: string,
    id: string,
  ) => { code: string } | null;
  return fn.call({}, code, id)?.code ?? null;
}

test("tunables registers annotated lets and keeps line numbers", () => {
  const source = [
    "//#tunable { min: 0.1, max: 5 }",
    "let ZOOM_SPEED: number = 0.75;",
    '//#tunable("Boat/Physics") { min: 0, max: 10 }',
    "  let RUDDER_CHORD = 1.5;",
    "const AFTER = 1;",
  ].join("\n");
  const output = transform(source)!;
  const lines = output.split("\n");

  assert.equal(lines.length, 5);
  assert.match(
    lines[1],
    /^let ZOOM_SPEED: number = 0\.75; .*register\("CameraController\/ZOOM_SPEED", 0\.75, \{ min: 0\.1, max: 5 \}, \(v: number\) => \{ ZOOM_SPEED = v; \}\);$/,
  );
  assert.match(lines[3], /register\("Boat\/Physics\/RUDDER_CHORD", 1\.5, /);
  assert.equal(lines[4], "const AFTER = 1;");
});

test("tunables leaves other files alone", () => {
  assert.equal(transform("let X = 1;"), null);
  assert.equal(transform("//#tunable\nlet X = 1;", "/src/styles.css"), null);
  // A comment with no let after it changes nothing
  assert.equal(transform("//#tunable\nconst X = 1;"), null);
});
