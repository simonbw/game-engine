// TypeScript's DOM types are missing FontFaceSet.add()
declare global {
  interface FontFaceSet {
    add(font: FontFace): void;
  }
}

export type FontManifest = {
  [name: string]: string;
};

/** How a manifest font should be registered with the browser. */
export interface FontConfig {
  /** The CSS `font-family` name. Defaults to the manifest key. */
  family: string;
  /**
   * Weight/style descriptors. Variable fonts can declare a weight range such
   * as `"300 700"` so CSS picks the right cut for any `font-weight`.
   * Defaults to `{ style: "normal", weight: "400" }`.
   */
  descriptors?: FontFaceDescriptors;
}

/** Maps manifest font names to how they should be registered. */
export type FontConfigMap = { [manifestName: string]: FontConfig };

const DEFAULT_DESCRIPTORS: FontFaceDescriptors = {
  style: "normal",
  weight: "400",
};

/**
 * Register every font in a manifest with `document.fonts`.
 *
 * Without a config map every font is registered under its manifest name at
 * weight 400. Pass `fontConfigs` to group several files under one family
 * with different weights/styles (e.g. `spectralLight` and `spectralBold`
 * both as family "Spectral").
 */
export async function registerManifestFonts(
  manifest: FontManifest,
  {
    fontConfigs = {},
    onFontLoaded,
  }: { fontConfigs?: FontConfigMap; onFontLoaded?: () => void } = {},
): Promise<void> {
  await Promise.all(
    Object.entries(manifest).map(async ([name, src]) => {
      const config = fontConfigs[name];
      const family = config?.family ?? name;
      const descriptors = config?.descriptors ?? DEFAULT_DESCRIPTORS;
      const fontFace = new FontFace(family, `url(${src})`, descriptors);
      document.fonts.add(await fontFace.load());
      onFontLoaded?.();
    }),
  );
}
