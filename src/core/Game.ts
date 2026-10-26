import { DEFAULT_LAYER, LAYERS } from "../config/layers";
import { TICK_LAYERS } from "../config/tickLayers";
import { ContactList } from "./ContactList";
import { EntityList } from "./EntityList";
import { desktop } from "./desktop";
import { FramePacer, RefreshRateEstimator } from "./FramePacing";
import { V } from "./Vector";
import { BaseGameEvents } from "./entity/BaseGameEvents";
import { Entity, GameEventMap } from "./entity/Entity";
import { eventHandlerName } from "./entity/EventHandler";
import { IoEvents } from "./entity/IoEvents";
import {
  GameRenderer2d,
  GameRenderer2dOptions,
} from "./graphics/GameRenderer2d";
import { IOManager } from "./io/IO";
import type { Body } from "./physics/body/Body";
import { createRigid2D } from "./physics/body/bodyFactories";
import { PhysicsEventMap } from "./physics/events/PhysicsEvents";
import { World } from "./physics/world/World";
import {
  getMasterVolume,
  onMasterVolumeChange,
} from "./sound/MasterVolumeState";
import { gpuProfiler } from "./util/GpuProfiler";
import { profile, profiler } from "./util/Profiler";
import { Random, random } from "./util/Random";

interface GameOptions {
  audio?: AudioContext;
  world?: World;
  /** Seeds `game.random`, to play a run again. Without one, it picks its own. */
  seed?: number;
}

/**
 * Ticks happen at least this often: below it (a frame rate limit of 30, or a
 * display throttled to 30 by power saving), each frame runs more than one
 * tick, so the physics steps stay small.
 */
const MIN_TICK_RATE = 60;

/** Input that counts as a user gesture, so the audio can be resumed from it */
const RESUME_AUDIO_EVENTS = ["pointerdown", "keydown"] as const;

/** Top Level control structure */
export class Game {
  /** Keeps track of entities in lots of useful ways */
  readonly entities: EntityList;
  /** Keeps track of entities that are ready to be removed */
  readonly entitiesToRemove: Set<Entity>;
  /** The Pixi-backed renderer. Owns the canvas, the layers, and the camera. */
  readonly renderer: GameRenderer2d;
  /** Manages keyboard/mouse/gamepad state and events. */
  private _io!: IOManager;
  get io(): IOManager {
    return this._io;
  }
  private set io(value: IOManager) {
    this._io = value;
  }

  /** The top level container for physics. */
  readonly world: World;
  /** Keep track of currently occuring collisions */
  readonly contactList: ContactList;
  /** A static physics body positioned at [0,0] with no shapes. Useful for constraints/springs */
  readonly ground: Body;
  /**
   * The game's random numbers: the same `Random` the free functions in
   * `util/Random.ts` (`choose`, `rUniform`...) draw from. `random.seed` plays
   * the run again.
   */
  readonly random: Random = random;
  /** The audio context that is connected to the output */
  readonly audio: AudioContext;
  /** Volume control for all sound output by the game. */
  readonly masterGain: GainNode;
  /** Readonly. Whether or not the game is paused */
  paused: boolean = false;
  /** Readonly. Number of frames that have gone by */
  framenumber: number = 0;
  /** Readonly. Number of ticks that have gone by */
  ticknumber: number = 0;
  /** The timestamp (ms) of the last animation frame callback */
  lastFrameTime: number = window.performance.now();

  /**
   * The display's refresh rate (Hz), as measured, unless `refreshRateOverride`
   * is set. See `RefreshRateEstimator`.
   */
  private readonly refreshRateEstimator = new RefreshRateEstimator(
    60,
    desktop?.displayFrequency() || undefined,
  );
  private readonly framePacer = new FramePacer();
  /**
   * Pretends the display runs at this rate, and that every animation frame
   * callback is one of its refreshes, however much time really went by: for
   * benchmarks, which run without vsync. Every callback then runs a frame
   * (unless `frameRateLimit` is lower), so the browser calls back as soon as
   * the last frame is done, and the intervals between frames are what they
   * cost, CPU and GPU. (Skipping callbacks without drawing anything makes
   * headless Chrome call back irregularly, about every 15 ms.)
   */
  refreshRateOverride: number | undefined;
  /**
   * While set, animation frames don't run the game: only `stepFrames` does,
   * one frame of `targetFrameRate` at a time however long it really takes.
   * For recording video a frame at a time, or stepping through frames from
   * the console.
   */
  manualFrames = false;
  /** The player's frame rate limit, for fast displays on slow machines. Undefined is the display's rate */
  frameRateLimit: number | undefined;

  /** The display's refresh rate in Hz */
  get refreshRate(): number {
    return this.refreshRateOverride ?? this.refreshRateEstimator.rate;
  }
  /** Frames per second the game runs at: the display's rate, unless it's limited */
  get targetFrameRate(): number {
    return Math.min(this.refreshRate, this.frameRateLimit ?? Infinity);
  }
  /** Ticks per rendered frame: 1, unless the frame rate is below `MIN_TICK_RATE` */
  get ticksPerFrame(): number {
    return Math.max(1, Math.ceil(MIN_TICK_RATE / this.targetFrameRate));
  }
  /** Ticks per second at regular speed */
  get ticksPerSecond(): number {
    return this.targetFrameRate * this.ticksPerFrame;
  }
  /** Seconds simulated per tick at regular speed */
  get tickDuration(): number {
    return 1 / this.ticksPerSecond;
  }

  /** ID of the current animation frame request, used for cancellation */
  private animationFrameId: number = 0;
  /** Whether the game has been destroyed */
  private destroyed: boolean = false;
  /** Whether the animation-frame loop is currently running. */
  private looping: boolean = false;

  /** Total amount of game time that has elapsed */
  elapsedTime: number = 0;
  /** Total amount of game time that has elapsed while not paused */
  elapsedUnpausedTime: number = 0;
  /**
   * Seconds the world has been simulated: the ticks' `dt`s while not paused,
   * so slow motion slows it down. For bringing looks up to date in `onRender`
   * by how much happened since the last frame.
   */
  simulatedTime: number = 0;

  /** The camera that controls the viewport */
  get camera() {
    return this.renderer.camera;
  }

  private _slowMo: number = 1.0;
  /** Multiplier of time that passes during tick */
  get slowMo() {
    return this._slowMo;
  }

  set slowMo(value: number) {
    if (value != this._slowMo) {
      this._slowMo = value;
      this.dispatch("slowMoChanged", { slowMo: this._slowMo });
    }
  }

  /**
   * Create a new Game.
   * NOTE: You must call .init() before actually using the game.
   */
  constructor({ audio, world, seed }: GameOptions = {}) {
    if (seed !== undefined) {
      random.reseed(seed);
    }

    this.entities = new EntityList();
    this.entitiesToRemove = new Set();

    this.renderer = new GameRenderer2d(
      LAYERS,
      DEFAULT_LAYER,
      this.onResize.bind(this),
    );

    this.world = world ?? new World();
    this.world.on("beginContact", this.beginContact, null);
    this.world.on("endContact", this.endContact, null);
    this.world.on("impact", this.impact, null);
    this.ground = createRigid2D({ motion: "static" });
    this.world.bodies.add(this.ground);
    this.contactList = new ContactList();

    this.audio = audio ?? new AudioContext();
    this.masterGain = this.audio.createGain();
    this.masterGain.gain.value = getMasterVolume();
    this.masterGain.connect(this.audio.destination);
    this.unsubscribeMasterVolume = onMasterVolumeChange((volume) => {
      this.masterGain.gain.setTargetAtTime(
        volume,
        this.audio.currentTime,
        0.01,
      );
    });
  }

  private readonly unsubscribeMasterVolume: () => void;

  /**
   * Browsers start audio suspended until the page has been clicked or typed
   * in, and the audio context is made before that, so it stays silent until
   * it's resumed from one of those. It can be suspended again later (Safari
   * does, when the device's audio is interrupted), so this keeps listening.
   * In the capture phase, so a handler that stops the event can't block it.
   */
  private readonly resumeAudio = () => {
    if (this.audio.state !== "running") {
      void this.audio.resume();
    }
  };

  /** Initialize the game. By default also starts the animation-frame loop. */
  async init({
    rendererOptions = {},
    autoStart = true,
  }: {
    rendererOptions?: GameRenderer2dOptions;
    autoStart?: boolean;
  } = {}) {
    profiler.registerScope("Game.nextFrame");

    await this.renderer.init(rendererOptions);
    // Undefined unless Pixi chose WebGL
    gpuProfiler.init(
      (this.renderer.app.renderer as { gl?: WebGL2RenderingContext }).gl,
    );
    // IO events don't respect pause state
    const dispatchIo = <E extends keyof IoEvents>(
      event: E,
      data: IoEvents[E],
    ) => this.dispatch(event, data as GameEventMap[E], false);
    this.io = new IOManager(this.renderer.canvas, dispatchIo);
    this.addEntity(this.renderer.camera);

    for (const type of RESUME_AUDIO_EVENTS) {
      window.addEventListener(type, this.resumeAudio, { capture: true });
    }

    if (autoStart) {
      this.startLoop();
    }
  }

  /**
   * Start the animation-frame loop. Called automatically by init() unless
   * autoStart is false. Safe to call if the loop is already running.
   */
  startLoop() {
    if (this.looping || this.destroyed) return;
    this.looping = true;
    this.lastFrameTime = window.performance.now();
    this.lastAudioTime = this.audio.currentTime;
    this.animationFrameId = window.requestAnimationFrame((t) => this.loop(t));
  }

  /**
   * Stop the animation-frame loop. The game will not advance until startLoop()
   * is called or stepFrames() is called (e.g. from the DevTools console).
   */
  stopLoop() {
    this.looping = false;
    window.cancelAnimationFrame(this.animationFrameId);
  }

  /** See pause() and unpause(). */
  togglePause() {
    if (this.paused) {
      this.unpause();
    } else {
      this.pause();
    }
  }

  /** Called when renderer is resized */
  onResize(size: [number, number]) {
    this.dispatch("resize", { size: V(size) });
  }

  /**
   * Pauses the game. This stops physics from running, calls onPause()
   * handlers, and stops updating `pausable` entities.
   */
  pause() {
    if (!this.paused) {
      this.paused = true;
      this.dispatch("pause", undefined);
    }
  }

  /** Resumes the game and calls onUnpause() handlers. */
  unpause() {
    this.paused = false;
    this.dispatch("unpause", undefined);
  }

  /** Destroy the game and clean up all resources. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    // Cancel the animation frame loop
    this.stopLoop();

    // Destroy all entities
    for (const entity of this.entities) {
      this.cleanupEntity(entity);
    }
    this.entitiesToRemove.clear();

    // Remove physics world event listeners
    this.world.off("beginContact", this.beginContact);
    this.world.off("endContact", this.endContact);
    this.world.off("impact", this.impact);

    // Clear physics world
    this.world.clear();

    // Destroy IO manager (clears interval and event listeners)
    this.io.destroy();

    // Destroy renderer
    this.renderer.destroy();

    // Close audio context
    for (const type of RESUME_AUDIO_EVENTS) {
      window.removeEventListener(type, this.resumeAudio, { capture: true });
    }
    this.unsubscribeMasterVolume();
    this.audio.close();
  }

  /** Dispatch an event. */
  dispatch<EventName extends keyof GameEventMap>(
    eventName: EventName,
    data: GameEventMap[EventName],
    respectPause = true,
  ) {
    const effectivelyPaused = respectPause && this.paused;
    for (const entity of this.entities.getHandlers(eventName)) {
      if (entity.isAdded && !(effectivelyPaused && entity.pausable)) {
        const functionName = eventHandlerName(eventName);
        const handler = entity[functionName];
        if (typeof handler !== "function") {
          console.error(
            `Entity ${entity.constructor.name} registered for "${eventName}" but has no ${functionName} method`,
            entity,
          );
          continue;
        }
        handler.call(entity, data);
      }
    }
  }

  /** Add an entity to the game. */
  addEntity = <T extends Entity>(entity: T): T => {
    entity.game = this;
    if (entity.onAdd) {
      entity.onAdd({ game: this, parent: entity.parent });
    }

    // If the entity was destroyed during it's onAdd, we shouldn't add it
    if (!entity.isAdded) {
      return entity;
    }

    this.entities.add(entity);

    if (entity.body) {
      entity.body.owner = entity;
      this.world.bodies.add(entity.body);
    }
    if (entity.bodies) {
      for (const body of entity.bodies) {
        body.owner = entity;
        this.world.bodies.add(body);
      }
    }
    if (entity.springs) {
      for (const spring of entity.springs) {
        this.world.addSpring(spring);
      }
    }
    if (entity.constraints) {
      for (const constraint of entity.constraints) {
        this.world.constraints.add(constraint);
      }
    }

    if (entity.sprite) {
      this.renderer.addSprite(entity.sprite);
      entity.sprite.owner = entity;
    }
    if (entity.sprites) {
      for (const sprite of entity.sprites) {
        this.renderer.addSprite(sprite);
        sprite.owner = entity;
      }
    }

    if (entity.onResize) {
      entity.onResize({ size: this.renderer.getSize() });
    }
    // So it knows which prompts to show from the start, not just on a change
    if (entity.onInputDeviceChange && this._io) {
      entity.onInputDeviceChange({ usingGamepad: this._io.usingGamepad });
    }

    if (entity.children) {
      for (const child of entity.children) {
        if (!child.isAdded) {
          this.addEntity(child);
        }
      }
    }

    if (entity.onAfterAdded) {
      entity.onAfterAdded({ game: this });
    }

    return entity;
  };

  /** Shortcut for adding multiple entities. */
  addEntities<T extends readonly Entity[]>(...entities: T): T {
    for (const entity of entities) {
      this.addEntity(entity);
    }
    return entities;
  }

  /**
   * Remove an entity from the game.
   * The entity will actually be removed during the next removal pass.
   * This is because there are times when it's not safe to remove an entity, like in the middle of a physics step.
   */
  removeEntity(entity: Entity) {
    (entity as any).game = undefined;
    if (this.world.stepping) {
      this.entitiesToRemove.add(entity);
    } else {
      this.cleanupEntity(entity);
    }
    return entity;
  }

  /**
   * Removes all non-persistent entities from the game scene.
   * Only removes top-level entities (those without parents) to avoid double-cleanup.
   *
   * @param persistenceThreshold - Entities with persistence level <= this value will be removed (default: 0)
   * @example
   * // Remove all level-specific entities (Persistence.Level)
   * game.clearScene();
   *
   * // Remove level and game-specific entities (Persistence.Level and Persistence.Game)
   * game.clearScene(Persistence.Game);
   */
  clearScene(persistenceThreshold = 0) {
    for (const entity of this.entities) {
      if (
        entity.isAdded && // Not already destroyed
        !this.entitiesToRemove.has(entity) && // not already about to be destroyed
        entity.persistenceLevel <= persistenceThreshold &&
        !entity.parent // We only wanna deal with top-level things, let parents handle the rest
      ) {
        entity.destroy();
      }
    }
  }

  /** Audio time at the end of the last frame's tick loop */
  private lastAudioTime: number = 0;

  /**
   * Every animation frame callback: usually runs one frame (a tick and a
   * render), sometimes none (when the frame rate is limited below the
   * display's) or a few (to catch up after a dropped frame). See `FramePacer`.
   */
  private loop(time: number): void {
    if (this.destroyed || !this.looping) return;
    // With the rate overridden, every callback is one refresh of that display,
    // however long it really took (see `refreshRateOverride`)
    const elapsed = this.refreshRateOverride
      ? 1 / this.refreshRateOverride
      : (time - this.lastFrameTime) / 1000;
    this.lastFrameTime = time;
    if (!this.manualFrames) {
      // The desktop app knows the display's rate (which changes when the
      // window moves to another display); a browser can only measure it
      this.refreshRateEstimator.maxRate =
        desktop?.displayFrequency() || undefined;
      this.refreshRateEstimator.addFrame(time / 1000);
      const frames = this.framePacer.framesFor(
        elapsed,
        this.refreshRateOverride
          ? 1 / this.refreshRateOverride
          : this.refreshRateEstimator.interval,
        this.refreshRate,
        this.targetFrameRate,
      );
      if (frames > 0) {
        this.nextFrame(frames);
      }
    }

    // Request the next frame at the END so a frame that throws stops the
    // loop rather than repeating every frame
    if (this.looping && !this.destroyed) {
      this.animationFrameId = window.requestAnimationFrame((t) => this.loop(t));
    }
  }

  /**
   * Runs `count` frames (each a tick and a render) right now, each one frame
   * of `targetFrameRate`. With `manualFrames` set (or after `stopLoop()`),
   * this is the only thing that moves the game on.
   */
  stepFrames(count: number = 1): void {
    for (let i = 0; i < count; i++) {
      this.nextFrame(1);
    }
  }

  /**
   * Runs `frames` frames' worth of ticks at the target frame rate, each
   * stepping the ideal tick time rather than the time that actually went by,
   * then renders once.
   */
  @profile
  private nextFrame(frames: number): void {
    if (this.destroyed) return;

    this.framenumber += 1;
    gpuProfiler.poll();

    const renderDt = frames / this.targetFrameRate;
    this.elapsedTime += renderDt;
    if (!this.paused) {
      this.elapsedUnpausedTime += renderDt;
    }

    this.slowTick(renderDt * this.slowMo);

    const tickDt = this.tickDuration * this.slowMo;
    const ticks = frames * this.ticksPerFrame;

    // Distribute real audio time evenly across this frame's ticks
    const audioNow = this.audio.currentTime;
    const audioTimeStep = (audioNow - this.lastAudioTime) / ticks;
    let tickAudioTime = this.lastAudioTime;

    for (let i = 0; i < ticks; i++) {
      tickAudioTime += audioTimeStep;
      this.tick(tickDt, tickAudioTime);

      if (!this.paused) {
        this.simulatedTime += tickDt;
        profiler.measure("Game.physics", () => this.world.step(tickDt));
        profiler.measure("Game.afterPhysicsStep", () => {
          this.dispatch("afterPhysicsStep", tickDt);
          this.cleanupEntities();
        });

        this.contacts();
      }
    }

    this.lastAudioTime = audioNow;

    this.afterPhysics();

    this.render(renderDt);
  }

  /** Actually remove all the entities slated for removal from the game. */
  private cleanupEntities() {
    for (const entity of this.entitiesToRemove) {
      this.cleanupEntity(entity);
    }
    this.entitiesToRemove.clear();
  }

  private cleanupEntity(entity: Entity) {
    (entity as any).game = undefined; // This should be done by `removeEntity`, but better safe than sorry
    this.entities.remove(entity);

    if (entity.body) {
      this.world.bodies.remove(entity.body);
    }
    if (entity.bodies) {
      for (const body of entity.bodies) {
        this.world.bodies.remove(body);
      }
    }
    if (entity.springs) {
      for (const spring of entity.springs) {
        this.world.removeSpring(spring);
      }
    }
    if (entity.constraints) {
      for (const constraint of entity.constraints) {
        this.world.constraints.remove(constraint);
      }
    }

    if (entity.sprite) {
      this.renderer.removeSprite(entity.sprite);
      entity.sprite.destroy({ children: true });
    }
    if (entity.sprites) {
      for (const sprite of entity.sprites) {
        this.renderer.removeSprite(sprite);
        sprite.destroy({ children: true });
      }
    }

    if (entity.onDestroy) {
      entity.onDestroy({ game: this });
    }
  }

  /** Called before physics. */
  @profile
  private tick(dt: number, audioTime: number): void {
    this.ticknumber += 1;
    this.callHandlers("beforeTick", dt);

    const tickData: GameEventMap["tick"] = { dt, audioTime };
    for (const layer of TICK_LAYERS) {
      profiler.measure(`tick.${layer}`, () =>
        this.callHandlers(
          "tick",
          tickData,
          this.entities.getTickersOnLayer(layer),
        ),
      );
    }
  }

  /** Called before normal ticks */
  @profile
  private slowTick(dt: number) {
    this.callHandlers("slowTick", dt);
  }

  /** Called after physics. */
  private afterPhysics() {
    this.cleanupEntities();
    this.callHandlers("afterPhysics", undefined);
  }

  /** Called to render the current frame. */
  @profile
  private render(dt: number) {
    this.cleanupEntities();
    gpuProfiler.start("Game.render");
    const renderData: GameEventMap["render"] = { dt };
    // In the same layers as ticks, so each layer's rendering is timed as a
    // whole (by the GPU profiler too: some draw into textures as they go)
    for (const layer of TICK_LAYERS) {
      profiler.measure(`render.${layer}`, () =>
        gpuProfiler.measure(layer, () =>
          this.callHandlers(
            "render",
            renderData,
            this.entities.getRenderersOnLayer(layer),
          ),
        ),
      );
    }
    gpuProfiler.measure("lateRender", () =>
      this.callHandlers("lateRender", renderData),
    );
    profiler.measure("Game.draw", () =>
      gpuProfiler.measure("Game.draw", () => this.renderer.render()),
    );
    gpuProfiler.end();
  }

  /**
   * Like dispatch, for the per-frame events, which respect pause. When the
   * profiler wants entity detail, the time is attributed to each entity's
   * class.
   */
  private callHandlers<E extends keyof BaseGameEvents>(
    eventName: E,
    data: BaseGameEvents[E],
    entities: Iterable<Entity> = this.entities.getHandlers(eventName),
  ) {
    const paused = this.paused;
    const handlerName = eventHandlerName(eventName);
    if (profiler.entityDetail) {
      for (const entity of entities) {
        if (entity.isAdded && !(paused && entity.pausable)) {
          profiler.measure(entity.constructor.name, () =>
            (entity[handlerName] as (data: BaseGameEvents[E]) => void)(data),
          );
        }
      }
    } else {
      for (const entity of entities) {
        if (entity.isAdded && !(paused && entity.pausable)) {
          (entity[handlerName] as (data: BaseGameEvents[E]) => void)(data);
        }
      }
    }
  }

  // Handle beginning of collision between things.
  // Fired during narrowphase.
  private beginContact = (event: PhysicsEventMap["beginContact"]) => {
    this.contactList.beginContact(event);
    const { shapeA, shapeB, bodyA, bodyB, contactEquations } = event;
    const ownerA = shapeA.owner ?? bodyA.owner;
    const ownerB = shapeB.owner ?? bodyB.owner;

    // If either owner has been removed from the game, we shouldn't do the contact
    if (!wasRemoved(ownerA) && !wasRemoved(ownerB)) {
      if (ownerA?.onBeginContact) {
        ownerA.onBeginContact({
          other: ownerB,
          thisShape: shapeA,
          otherShape: shapeB,
          contactEquations,
        });
      }
      if (ownerB?.onBeginContact) {
        ownerB.onBeginContact({
          other: ownerA,
          thisShape: shapeB,
          otherShape: shapeA,
          contactEquations,
        });
      }
    }
  };

  // Handle end of collision between things.
  // Fired during narrowphase.
  private endContact = (event: PhysicsEventMap["endContact"]) => {
    this.contactList.endContact(event);
    const { shapeA, shapeB, bodyA, bodyB } = event;
    const ownerA = shapeA.owner ?? bodyA.owner;
    const ownerB = shapeB.owner ?? bodyB.owner;

    // If either owner has been removed from the game, we shouldn't do the contact
    if (!wasRemoved(ownerA) && !wasRemoved(ownerB)) {
      if (ownerA?.onEndContact) {
        ownerA.onEndContact({
          other: ownerB,
          thisShape: shapeA,
          otherShape: shapeB,
        });
      }
      if (ownerB?.onEndContact) {
        ownerB.onEndContact({
          other: ownerA,
          thisShape: shapeB,
          otherShape: shapeA,
        });
      }
    }
  };

  @profile
  private contacts() {
    for (const contact of this.contactList.getContacts()) {
      const { shapeA, shapeB, bodyA, bodyB } = contact;
      const ownerA = shapeA.owner ?? bodyA.owner;
      const ownerB = shapeB.owner ?? bodyB.owner;
      if (ownerA?.onContacting) {
        ownerA.onContacting({
          other: ownerB,
          otherShape: shapeB,
          thisShape: shapeA,
        });
      }
      if (ownerB?.onContacting) {
        ownerB.onContacting({
          other: ownerA,
          otherShape: shapeA,
          thisShape: shapeB,
        });
      }
    }
  }

  // Handle collision between things.
  // Fired after physics step.
  private impact = (event: PhysicsEventMap["impact"]) => {
    const ownerA = event.bodyA.owner;
    const ownerB = event.bodyB.owner;
    // If either owner has been removed from the game, we shouldn't do the contact
    if (!wasRemoved(ownerA) && !wasRemoved(ownerB)) {
      if (ownerA?.onImpact) {
        ownerA.onImpact({ other: ownerB });
      }
      if (ownerB?.onImpact) {
        ownerB.onImpact({ other: ownerA });
      }
    }
  };
}

/**
 * True if this is an entity that is no longer in the game. A body with no
 * owner (like a bare static wall) was never removed, so its contacts count.
 */
function wasRemoved(entity: Entity | undefined): boolean {
  return entity != undefined && !entity.isAdded;
}
