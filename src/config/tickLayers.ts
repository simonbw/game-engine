/**
 * Define the layers that entities can tick in.
 * Layers are processed in the order they are defined in this array.
 * The first layer is processed first, and the last layer is processed last.
 * Set `tickLayer` (or `tickLayers`) on an entity to choose where it ticks.
 */
export const TICK_LAYERS = [
  "input", // Player input handling - processed earliest
  "main", // Default layer for most entities
  "effects", // Things that react to the main layer (particles, trails, etc.)
  "camera", // Camera follows final positions
] as const;

export type TickLayerName = (typeof TICK_LAYERS)[number];

/** The layer that entities that do not specify a tick layer will be added to. */
export const DEFAULT_TICK_LAYER: TickLayerName = "main";
