import * as Pixi from "pixi.js";
import type { VNode } from "preact";
import { SoundName } from "../../../resources/resources";
import { Game } from "../Game";
import { ReactEntity } from "../ReactEntity";
import { BaseEntity } from "../entity/BaseEntity";
import { Entity } from "../entity/Entity";
import { on } from "../entity/handler";
import { FontConfigMap, registerManifestFonts } from "./fonts";
import { registerMusic } from "./music";
import { getBiggestSounds, getTotalSoundBytes, loadSound } from "./sounds";

export type ResourceManifest = {
  images: { [name: string]: string };
  sounds: { [name: string]: string };
  fonts: { [name: string]: string };
  /** Not preloaded: registered for `loadMusic` (`music.ts`) to fetch when it's wanted */
  music?: { [name: string]: string };
};

const MAX_SOUNDS_LOADING_AT_ONCE = 16;

interface RenderInfo {
  fonts: { loaded: number; total: number };
  images: { loaded: number; total: number };
  sounds: { loaded: number; total: number };
}

/**
 * A React-enabled asset preloader that loads images, sounds, and fonts
 * with progress tracking. Provides real-time loading feedback through
 * React UI components and resolves when all assets are ready.
 *
 * Fonts load first, on their own, so the loading screen can use them; then
 * images and sounds load together.
 */
export class ReactPreloader extends BaseEntity implements Entity {
  private _resolve!: () => void;
  private _promise!: Promise<void>;

  private progress: RenderInfo = {
    fonts: {
      loaded: 0,
      total: 0,
    },
    images: {
      loaded: 0,
      total: 0,
    },
    sounds: {
      loaded: 0,
      total: 0,
    },
  };

  constructor(
    private manifest: ResourceManifest,
    reactRender: (props: RenderInfo) => VNode,
    private options: {
      /** Family/weight/style overrides for manifest fonts. See `registerManifestFonts`. */
      fontConfigs?: FontConfigMap;
    } = {},
  ) {
    super();
    registerMusic(manifest.music ?? {});

    this._promise = new Promise((resolve) => {
      this._resolve = resolve;
    });

    this.addChild(new ReactEntity(() => reactRender(this.progress)));
  }

  @on("add")
  async onAdd({ game }: { game: Game }) {
    // Fonts first, on their own, so that a loading screen can be drawn in
    // the game's fonts while images and sounds load together
    await this.loadFonts();
    await Promise.all([this.loadImages(), this.loadSounds(game.audio)]);
    const bytes = getTotalSoundBytes();

    console.groupCollapsed(
      `Audio Loaded: ${(bytes / 2 ** 20).toFixed(1)}MB total`,
    );

    getBiggestSounds()
      .slice(0, 5)
      .forEach(([url, size]) =>
        console.info(url, "\n", `${(size / 1024).toFixed(1)}kB`),
      );

    console.groupEnd();
    this._resolve();
  }

  waitTillLoaded() {
    return this._promise;
  }

  async loadFonts() {
    this.progress.fonts.total = Object.values(this.manifest.fonts).length;
    this.progress.fonts.loaded = 0;

    try {
      await registerManifestFonts(this.manifest.fonts, {
        fontConfigs: this.options.fontConfigs,
        onFontLoaded: () => {
          this.progress.fonts.loaded += 1;
        },
      });
    } catch (e) {
      console.error("Fonts failed to load", e);
    }
  }

  async loadSounds(audioContext: AudioContext) {
    this.progress.sounds.loaded = 0;
    this.progress.sounds.total = Object.values(this.manifest.sounds).length;

    // Requesting every sound at once fills the browser's request queue, and
    // images, which are requested after, wait until the last sound is in. A
    // few at a time leaves room for images to load alongside.
    const queue = Object.entries(this.manifest.sounds);
    const loadNext = async (): Promise<void> => {
      const next = queue.shift();
      if (!next) {
        return;
      }
      const [name, url] = next;
      try {
        await loadSound(name as SoundName, url, audioContext);
      } catch (e) {
        console.warn(`Sound failed to load: ${url}`, e);
      }
      this.progress.sounds.loaded += 1;
      return loadNext();
    };
    await Promise.all(
      Array.from({ length: MAX_SOUNDS_LOADING_AT_ONCE }, () => loadNext()),
    );
  }

  async loadImages() {
    this.progress.images.loaded = 0;
    this.progress.images.total = Object.values(this.manifest.images).length;

    await Promise.all(
      Object.entries(this.manifest.images).map(async ([name, url]) => {
        try {
          await Pixi.Assets.load({ alias: name, src: url });
        } catch (e) {
          console.warn(`Image failed to load: ${url}`, e);
        }
        this.progress.images.loaded += 1;
      }),
    );
  }

  @on("destroy")
  onDestroy() {
    document.getElementById("preloader")?.remove();
  }
}
