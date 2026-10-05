import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FORWARD, UP, RIGHT } from '../src/core/axes';

/**
 * Which way is right.
 *
 * This existed as a comment in `core/axes.ts` claiming the driver's right was
 * (0, 0, -1), and it was wrong: pressing right steered the car left. Nothing
 * caught it because it was wrong in pairs — the bots measured their target
 * against a mirrored right and fed the answer to a mirrored steering sign, so
 * they drove correctly and only a human could feel it.
 *
 * So this file checks the convention the way a player experiences it, by
 * projecting through a camera, rather than by restating the cross product the
 * code already got backwards once.
 */
describe('which way is right', () => {
  /** Screen x of a world point, through a camera sitting behind the car. */
  function onScreen(point: THREE.Vector3): number {
    const camera = new THREE.PerspectiveCamera(90, 1.6, 10, 40000);
    // Behind a car at the origin whose nose is +x and roof is +y.
    camera.position.set(-400, 110, 0);
    camera.up.copy(UP);
    camera.lookAt(0, 40, 0);
    camera.updateMatrixWorld(true);
    return point.clone().project(camera).x;
  }

  it('puts RIGHT on the right of the screen', () => {
    // The whole bug in one line. From behind the car, the point the code calls
    // "right" has to appear on the right.
    expect(onScreen(RIGHT.clone().multiplyScalar(300).setY(40))).toBeGreaterThan(0);
    expect(onScreen(RIGHT.clone().multiplyScalar(-300).setY(40))).toBeLessThan(0);
  });

  it('agrees with forward cross up', () => {
    const derived = new THREE.Vector3().crossVectors(FORWARD, UP);
    expect(derived.distanceTo(RIGHT)).toBeLessThan(1e-9);
  });

  it('is a right-handed basis', () => {
    // forward, up and right have to be mutually perpendicular and consistent,
    // or something built from two of them disagrees with the third.
    expect(FORWARD.dot(UP)).toBeCloseTo(0);
    expect(FORWARD.dot(RIGHT)).toBeCloseTo(0);
    expect(UP.dot(RIGHT)).toBeCloseTo(0);
    expect(new THREE.Vector3().crossVectors(UP, RIGHT).distanceTo(FORWARD)).toBeLessThan(1e-9);
  });
});
