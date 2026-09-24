/**
 * Minimal typings for `poly-decomp@0.3.0`, which ships no bundled types.
 * Only the functional API used by `fromPolygon` is declared.
 */
declare module "poly-decomp" {
  export type Point = [number, number];
  export type Polygon = Point[];

  /** Ensure counter-clockwise winding (mutates). Returns true if reversed. */
  export function makeCCW(polygon: Polygon): boolean;
  /** True if no two edges of the polygon intersect. */
  export function isSimple(polygon: Polygon): boolean;
  /** Remove collinear points (mutates). Returns the number removed. */
  export function removeCollinearPoints(
    polygon: Polygon,
    precision?: number,
  ): number;
  /** Remove duplicate points (mutates). */
  export function removeDuplicatePoints(
    polygon: Polygon,
    precision?: number,
  ): void;
  /** Optimal (slow) convex decomposition. */
  export function decomp(polygon: Polygon): Polygon[] | false;
  /** Fast (Bayazit) convex decomposition. */
  export function quickDecomp(polygon: Polygon): Polygon[];
}
