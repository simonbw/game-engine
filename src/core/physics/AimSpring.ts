import { Body, RotationalSpring } from "p2";
import { angleDelta } from "../../core/util/MathUtil";

export default class AimSpring extends RotationalSpring {
  constructor(bodyA: Body) {
    super(bodyA, null as any, {
      damping: 1,
      stiffness: 10,
      restAngle: 0,
    });
  }

  applyForce() {
    const body = this.bodyA;
    const displacement = angleDelta(this.restAngle, body.angle);

    var torque =
      -this.stiffness * displacement - this.damping * body.angularVelocity;

    body.angularForce += torque;
  }
}
