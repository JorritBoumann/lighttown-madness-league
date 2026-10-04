import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { cfg } from '../src/config';
import { pointNoseAt, aerialCost, type AerialGains } from '../src/ai/aerial';
import { FORWARD, UP, RIGHT } from '../src/core/axes';
import { initPhysics, PhysicsWorld } from '../src/physics/world';
import { createArena } from '../src/physics/arena';
import { Car } from '../src/physics/car';
import { emptyInput } from '../src/input/types';

/**
 * Air orientation. Signs are where this sort of controller goes wrong, so each
 * axis is checked against the car's own conventions: positive pitch is nose
 * down, positive yaw is nose right, positive roll is roll right.
 *
 * The last group closes the loop by flying a real car at a target, which is the
 * only way to catch a sign that is consistent with itself but inverted against
 * the physics.
 */

const GAINS: AerialGains = {
  p: 2.4,
  d: 0.42,
  rollP: 2.2,
  rollD: 0.38,
  pitchAccel: cfg.car.airPitchAccel,
  yawAccel: cfg.car.airYawAccel,
  rollAccel: cfg.car.airRollAccel,
  maxRate: cfg.car.maxAngularSpeed,
};
const still = new THREE.Vector3(0, 0, 0);

/** An upright car's basis. */
const basis = () => ({
  fwd: FORWARD.clone(),
  up: UP.clone(),
  right: RIGHT.clone(),
});

describe('aiming', () => {
  it('asks for nose up when the target is above', () => {
    const b = basis();
    const out = pointNoseAt(new THREE.Vector3(1, 1, 0), b.fwd, b.up, b.right, still, GAINS);
    // Positive pitch is nose down, so wanting to look up is negative.
    expect(out.pitch).toBeLessThan(0);
  });

  it('asks for nose down when the target is below', () => {
    const b = basis();
    const out = pointNoseAt(new THREE.Vector3(1, -1, 0), b.fwd, b.up, b.right, still, GAINS);
    expect(out.pitch).toBeGreaterThan(0);
  });

  it('yaws toward a target off to one side', () => {
    const b = basis();
    // RIGHT is -z, so a target at -z is to the car's right.
    const toRight = pointNoseAt(new THREE.Vector3(1, 0, -1), b.fwd, b.up, b.right, still, GAINS);
    expect(toRight.steer).toBeGreaterThan(0);
    const toLeft = pointNoseAt(new THREE.Vector3(1, 0, 1), b.fwd, b.up, b.right, still, GAINS);
    expect(toLeft.steer).toBeLessThan(0);
  });

  it('does nothing when already pointing at the target', () => {
    const b = basis();
    const out = pointNoseAt(FORWARD.clone(), b.fwd, b.up, b.right, still, GAINS);
    expect(Math.abs(out.pitch)).toBeLessThan(0.01);
    expect(Math.abs(out.steer)).toBeLessThan(0.01);
    expect(out.error).toBeLessThan(0.01);
  });

  it('reports how far off the nose is', () => {
    const b = basis();
    const behind = pointNoseAt(new THREE.Vector3(-1, 0, 0), b.fwd, b.up, b.right, still, GAINS);
    expect(behind.error).toBeGreaterThan(3);
    const square = pointNoseAt(new THREE.Vector3(0, 1, 0), b.fwd, b.up, b.right, still, GAINS);
    expect(square.error).toBeCloseTo(Math.PI / 2, 1);
  });

  it('still turns the right way for a target behind it', () => {
    const b = basis();
    // Behind and above: it should not give up or pick the long way round.
    const out = pointNoseAt(new THREE.Vector3(-1, 0.4, 0), b.fwd, b.up, b.right, still, GAINS);
    expect(out.pitch).toBeLessThan(0);
    expect(Math.abs(out.pitch)).toBeGreaterThan(0.1);
  });

  it('treats a zero direction as nothing to do, rather than dividing by it', () => {
    const b = basis();
    const out = pointNoseAt(new THREE.Vector3(0, 0, 0), b.fwd, b.up, b.right, still, GAINS);
    expect(out.pitch).toBe(0);
    expect(out.steer).toBe(0);
    expect(out.roll).toBe(0);
  });

  it('clamps to the range an input can actually be', () => {
    const b = basis();
    const out = pointNoseAt(new THREE.Vector3(-1, 1, 0), b.fwd, b.up, b.right, still, GAINS);
    for (const v of [out.pitch, out.steer, out.roll]) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('levelling', () => {
  it('leaves an upright car alone', () => {
    const b = basis();
    const out = pointNoseAt(FORWARD.clone(), b.fwd, b.up, b.right, still, GAINS);
    expect(Math.abs(out.roll)).toBeLessThan(0.01);
  });

  it('rolls back the way it came when banked', () => {
    // Rolled right by 45 degrees: rotation about the nose by -45.
    const q = new THREE.Quaternion().setFromAxisAngle(FORWARD, -Math.PI / 4);
    const up = UP.clone().applyQuaternion(q);
    const right = RIGHT.clone().applyQuaternion(q);
    const rolledRight = pointNoseAt(FORWARD.clone(), FORWARD.clone(), up, right, still, GAINS);
    // Banked right, so the correction is a roll left.
    expect(rolledRight.roll).toBeLessThan(0);

    const q2 = new THREE.Quaternion().setFromAxisAngle(FORWARD, Math.PI / 4);
    const up2 = UP.clone().applyQuaternion(q2);
    const right2 = RIGHT.clone().applyQuaternion(q2);
    expect(pointNoseAt(FORWARD.clone(), FORWARD.clone(), up2, right2, still, GAINS).roll).toBeGreaterThan(0);
  });
});

describe('damping', () => {
  // A small error, so the proportional term is not already at full deflection
  // and the damping has somewhere to show.
  const SMALL = new THREE.Vector3(1, 0.1, 0);

  it('backs off when already turning toward the target', () => {
    const b = basis();
    const cold = pointNoseAt(SMALL, b.fwd, b.up, b.right, still, GAINS);
    expect(Math.abs(cold.pitch)).toBeLessThan(1); // not saturated
    // Already pitching nose up: negative spin about the car's right.
    const spinning = new THREE.Vector3().copy(RIGHT).multiplyScalar(-0.4);
    const warm = pointNoseAt(SMALL, b.fwd, b.up, b.right, spinning, GAINS);
    expect(Math.abs(warm.pitch)).toBeLessThan(Math.abs(cold.pitch));
  });

  it('pushes harder when turning away from the target', () => {
    const b = basis();
    const cold = pointNoseAt(SMALL, b.fwd, b.up, b.right, still, GAINS);
    const wrongWay = new THREE.Vector3().copy(RIGHT).multiplyScalar(0.4);
    const warm = pointNoseAt(SMALL, b.fwd, b.up, b.right, wrongWay, GAINS);
    expect(Math.abs(warm.pitch)).toBeGreaterThan(Math.abs(cold.pitch));
  });
});

describe('whether an aerial is worth starting', () => {
  const base = {
    distance: 1500,
    climb: 600,
    time: 1.4,
    speed: 1200,
    gravity: 650,
    boostAccel: 991.667,
    jumpSpeed: 580,
  };

  it('takes a reachable ball', () => {
    expect(aerialCost(base)).not.toBe(null);
  });

  it('refuses one that is too high for the boost available', () => {
    expect(aerialCost({ ...base, climb: 6000, time: 1.2 })).toBe(null);
  });

  it('refuses one that is too far away in the time', () => {
    expect(aerialCost({ ...base, distance: 12000 })).toBe(null);
  });

  it('refuses one that is already happening', () => {
    expect(aerialCost({ ...base, time: 0.05 })).toBe(null);
  });

  it('charges more for a higher ball', () => {
    const low = aerialCost({ ...base, climb: 300 })!;
    const high = aerialCost({ ...base, climb: 900 })!;
    expect(high).toBeGreaterThan(low);
  });

  it('charges nothing extra for a ball the car is already arriving at', () => {
    const coasting = aerialCost({ ...base, climb: 0, distance: 1200, speed: 1200, time: 1 })!;
    expect(coasting).toBeLessThan(0.2);
  });
});

describe('flying a real car', () => {
  let phys: PhysicsWorld;

  beforeAll(async () => {
    await initPhysics();
  });

  /**
   * Closes the loop: a sign that is self-consistent but inverted against the
   * physics passes every test above and fails this one.
   */
  function flyAt(direction: THREE.Vector3, seconds = 1.2): number {
    phys = new PhysicsWorld();
    createArena(phys);
    const car = new Car(phys, { x: 0, y: 1200, z: 0 }, 0, 0);
    const dt = cfg.physics.fixedDt;
    const fwd = new THREE.Vector3();
    const up = new THREE.Vector3();
    const right = new THREE.Vector3();
    const angvel = new THREE.Vector3();
    const q = new THREE.Quaternion();

    for (let i = 0; i < Math.round(seconds / dt); i++) {
      const r = car.body.rotation();
      q.set(r.x, r.y, r.z, r.w);
      fwd.copy(FORWARD).applyQuaternion(q);
      up.copy(UP).applyQuaternion(q);
      right.copy(RIGHT).applyQuaternion(q);
      const a = car.body.angvel();
      angvel.set(a.x, a.y, a.z);

      const aim = pointNoseAt(direction, fwd, up, right, angvel, GAINS);
      car.input = { ...emptyInput(), pitch: aim.pitch, steer: aim.steer, roll: aim.roll };
      car.update(dt);
      phys.step();
      phys.events.drainCollisionEvents(() => {});
      // Keep it in the air for the length of the test.
      car.body.setTranslation({ x: 0, y: 1200, z: 0 }, true);
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }

    const r = car.body.rotation();
    q.set(r.x, r.y, r.z, r.w);
    fwd.copy(FORWARD).applyQuaternion(q);
    return fwd.angleTo(direction.clone().normalize());
  }

  /** The same flight, reporting the aim error at every step. */
  function flyAtTracked(direction: THREE.Vector3, seconds: number): number[] {
    phys = new PhysicsWorld();
    createArena(phys);
    const car = new Car(phys, { x: 0, y: 1200, z: 0 }, 0, 0);
    const dt = cfg.physics.fixedDt;
    const fwd = new THREE.Vector3();
    const up = new THREE.Vector3();
    const right = new THREE.Vector3();
    const angvel = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const out: number[] = [];

    for (let i = 0; i < Math.round(seconds / dt); i++) {
      const r = car.body.rotation();
      q.set(r.x, r.y, r.z, r.w);
      fwd.copy(FORWARD).applyQuaternion(q);
      up.copy(UP).applyQuaternion(q);
      right.copy(RIGHT).applyQuaternion(q);
      const a = car.body.angvel();
      angvel.set(a.x, a.y, a.z);
      const aim = pointNoseAt(direction, fwd, up, right, angvel, GAINS);
      car.input = { ...emptyInput(), pitch: aim.pitch, steer: aim.steer, roll: aim.roll };
      car.update(dt);
      phys.step();
      phys.events.drainCollisionEvents(() => {});
      car.body.setTranslation({ x: 0, y: 1200, z: 0 }, true);
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      out.push(aim.error);
    }
    return out;
  }

  it('points the nose at a target above it', () => {
    expect(flyAt(new THREE.Vector3(1, 1, 0))).toBeLessThan(0.3);
  });

  it('points the nose at a target below it', () => {
    expect(flyAt(new THREE.Vector3(1, -1, 0))).toBeLessThan(0.3);
  });

  it('points the nose at a target to either side', () => {
    expect(flyAt(new THREE.Vector3(1, 0, -1))).toBeLessThan(0.3);
    expect(flyAt(new THREE.Vector3(1, 0, 1))).toBeLessThan(0.3);
  });

  it('turns all the way round for a target behind it', () => {
    expect(flyAt(new THREE.Vector3(-1, 0.3, 0), 2.0)).toBeLessThan(0.4);
  });

  it('points the nose straight up without rolling over', () => {
    // The case the first version of this got badly wrong. Near vertical the
    // levelling term becomes degenerate and a per-axis atan2 error keeps
    // growing as the nose passes vertical rather than reversing, so the car
    // would rotate straight through and end up inverted.
    expect(flyAt(new THREE.Vector3(0.15, 1, 0), 2.0)).toBeLessThan(0.2);
  });

  it('points the nose straight down too', () => {
    expect(flyAt(new THREE.Vector3(0.15, -1, 0), 2.0)).toBeLessThan(0.2);
  });

  it('gets to vertical without overshooting through it', () => {
    // Sampled along the way: the error should fall and stay fallen, not dip
    // and come back because the car sailed past and had to return.
    const errors = flyAtTracked(new THREE.Vector3(0.15, 1, 0), 2.0);
    const settled = errors.slice(Math.floor(errors.length * 0.6));
    expect(Math.max(...settled)).toBeLessThan(0.3);
  });

  it('settles instead of oscillating past the target', () => {
    // Given plenty of time it should be closer still, not swinging.
    const quick = flyAt(new THREE.Vector3(1, 1, 0), 1.2);
    const settled = flyAt(new THREE.Vector3(1, 1, 0), 2.5);
    expect(settled).toBeLessThanOrEqual(quick + 0.05);
    expect(settled).toBeLessThan(0.15);
  });
});
