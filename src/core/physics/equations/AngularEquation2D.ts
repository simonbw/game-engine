/**
 * Shape-specialized 2-body equation for **pure 2D rotational** constraints —
 * no linear contribution. The Jacobian has the shape:
 *
 *   G = [ 0, 0, angAz,   0, 0, angBz ]
 *        └── A ──────┘ └── B ──────┘
 *
 * This is **not antisymmetric** — the two angular scalars are stored
 * independently so we can represent gear-ratio style coupling (e.g.
 * `angAz = ratio`, `angBz = -1`).
 *
 * ## Storage
 *
 * Two floats in named fields:
 *   - `angAz` — body A angular contribution
 *   - `angBz` — body B angular contribution
 *
 * ## When to use
 *
 * 2D angular constraints between two rigid bodies. Used by:
 *   - {@link RotationalLockEquation} — hard-limit on relative angle
 *   - {@link AngleLockEquation} — hinge limit with optional gear ratio
 *   - {@link RotationalVelocityEquation} — motor that drives a target angular velocity
 */
import type { Body } from "../body/Body";
import { EQ_INDEX_A, EQ_INDEX_B } from "../internal";
import type { SolverWorkspace } from "../solver/SolverWorkspace";
import { Equation } from "./Equation";

export class AngularEquation2D extends Equation {
  /** Body A angular contribution. */
  angAz: number = 0;

  /** Body B angular contribution. */
  angBz: number = 0;

  constructor(
    bodyA: Body,
    bodyB: Body,
    minForce = -Number.MAX_VALUE,
    maxForce = Number.MAX_VALUE,
  ) {
    super(bodyA, bodyB, minForce, maxForce);
  }

  /** Position error. Owning constraints set `offset` each substep. */
  override computeGq(): number {
    return this.offset;
  }

  override computeGW(): number {
    return (
      this.angAz * this.bodyA.angularVelocity +
      this.angBz * this.bodyB.angularVelocity +
      this.relativeVelocity
    );
  }

  override computeGWlambda(ws: SolverWorkspace): number {
    const wl = ws.wlambda;
    return (
      this.angAz * wl[this[EQ_INDEX_A]] + this.angBz * wl[this[EQ_INDEX_B]]
    );
  }

  override computeGiMf(ws: SolverWorkspace): number {
    const idxA = this[EQ_INDEX_A];
    const idxB = this[EQ_INDEX_B];
    return (
      this.angAz * this.bodyA.angularForce * ws.invInertia[idxA] +
      this.angBz * this.bodyB.angularForce * ws.invInertia[idxB]
    );
  }

  override computeGiMGt(ws: SolverWorkspace): number {
    const idxA = this[EQ_INDEX_A];
    const idxB = this[EQ_INDEX_B];
    return (
      this.angAz * this.angAz * ws.invInertia[idxA] +
      this.angBz * this.angBz * ws.invInertia[idxB]
    );
  }

  override addToWlambda(deltalambda: number, ws: SolverWorkspace): this {
    const idxA = this[EQ_INDEX_A];
    const idxB = this[EQ_INDEX_B];
    const wl = ws.wlambda;
    wl[idxA] += ws.invInertia[idxA] * this.angAz * deltalambda;
    wl[idxB] += ws.invInertia[idxB] * this.angBz * deltalambda;
    return this;
  }
}
