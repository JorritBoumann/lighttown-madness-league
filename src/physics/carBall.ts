import * as THREE from 'three';
import { cfg } from '../config';
import { Curve } from '../core/curve';
import type { Car } from './car';
import type { Ball } from './ball';

/**
 * Extra impulse on a car-ball touch.
 *
 * Rocket League does not treat this as an ordinary rigid-body collision: the
 * bounce depends on how fast the two are closing, and it gets *softer* at pace
 * so a quick touch drives through the ball instead of pinging off it. Rapier
 * resolves the contact with a fixed restitution, so this tops the result up
 * toward the curve.
 */
export class CarBallInteraction {
  private curve: Curve;
  private readonly normal = new THREE.Vector3();

  constructor() {
    this.curve = new Curve(cfg.ball.carRestitutionCurve);
  }

  syncConfig(): void {
    this.curve = new Curve(cfg.ball.carRestitutionCurve);
  }

  /** Call on the step a car collider starts touching the ball collider. */
  apply(car: Car, ball: Ball): void {
    const cp = car.position;
    const bp = ball.position;
    // Car centre to ball centre stands in for the contact normal; for a box
    // against a sphere this size the difference does not read.
    this.normal.set(bp.x - cp.x, bp.y - cp.y, bp.z - cp.z);
    if (this.normal.lengthSq() < 1e-6) return;
    this.normal.normalize();

    const cv = car.velocity;
    const bv = ball.velocity;
    const closing =
      (cv.x - bv.x) * this.normal.x +
      (cv.y - bv.y) * this.normal.y +
      (cv.z - bv.z) * this.normal.z;
    if (closing <= 0) return; // moving apart already

    const restitution = this.curve.at(closing);
    // Rapier has already resolved some of the bounce; add the remainder.
    const extra = closing * restitution;
    const j = extra * cfg.ball.mass;
    ball.body.applyImpulse(
      { x: this.normal.x * j, y: this.normal.y * j, z: this.normal.z * j },
      true,
    );
  }
}
