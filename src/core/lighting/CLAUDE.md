# Lighting

Optional 2D lighting with soft shadows, which scales to hundreds of lights and huge levels. A game that never adds a `LightingManager` pays nothing for it (nothing outside this folder imports it). From Highrise, where it was built.

## Using it

```typescript
// src/config/layers.ts: a layer that doesn't move with the camera, above
// everything that should be lit and below anything that glows on its own
lighting: (new LayerInfo({ parallax: V(0, 0) }),
  game.addEntity(new LightingManager({ layer: "lighting" })));
game.addEntity(new AmbientLight(0x202024)); // what's left where no light reaches
wall.tags.push(CAST_SHADOW_TAG); // its body's (and bodies') shapes cast shadows
this.addChild(new PointLight({ radius: 8, color: 0xffaa66, position: [x, y] }));
this.addChild(new DirectionalLight({ length: 10, direction: angle })); // a cone, like a flashlight
```

- Lights are entities, and can be added before or after the manager: it finds them all with an entity filter (`isLight`, `isAmbientLight`). With no manager they're simply not drawn.
- **Static vs `dynamic` lights.** A light is static by default: it keeps its square of the atlas and is only drawn again when its setters (`setPosition`, `setSize`, `setSourceRadius`, `enableShadows`/`disableShadows`, `setDirection`, `setRadius`) or new walls mark it `dirty`. Brightness and color (`setIntensity`, `setColor`) are free: they're applied when it's added to the screen, so static lights can flicker. Anything else that changes how one looks (its `lightSprite`, changed from outside) needs `invalidate()`. Lights that change every frame (fire, things that move) should be `dynamic: true`; they're drawn every frame.
- A plain `Light` takes any display object as its `sprite` (centered on the light, in meters, drawn additively) and a `size`, the square it lights.
- **Shadows** come from entities tagged `CAST_SHADOW_TAG`: every shape with corners (boxes, convex polygons, capsules as boxes, lines) of their `body` and `bodies`. Circles, particles, planes and heightfields don't cast. Static bodies' shapes are kept on the GPU in 16 m chunks; moving ones (doors) are rebuilt as one more chunk when they move, and the static lights where one moved are drawn again, so they're for a few things that are mostly still, not crowds. `sourceRadius` (or `softShadows` on a `PointLight`) makes them soft. `getShadowCasters` finds the casters near a point, for a game's own uses (like fog of war).
- The manager's `resolution` (pixels per meter, default 32, `setResolution`) and `dynamicShadows` are what a game's graphics settings should change. `enabled = false` draws the world unlit.

## How it works

The `LightingManager` (in `lateRender`) draws the lights in view into a screen-sized texture cleared to the ambient color, which is multiplied over the layers below its own:

1. Each light gets a square of a light atlas (`LightAtlas.ts`: pages of two textures, a mask and a light, at `resolution`). Static lights keep theirs in the `StaticLightAtlas`; dynamic ones are packed afresh into `LightAtlas` pages every frame.
2. Per page, one instanced draw call puts every light's shadows in the mask page (`ShadowCasters`; `shadowMask.vert` turns each wall edge into its shadow from each light, and `shadowMask.frag` works out how much of the light's disc it hides, so umbra and penumbra come from one calculation), and one pass draws the lights' sprites into the light page and erases what their masks cover.
3. One more pass adds every light's square onto the screen texture with its brightness (`alpha`) and color (`tint`).

So the number of render passes doesn't grow with the number of lights. The manager times its sections with `measureCpuAndGpu` (`LightingManager.static`, `.dynamic`, `.masks`, `.lights`, `.composite`), which show up in the profiler panel.

## Requirements and gotchas

- Needs Pixi's WebGL renderer with WebGL2 (the default); the manager throws otherwise. The shaders are GLSL ES 3.0, with `#version 300 es` on their first line (Pixi's `GlProgram` needs that to treat them as 3.0).
- `WEBGL_clip_cull_distance` (Chrome has it) lets the GPU clip each light's shadows to its square. Without it the fragment shader discards those pixels instead: the same picture, a bit slower.
- `gl.flush()` after the lighting passes lets the GPU start on them right away; without it the stage's sprite batches stall waiting on shared buffers.
- Atlas pages are always linearly filtered, whatever the game's default `TextureStyle` (the template's is "nearest", for pixel art).
- On a Mac (ANGLE over Metal), the GPU profiler's split into sections is unreliable; only the total timed alone is (see `GpuProfiler`).

## Tests

- `tests/lighting/casters.test.ts` (node): shape corners and an entity's bodies.
- `tests/e2e.spec.ts` ("lighting draws lights..."): a light, a wall and ambient light in the real game, checked by reading the lighting texture back, plus that static lights are only drawn when they change.
