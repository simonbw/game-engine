import { MusicName, SoundName } from "../../../resources/resources";
import { getMusicBuffer } from "./music";

// Stores all loaded buffers
const buffers: Map<SoundName, AudioBuffer> = new Map();

// Whether or not a buffer has been loaded for a sound (or a piece of music,
// once `loadMusic` has it: music isn't preloaded)
export function hasSoundBuffer(name: SoundName | MusicName): boolean {
  return getSoundOrMusic(name) !== undefined;
}

// Get the buffer loaded for a sound (or loaded piece of music) or throw if none has been loaded
export function getSoundBuffer(name: SoundName | MusicName): AudioBuffer {
  const buffer = getSoundOrMusic(name);
  if (!buffer) {
    throw new Error(`Audio Buffer not loaded: ${name}`);
  }
  return buffer;
}

function getSoundOrMusic(name: SoundName | MusicName): AudioBuffer | undefined {
  return buffers.get(name as SoundName) ?? getMusicBuffer(name as MusicName);
}

export function getSoundDuration(name: SoundName): number {
  return buffers.get(name)?.duration ?? -1;
}

export function soundIsLoaded(name: SoundName) {
  return buffers.get(name) != undefined;
}

// Keeps track of filesizes, for figuring out how to optimize our asset loading
const fileSizes = new Map<string, number>();

/** Returns the total number of bytes we have loaded for all our audio files. */
export function getTotalSoundBytes() {
  return [...fileSizes.values()].reduce((sum, current) => sum + current, 0);
}

export function getBiggestSounds() {
  const entries = [...fileSizes.entries()];
  entries.sort(([url1, size1], [url2, size2]) => size2 - size1);
  return entries;
}

export function getSoundFileSize(url: SoundName): number {
  if (!fileSizes.has(url)) {
    throw new Error(`Sound not loaded: ${url}`);
  }
  return fileSizes.get(url)!;
}

export async function loadSound(
  name: SoundName,
  url: string,
  audioContext: AudioContext,
): Promise<AudioBuffer> {
  return fetch(url)
    .then((response) => {
      const bytes = Number(response.headers.get("Content-Length"));
      fileSizes.set(url, bytes);
      return response.arrayBuffer();
    })
    .then((data) => audioContext.decodeAudioData(data))
    .then((buffer) => {
      buffers.set(name, buffer);
      return buffer;
    });
}
