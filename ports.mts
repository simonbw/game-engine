/**
 * The ports this game's dev servers use. Every game made from this template
 * should pick its own three, because two games on the same ports can't run at
 * once, and share one localStorage (it's kept per origin, and the port is part
 * of the origin).
 */
export const PORTS = {
  /** `npm start`. The `PORT` environment variable overrides it */
  dev: 1234,
  /** `npm run electron`'s dev server, so it can run next to `npm start` */
  electron: 1236,
  /** The dev server the browser tests start. `TEST_PORT` overrides it */
  test: 3466,
};
