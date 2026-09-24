import { Game } from "../Game";
import { V2d } from "../Vector";
import { Entity } from "./Entity";

export type BaseGameEvents = {
  /**
   * Called when added to the game, during the early phase of entity setup.
   *
   * At this point:
   * - `this.game` is set and accessible
   * - The entity is NOT yet in the EntityList
   * - Physics bodies/springs/constraints are NOT yet in the world
   * - Sprites are NOT yet on the stage
   * - Children have NOT been added yet
   *
   * Use `onAdd` when you need access to `this.game` to complete initialization
   * but don't depend on physics or children being set up.
   *
   * If the entity is destroyed during onAdd (e.g., via `this.destroy()`),
   * the entity will not be fully added to the game.
   *
   * @see onAfterAdded - Called after all setup is complete
   */
  add: { game: Game; parent?: Entity };
  /**
   * Called after the entity is fully added to the game.
   *
   * At this point:
   * - `this.game` is set and accessible
   * - The entity IS in the EntityList (can be found via tags, id, filters)
   * - Physics bodies/springs/constraints ARE in the world
   * - Sprites ARE on the stage
   * - All children HAVE been added
   * - `onResize` has been called if the entity has that handler
   *
   * Use `onAfterAdded` when you need to interact with the fully initialized
   * entity, such as querying other entities, accessing physics state, or
   * relying on children being present.
   *
   * @see onAdd - Called during early setup before physics/children
   */
  afterAdded: { game: Game };
  /** Called once per frame after all physics ticks for that frame have run */
  afterPhysics: void;
  /** Called after each physics step (inside the tick loop, before contacts). Data is the step dt. */
  afterPhysicsStep: number;
  /** Called before rendering - use destructuring: onRender({ dt }) */
  render: {
    /** Delta time since last frame */
    dt: number;
  };
  /** Called after all `render` handlers, right before the frame is drawn */
  lateRender: {
    /** Delta time since last frame */
    dt: number;
  };
  /** Called during the update tick */
  tick: {
    /** Fixed timestep duration for this tick, in seconds */
    dt: number;
    /** The audio context time this tick corresponds to. Use it to schedule sounds precisely. */
    audioTime: number;
  };
  /** Called once per frame, before ticks, with the frame's (slow-mo scaled) duration */
  slowTick: number;
  /** Called when the game is paused */
  pause: void;
  /** Called when the game is unpaused */
  unpause: void;
  /** Called after being destroyed */
  destroy: { game: Game };
  /** Called when the renderer is resized or recreated for some reason */
  resize: { size: V2d };
  /** Called when the slow motion factor changes */
  slowMoChanged: { slowMo: number };
};
