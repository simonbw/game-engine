// This file autogenerated by generate-asset-types.js
// Do not modify it by hand. Any changes will be overwritten.
const sounds = {
    snap: require("./audio/snap.flac")
};
export type SoundName = keyof typeof sounds;

const images = {
    faviconOld: require("./images/favicon-old.png")
};
export type ImageName = keyof typeof images;

const fonts = {
  
};
export type FontName = keyof typeof fonts;

const levels = {
  
};
export type LevelName = keyof typeof levels;

export const RESOURCES = { sounds, images, fonts };
