import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  createPersistedState,
  setPersistedStateNamespace,
} from "../../src/core/state/PersistedState";

// Node has no localStorage, so give it a Map-backed one
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
  },
});

function volumeSetting() {
  return createPersistedState<number>({
    key: "masterVolume",
    default: 1,
    deserialize: Number,
  });
}

beforeEach(() => store.clear());

test("settings are saved under the namespace", () => {
  setPersistedStateNamespace("a:setting:");
  volumeSetting().set(0.5);
  assert.equal(store.get("a:setting:masterVolume"), "0.5");
  setPersistedStateNamespace("b:setting:");
  assert.equal(volumeSetting().get(), 1);
});

test("a bare key from another game is left alone by default", () => {
  store.set("masterVolume", "0");
  setPersistedStateNamespace("new-game:setting:");
  assert.equal(volumeSetting().get(), 1);
  assert.equal(store.get("masterVolume"), "0");
  assert.equal(store.has("new-game:setting:masterVolume"), false);
});

test("migrateLegacyKeys moves a bare key into the namespace", () => {
  store.set("masterVolume", "0.25");
  setPersistedStateNamespace("old-game:setting:", { migrateLegacyKeys: true });
  assert.equal(volumeSetting().get(), 0.25);
  assert.equal(store.get("old-game:setting:masterVolume"), "0.25");
  assert.equal(store.has("masterVolume"), false);
});

test("migrateLegacyKeys keeps a namespaced value over a bare one", () => {
  store.set("masterVolume", "0.25");
  store.set("old-game:setting:masterVolume", "0.75");
  setPersistedStateNamespace("old-game:setting:", { migrateLegacyKeys: true });
  assert.equal(volumeSetting().get(), 0.75);
  assert.equal(store.get("masterVolume"), "0.25");
});
