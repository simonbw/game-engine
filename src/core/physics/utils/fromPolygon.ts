import * as decomp from "poly-decomp";
import { V, V2d } from "../../Vector";
import type { Body } from "../body/Body";
import { Convex } from "../shapes/Convex";

export interface FromPolygonOptions {
  /** Use the slower optimal decomposition instead of the fast quickDecomp. */
  optimalDecomp?: boolean;
  /** Skip the self-intersection check. */
  skipSimpleCheck?: boolean;
  /**
   * Threshold angle (radians) for removing collinear points before
   * decomposition. `false` (default) leaves the path untouched.
   */
  removeCollinearPoints?: number | false;
}

/**
 * Decompose a (possibly concave) closed polygon into convex pieces and add
 * one `Convex` shape per piece to `body`. Any existing shapes are kept.
 *
 * Mirrors p2's `Body.prototype.fromPolygon`: each convex piece is
 * re-centered on its own centroid before being added at that centroid as
 * the shape offset, and then `body.adjustCenterOfMass()` shifts the whole
 * body so its origin sits at the polygon's area centroid. The original
 * outline (in the adjusted body frame) is stored on `body.concavePath`.
 *
 * @param body - The body to add shapes to.
 * @param path - Polygon vertices in body-local coordinates. Winding does not
 *   matter; the path is made counter-clockwise internally.
 * @returns `true` on success, `false` if the path was rejected (e.g. it
 *   self-intersects and `skipSimpleCheck` was not set).
 */
export function fromPolygon(
  body: Body,
  path: readonly (V2d | [number, number])[],
  options: FromPolygonOptions = {},
): boolean {
  const polygon: decomp.Polygon = path.map((p) => [p[0], p[1]]);

  decomp.makeCCW(polygon);

  if (typeof options.removeCollinearPoints === "number") {
    decomp.removeCollinearPoints(polygon, options.removeCollinearPoints);
  }

  if (!options.skipSimpleCheck && !decomp.isSimple(polygon)) {
    return false;
  }

  body.concavePath = polygon.map((p) => V(p[0], p[1]));

  const convexes = options.optimalDecomp
    ? decomp.decomp(polygon)
    : decomp.quickDecomp(polygon);
  if (!convexes) {
    return false;
  }

  for (let i = 0; i < convexes.length; i++) {
    const c = new Convex({ vertices: convexes[i] });

    // Shift the piece's vertices so its centroid is at its local origin,
    // then add it with that centroid as the offset on the body.
    const cm = V(c.centerOfMass);
    for (let j = 0; j < c.vertices.length; j++) {
      c.vertices[j].isub(cm);
    }
    c.updateTriangles();
    c.updateCenterOfMass();
    c.updateBoundingRadius();

    body.addShape(c, cm);
  }

  body.adjustCenterOfMass();
  body.aabbNeedsUpdate = true;

  return true;
}
