import * as THREE from 'three';
import { cfg } from '../config';
import { damp } from '../core/mathx';

/**
 * Chase camera, on Rocket League's own defaults: 110 degrees of field of view,
 * 270 behind, 110 up, tilted 4 degrees down.
 *
 * Yaw follows a blend of where the car points and where it is actually
 * travelling, which keeps the view stable through slides without feeling
 * detached. Ball cam swings round to frame car and ball together.
 */
export class ChaseCamera {
  ballCam = true;

  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly dir = new THREE.Vector3(1, 0, 0);
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private fov = cfg.camera.fov;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  toggleBallCam(): void {
    this.ballCam = !this.ballCam;
  }

  update(
    dt: number,
    carPos: { x: number; y: number; z: number },
    carVel: { x: number; y: number; z: number },
    carForward: THREE.Vector3,
    ballPos: { x: number; y: number; z: number },
  ): void {
    const c = cfg.camera;
    const speed = Math.hypot(carVel.x, carVel.y, carVel.z);
    const speedFrac = Math.min(1, speed / cfg.car.maxSpeed);
    const distance = c.distance + speedFrac * c.speedDistanceGain;

    if (this.ballCam) {
      // Sit on the line from the ball through the car, behind the car.
      this.dir.set(carPos.x - ballPos.x, 0, carPos.z - ballPos.z);
      if (this.dir.lengthSq() < 1e-4) this.dir.set(1, 0, 0);
      this.dir.normalize();

      this.desired.set(carPos.x, carPos.y, carPos.z).addScaledVector(this.dir, distance);
      this.desired.y += c.height;

      const k = c.ballCamStiffness;
      this.pos.set(
        damp(this.pos.x, this.desired.x, k, dt),
        damp(this.pos.y, Math.max(this.desired.y, 40), k, dt),
        damp(this.pos.z, this.desired.z, k, dt),
      );
      // Look at a point between car and ball, biased to the ball.
      this.tmp2.set(
        carPos.x + (ballPos.x - carPos.x) * 0.75,
        carPos.y + (ballPos.y - carPos.y) * 0.75,
        carPos.z + (ballPos.z - carPos.z) * 0.75,
      );
      this.look.set(
        damp(this.look.x, this.tmp2.x, k, dt),
        damp(this.look.y, this.tmp2.y, k, dt),
        damp(this.look.z, this.tmp2.z, k, dt),
      );
    } else {
      // Blend car heading with travel direction.
      const heading = this.dir.set(carForward.x, 0, carForward.z);
      if (heading.lengthSq() < 1e-6) heading.set(1, 0, 0);
      heading.normalize();
      const travel = this.tmp.set(carVel.x, 0, carVel.z);
      if (travel.lengthSq() > 10000) {
        travel.normalize();
        // Reversing should not whip the camera round to the front.
        if (travel.dot(heading) > 0) heading.lerp(travel, c.velocityBias).normalize();
      }

      this.desired.set(carPos.x, carPos.y, carPos.z).addScaledVector(heading, -distance);
      this.desired.y += c.height;

      const k = c.stiffness;
      this.pos.set(
        damp(this.pos.x, this.desired.x, k, dt),
        damp(this.pos.y, Math.max(this.desired.y, 40), k, dt),
        damp(this.pos.z, this.desired.z, k, dt),
      );

      // Look ahead of the car, and apply the downward tilt by dropping the
      // target rather than rotating the camera.
      const drop = Math.tan((-c.angle * Math.PI) / 180) * (distance + c.lookAhead);
      const target = this.tmp
        .set(carPos.x, carPos.y - drop, carPos.z)
        .addScaledVector(heading, c.lookAhead);
      this.look.set(
        damp(this.look.x, target.x, k, dt),
        damp(this.look.y, target.y, k, dt),
        damp(this.look.z, target.z, k, dt),
      );
    }

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    // Nudge field of view with speed, for a sense of acceleration.
    const targetFov = c.fov + speedFrac * c.speedFovGain;
    this.fov = damp(this.fov, targetFov, 4, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  snapTo(carPos: { x: number; y: number; z: number }, forward: THREE.Vector3): void {
    this.pos
      .set(carPos.x, carPos.y + cfg.camera.height, carPos.z)
      .addScaledVector(this.tmp.set(forward.x, 0, forward.z).normalize(), -cfg.camera.distance);
    this.look.set(carPos.x, carPos.y, carPos.z);
  }
}
