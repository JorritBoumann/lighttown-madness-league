import * as THREE from 'three';
import { cfg } from '../config';
import { damp } from '../core/mathx';

/**
 * Chase camera. Yaw follows a blend of where the car points and where it is
 * actually travelling, which keeps the view stable through slides without
 * feeling detached. Ball cam swings round to frame car and ball together.
 */
export class ChaseCamera {
  ballCam = false;

  private readonly pos = new THREE.Vector3(-20, 8, 0);
  private readonly look = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly dir = new THREE.Vector3(1, 0, 0);
  private readonly tmp = new THREE.Vector3();
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

    if (this.ballCam) {
      // Sit on the line from ball through car, behind the car.
      this.dir
        .set(carPos.x - ballPos.x, 0, carPos.z - ballPos.z)
        .normalize();
      if (this.dir.lengthSq() < 1e-6) this.dir.set(1, 0, 0);
      this.desired
        .set(carPos.x, carPos.y, carPos.z)
        .addScaledVector(this.dir, c.ballCamDistance);
      this.desired.y += c.ballCamHeight;
      const k = c.ballCamStiffness;
      this.pos.x = damp(this.pos.x, this.desired.x, k, dt);
      this.pos.y = damp(this.pos.y, this.desired.y, k, dt);
      this.pos.z = damp(this.pos.z, this.desired.z, k, dt);
      this.look.set(
        damp(this.look.x, ballPos.x, k, dt),
        damp(this.look.y, ballPos.y + 0.5, k, dt),
        damp(this.look.z, ballPos.z, k, dt),
      );
    } else {
      // Blend car heading with travel direction.
      const travel = this.tmp.set(carVel.x, 0, carVel.z);
      const heading = this.dir.set(carForward.x, 0, carForward.z);
      if (heading.lengthSq() < 1e-6) heading.set(1, 0, 0);
      heading.normalize();
      if (travel.lengthSq() > 4) {
        travel.normalize();
        // Reversing should not whip the camera round to the front.
        if (travel.dot(heading) > 0) {
          heading.lerp(travel, c.velocityBias).normalize();
        }
      }

      this.desired
        .set(carPos.x, carPos.y, carPos.z)
        .addScaledVector(heading, -c.distance);
      this.desired.y += c.height;

      const k = c.stiffness;
      this.pos.x = damp(this.pos.x, this.desired.x, k, dt);
      this.pos.y = damp(this.pos.y, Math.max(this.desired.y, 1.2), k, dt);
      this.pos.z = damp(this.pos.z, this.desired.z, k, dt);

      const lookTarget = this.tmp
        .set(carPos.x, carPos.y + c.lookHeight, carPos.z)
        .addScaledVector(heading, c.lookAhead);
      this.look.set(
        damp(this.look.x, lookTarget.x, k, dt),
        damp(this.look.y, lookTarget.y, k, dt),
        damp(this.look.z, lookTarget.z, k, dt),
      );
    }

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    // Nudge FOV with speed for a sense of acceleration.
    const targetFov = cfg.camera.fov + (speed / cfg.car.maxSpeed) * cfg.camera.speedFovGain;
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
