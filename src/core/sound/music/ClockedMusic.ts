/**
 * Music played on the audio clock, for switching in time: `ClockedLoop` is a
 * looping piece made of layers that start together, sample-accurately, and
 * can be turned up and down; `ClockedOneShot` is a sound started at a time
 * (a transition, a stinger). Both play into any node, stop at a time with a
 * short fade (so nothing clicks), or fade out. Nothing here knows about the
 * game: no pausing, no slow motion. Times are seconds on `audio.currentTime`'s
 * clock; a time that's already gone means now.
 */

/** Seconds of fade on anything cut, so it doesn't click */
export const CUT_FADE = 0.03;

/** Something playing on the clock */
abstract class ClockedSound {
  /** The whole thing's level, on its way to the destination */
  readonly output: GainNode;
  /** When it stops (or has), if it's been told to */
  stopTime?: number;
  protected sources: AudioBufferSourceNode[] = [];

  constructor(
    protected readonly audio: BaseAudioContext,
    destination: AudioNode,
    /** When it starts */
    readonly startTime: number,
    readonly gain: number,
  ) {
    this.output = audio.createGain();
    this.output.gain.value = gain;
    this.output.connect(destination);
  }

  /** Whether it's stopped by now */
  get ended(): boolean {
    return (
      this.stopTime !== undefined && this.audio.currentTime >= this.stopTime
    );
  }

  /** Stops at `time`, fading out over `fade` seconds up to it */
  stopAt(time: number, fade = CUT_FADE) {
    this.fadeOut(time - fade, fade);
  }

  /** Fades out over `seconds` from `from`, and stops */
  fadeOut(from: number, seconds: number) {
    const now = this.audio.currentTime;
    from = Math.max(from, now);
    const to = from + Math.max(seconds, 0.005);
    if (this.stopTime !== undefined && this.stopTime <= to) {
      return;
    }
    const gain = this.output.gain;
    holdAt(gain, from);
    gain.linearRampToValueAtTime(0, to);
    for (const source of this.sources) {
      source.stop(to);
    }
    this.stopTime = to;
  }

  /** Stops it now and lets go of its nodes */
  dispose() {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped
      }
      source.disconnect();
    }
    this.sources = [];
    this.output.disconnect();
  }

  protected makeSource(buffer: AudioBuffer): AudioBufferSourceNode {
    const source = this.audio.createBufferSource();
    source.buffer = buffer;
    this.sources.push(source);
    return source;
  }
}

/** A layer of a looping piece: its audio and how loud it starts */
export interface LoopLayer {
  buffer: AudioBuffer;
  gain: number;
}

/**
 * A looping piece, its layers all started at `startTime` and looping every
 * `loopLength` seconds (the piece's exact length, which `loopEnd` is set to,
 * so a codec's padding at the end of a file never makes a gap). Each layer
 * has its own gain, ramped by `setLayerGain`.
 */
export class ClockedLoop extends ClockedSound {
  private layerGains: GainNode[] = [];

  constructor(
    audio: BaseAudioContext,
    destination: AudioNode,
    layers: readonly LoopLayer[],
    readonly loopLength: number,
    startTime: number,
    gain = 1,
  ) {
    super(audio, destination, Math.max(startTime, audio.currentTime), gain);
    for (const layer of layers) {
      const layerGain = audio.createGain();
      layerGain.gain.value = layer.gain;
      layerGain.connect(this.output);
      this.layerGains.push(layerGain);
      const source = this.makeSource(layer.buffer);
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = Math.min(loopLength, layer.buffer.duration);
      source.connect(layerGain);
      source.start(this.startTime);
    }
  }

  /** Ramps layer `index` to `gain` over `seconds`, from `from` (now, by default) */
  setLayerGain(index: number, gain: number, seconds: number, from?: number) {
    const param = this.layerGains[index]?.gain;
    if (!param) {
      return;
    }
    const start = Math.max(from ?? 0, this.audio.currentTime);
    holdAt(param, start);
    param.linearRampToValueAtTime(gain, start + Math.max(seconds, 0.005));
  }
}

/** A sound that plays once from `startTime` (a transition, an ending) */
export class ClockedOneShot extends ClockedSound {
  /** When it'll have played to its end */
  readonly endTime: number;

  constructor(
    audio: BaseAudioContext,
    destination: AudioNode,
    buffer: AudioBuffer,
    startTime: number,
    gain = 1,
  ) {
    super(audio, destination, Math.max(startTime, audio.currentTime), gain);
    const source = this.makeSource(buffer);
    source.connect(this.output);
    source.start(this.startTime);
    this.endTime = this.startTime + buffer.duration;
  }

  get ended(): boolean {
    return super.ended || this.audio.currentTime >= this.endTime;
  }
}

/**
 * Holds `param` at whatever it is at `time`, dropping anything scheduled
 * after, so a new ramp can start there without a jump
 */
function holdAt(param: AudioParam, time: number) {
  if (typeof param.cancelAndHoldAtTime === "function") {
    param.cancelAndHoldAtTime(time);
  } else {
    // Firefox: near enough, for a ramp that starts now
    const value = param.value;
    param.cancelScheduledValues(time);
    param.setValueAtTime(value, time);
  }
}
