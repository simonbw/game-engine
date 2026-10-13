import { MusicName } from "../../../resources/resources";

/**
 * Music, loaded when it's wanted rather than preloaded: decoded, a minute of
 * stereo is about 21 MB, so only what's playing and what's likely next is
 * kept. `loadMusic` fetches and decodes a piece (once, however often it's
 * asked for), `getMusicBuffer` has it once it's in, and `keepOnlyMusic` lets go
 * of the rest (anything still playing it keeps its buffer until it stops).
 *
 * The URLs come from the manifest's `music` (registered by the preloader).
 */

const urls = new Map<MusicName, string>();
const buffers = new Map<MusicName, AudioBuffer>();
const loading = new Map<MusicName, Promise<AudioBuffer>>();

/** Where each piece of music is, from the manifest */
export function registerMusic(manifest: { [name: string]: string }) {
  for (const [name, url] of Object.entries(manifest)) {
    urls.set(name as MusicName, url);
  }
}

/** The piece, decoded, if it's loaded */
export function getMusicBuffer(name: MusicName): AudioBuffer | undefined {
  return buffers.get(name);
}

export function isMusicLoaded(name: MusicName): boolean {
  return buffers.has(name);
}

/** Every piece that's loaded or loading */
export function musicInMemory(): MusicName[] {
  return [...new Set([...buffers.keys(), ...loading.keys()])];
}

/**
 * Fetches and decodes a piece, or gives the one already loaded or loading.
 * Rejects if it can't be loaded (and forgets it, so it can be tried again).
 */
export function loadMusic(
  name: MusicName,
  audio: BaseAudioContext,
): Promise<AudioBuffer> {
  const loaded = buffers.get(name);
  if (loaded) {
    return Promise.resolve(loaded);
  }
  const pending = loading.get(name);
  if (pending) {
    return pending;
  }
  const url = urls.get(name);
  if (!url) {
    return Promise.reject(new Error(`No music called ${name}`));
  }
  const promise = fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response.arrayBuffer();
    })
    .then((data) => audio.decodeAudioData(data))
    .then(
      (buffer) => {
        // Unless it was let go of while it loaded
        if (loading.get(name) === promise) {
          buffers.set(name, buffer);
          loading.delete(name);
        }
        return buffer;
      },
      (error) => {
        if (loading.get(name) === promise) {
          loading.delete(name);
        }
        throw error;
      },
    );
  loading.set(name, promise);
  return promise;
}

/** Lets go of every piece but `keep` (loaded or still loading) */
export function keepOnlyMusic(keep: Iterable<MusicName>) {
  const kept = new Set(keep);
  for (const name of [...buffers.keys()]) {
    if (!kept.has(name)) {
      buffers.delete(name);
    }
  }
  for (const name of [...loading.keys()]) {
    if (!kept.has(name)) {
      loading.delete(name);
    }
  }
}
