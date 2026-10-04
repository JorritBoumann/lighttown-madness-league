import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as THREE from 'three';
import { cfg } from '../src/config';
import { initPhysics, PhysicsWorld } from '../src/physics/world';
import { createArena } from '../src/physics/arena';
import { Ball } from '../src/physics/ball';
import { Car } from '../src/physics/car';
import { BoostPads } from '../src/physics/boostPads';
import { emptyInput, type CarInput } from '../src/input/types';
import { kickoffSpawns } from '../src/core/arenaLayout';

/**
 * Headless checks against Rocket League's published figures. These are the
 * numbers that decide whether the car feels right, so they are pinned here
 * rather than left to eyeballing: throttle tops out at 1410, boost takes you to
 * 2300, braking is sharp, turn radius widens with speed.
 *
 * Units are Unreal Units: see src/config.ts.
 */

let phys: PhysicsWorld;
let car: Car;
let ball: Ball;

beforeAll(async () => {
  await initPhysics();
});

/** A clear patch of ground, nose pointing up-pitch. */
const START = { x: -3000, y: 60, z: 0 };

function run(seconds: number, input: Partial<CarInput> = {}, pads?: BoostPads): void {
  const dt = cfg.physics.fixedDt;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    car.input = { ...emptyInput(), ...input };
    car.update(dt);
    ball.update();
    pads?.update(dt, [car]);
    phys.step();
    phys.events.drainCollisionEvents(() => {});
  }
}

/** Same as run(), but reports the highest speed reached along the way. */
function runPeak(seconds: number, input: Partial<CarInput> = {}): number {
  const dt = cfg.physics.fixedDt;
  let peak = 0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    car.input = { ...emptyInput(), ...input };
    car.update(dt);
    ball.update();
    phys.step();
    phys.events.drainCollisionEvents(() => {});
    peak = Math.max(peak, car.speed);
  }
  return peak;
}

/** World-space Y component of the car's local up axis. 1 = wheels down. */
function upAxisY(c: Car): number {
  const r = c.body.rotation();
  return 1 - 2 * (r.x * r.x + r.z * r.z);
}

beforeEach(() => {
  phys = new PhysicsWorld();
  createArena(phys);
  ball = new Ball(phys);
  ball.reset({ x: 3000, y: cfg.ball.radius, z: 2000 }); // out of the way
  car = new Car(phys, START, 0);
});

describe('ground contact', () => {
  it('settles with all four wheels down', () => {
    run(1.5);
    expect(car.grounded).toBe(true);
    expect(car.wheelsOnGround).toBe(4);
  });

  it('floats the hitbox clear of the floor instead of scraping it', () => {
    run(1.5);
    const clearance = car.position.y - cfg.car.hitbox.height / 2;
    expect(clearance).toBeGreaterThan(2);
    expect(clearance).toBeLessThan(cfg.car.rideHeight + 15);
  });

  it('holds a steady ride height rather than oscillating', () => {
    run(2.0);
    const samples: number[] = [];
    for (let i = 0; i < 60; i++) {
      run(1 / 60);
      samples.push(car.position.y);
    }
    expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(3);
  });

  it('stays upright after settling', () => {
    run(1.5);
    expect(upAxisY(car)).toBeGreaterThan(0.95);
  });
});

describe('driving', () => {
  it('reaches the throttle ceiling of 1410 but no further', () => {
    run(1.0);
    const peak = runPeak(4.0, { throttle: 1 });
    expect(peak).toBeGreaterThan(cfg.car.maxDriveSpeed * 0.97);
    expect(peak).toBeLessThanOrEqual(cfg.car.maxDriveSpeed * 1.02);
  });

  it('accelerates hardest from a standstill and tapers off near the top', () => {
    run(1.0);
    const sample = (): number => {
      const before = car.speed;
      run(0.1, { throttle: 1 });
      return car.speed - before;
    };
    const fromRest = sample();
    run(2.0, { throttle: 1 }); // get up near the ceiling
    const nearTop = sample();
    // 1600 at rest against 160 at 1400: acceleration should collapse.
    expect(fromRest).toBeGreaterThan(nearTop * 4);
  });

  it('boost takes it past the throttle ceiling to the 2300 cap', () => {
    car.boost = 100;
    run(1.0);
    const peak = runPeak(5.0, { throttle: 1, boost: true });
    expect(peak).toBeGreaterThan(cfg.car.maxDriveSpeed + 400);
    expect(peak).toBeLessThanOrEqual(cfg.car.maxSpeed * 1.02);
  });

  it('goes supersonic on boost and not on throttle alone', () => {
    run(1.0);
    runPeak(4.0, { throttle: 1 });
    expect(car.isSupersonic).toBe(false);

    car.reset(START, 0);
    car.boost = 100;
    run(1.0);
    const peak = runPeak(5.0, { throttle: 1, boost: true });
    expect(peak).toBeGreaterThanOrEqual(cfg.car.supersonicSpeed);
  });

  it('brakes from full speed to a stop in under half a second', () => {
    run(1.0);
    run(3.5, { throttle: 1 });
    expect(car.speed).toBeGreaterThan(1300);

    // Time the stop rather than sampling after a fixed window: holding reverse
    // past the stop correctly starts driving backwards.
    const dt = cfg.physics.fixedDt;
    let elapsed = 0;
    for (let i = 0; i < Math.round(1.5 / dt); i++) {
      car.input = { ...emptyInput(), throttle: -1 };
      car.update(dt);
      phys.step();
      phys.events.drainCollisionEvents(() => {});
      elapsed += dt;
      if (car.forward().dot(new THREE.Vector3(car.velocity.x, car.velocity.y, car.velocity.z)) <= 0) {
        break;
      }
    }
    expect(elapsed).toBeLessThan(0.5);
  });

  it('drives backwards, more slowly than forwards, when reverse is held', () => {
    run(1.0);
    run(2.5, { throttle: -1 });
    const along = car
      .forward()
      .dot(new THREE.Vector3(car.velocity.x, car.velocity.y, car.velocity.z));
    expect(along).toBeLessThan(-200);
    expect(Math.abs(along)).toBeLessThan(cfg.car.maxDriveSpeed * 0.5);
  });

  it('coasts down slowly when the throttle is released', () => {
    run(1.0);
    run(3.0, { throttle: 1 });
    const fast = car.speed;
    run(0.7);
    const lost = fast - car.speed;
    // Coasting sheds 525/s, far gentler than braking's 3500.
    expect(lost).toBeGreaterThan(150);
    expect(lost).toBeLessThan(900);
  });

  it('turns in a wider circle at speed than at a crawl', () => {
    const turnRadius = (throttleTime: number): number => {
      car.reset(START, 0);
      run(0.8);
      run(throttleTime, { throttle: 1 });
      const speed = car.speed;
      // Yaw rate over a short arc gives the radius: r = v / omega.
      const before = car.forward().clone();
      run(0.25, { throttle: 1, steer: 1 });
      const after = car.forward();
      const angle = Math.acos(Math.min(1, before.dot(after)));
      return (speed * 0.25) / Math.max(angle, 1e-4);
    };
    const slow = turnRadius(0.25);
    const fast = turnRadius(3.0);
    expect(fast).toBeGreaterThan(slow * 1.8);
  });

  it('does not pivot on the spot with no throttle', () => {
    run(1.5);
    const before = car.forward().clone();
    run(1.0, { steer: 1 });
    expect(before.dot(car.forward())).toBeGreaterThan(0.99);
  });

  it('powerslide holds more sideways speed than gripping does', () => {
    const lateralAfterTurn = (drift: boolean): number => {
      car.reset(START, 0);
      run(0.8);
      run(1.6, { throttle: 1 });
      run(0.5, { throttle: 1, steer: 1, drift });
      // Sideways component of velocity, in the car's own frame.
      const f = car.forward();
      const v = car.velocity;
      return Math.abs(-f.z * v.x + f.x * v.z);
    };
    expect(lateralAfterTurn(true)).toBeGreaterThan(lateralAfterTurn(false) * 1.5);
  });
});

describe('jumps and dodges', () => {
  it('leaves the ground on jump', () => {
    run(1.2);
    const groundY = car.position.y;
    run(0.03, { jumpPressed: true, jumpHeld: true });
    run(0.25, { jumpHeld: true });
    expect(car.position.y).toBeGreaterThan(groundY + 50);
    expect(car.grounded).toBe(false);
  });

  it('holding jump gains meaningfully more height than tapping it', () => {
    run(1.2);
    run(0.03, { jumpPressed: true, jumpHeld: true });
    run(0.6);
    const tap = car.position.y;

    car.reset(START, 0);
    run(1.2);
    run(0.03, { jumpPressed: true, jumpHeld: true });
    run(cfg.car.jumpHoldTime, { jumpHeld: true });
    run(0.6 - cfg.car.jumpHoldTime);
    expect(car.position.y).toBeGreaterThan(tap + 30);
  });

  it('allows a second jump in the air and then refuses a third', () => {
    run(1.2);
    run(0.03, { jumpPressed: true, jumpHeld: true });
    run(0.2);
    expect(car.canDoubleJump).toBe(true);
    run(0.03, { jumpPressed: true, jumpHeld: true });
    run(0.1);
    expect(car.canDoubleJump).toBe(false);
  });

  it('front dodge converts the second jump into forward speed', () => {
    run(1.2);
    run(1.5, { throttle: 1 });
    run(0.03, { jumpPressed: true, jumpHeld: true, throttle: 1 });
    run(0.2, { throttle: 1 });
    const before = car.velocity.x;
    run(0.03, { jumpPressed: true, throttle: 1 });
    run(0.05);
    expect(car.velocity.x).toBeGreaterThan(before + 300);
  });

  it('jumps once per press, however long the press is reported', () => {
    run(1.2);
    const base = car.position.y;
    // A press held across many steps must still be a single jump.
    run(0.3, { jumpPressed: true, jumpHeld: true });
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      run(1 / 120);
      peak = Math.max(peak, car.position.y);
    }
    const height = peak - base;
    // Impulse 291.667 against gravity 650, plus the 0.2s hold: a little over 230.
    expect(height).toBeGreaterThan(150);
    expect(height).toBeLessThan(330);
  });

  it('needs the jump released before the second jump is available', () => {
    run(1.2);
    // Hold jump continuously: the second jump must not fire on its own.
    run(0.5, { jumpPressed: true, jumpHeld: true });
    expect(car.canDoubleJump).toBe(true);
    run(0.2, { jumpHeld: true });
    expect(car.canDoubleJump).toBe(true);
    // Release, then press again.
    run(0.03);
    run(0.03, { jumpPressed: true, jumpHeld: true });
    run(0.05);
    expect(car.canDoubleJump).toBe(false);
  });

  it('tap and held jump heights match the closed-form figures', () => {
    const jumpHeight = (hold: number): number => {
      car.reset(START, 0);
      run(1.2);
      const base = car.position.y;
      run(cfg.physics.fixedDt, { jumpPressed: true, jumpHeld: true });
      if (hold > 0) run(hold, { jumpHeld: true });
      let peak = 0;
      for (let i = 0; i < 150; i++) {
        run(1 / 120);
        peak = Math.max(peak, car.position.y);
      }
      return peak - base;
    };

    const g = -cfg.physics.gravity;
    const v0 = cfg.car.jumpImpulse;
    // Ballistic apex from the impulse alone.
    const expectedTap = (v0 * v0) / (2 * g);
    expect(jumpHeight(0)).toBeCloseTo(expectedTap, -1);

    // Held: 0.2s of net upward acceleration, then the ballistic remainder.
    const hold = cfg.car.jumpHoldTime;
    const net = cfg.car.jumpAccel - g;
    const vEnd = v0 + net * hold;
    const expectedHeld = v0 * hold + 0.5 * net * hold * hold + (vEnd * vEnd) / (2 * g);
    expect(jumpHeight(hold)).toBeCloseTo(expectedHeld, -1.2);
  });

  it('a dodge adds its own impulse on top of current speed', () => {
    run(1.0);
    run(3.0, { throttle: 1 });
    const before = car.speed;
    run(cfg.physics.fixedDt, { jumpPressed: true, jumpHeld: true, throttle: 1 });
    run(0.18, { throttle: 1 });
    run(cfg.physics.fixedDt, { jumpPressed: true, throttle: 1 });
    run(0.06);
    const gained = car.speed - before;
    expect(gained).toBeGreaterThan(cfg.car.dodgeImpulse * 0.85);
    expect(gained).toBeLessThan(cfg.car.dodgeImpulse * 1.2);
  });

  it('a tapped jump is much lower than a held one', () => {
    const jumpHeight = (hold: number): number => {
      car.reset(START, 0);
      run(1.2);
      const base = car.position.y;
      run(0.01, { jumpPressed: true, jumpHeld: true });
      if (hold > 0) run(hold, { jumpHeld: true });
      let peak = 0;
      for (let i = 0; i < 120; i++) {
        run(1 / 120);
        peak = Math.max(peak, car.position.y);
      }
      return peak - base;
    };
    const tap = jumpHeight(0);
    const held = jumpHeight(cfg.car.jumpHoldTime);
    expect(held).toBeGreaterThan(tap * 2);
  });
});

describe('air control', () => {
  it('rolls far faster than it pitches or yaws', () => {
    const spinRate = (input: Partial<CarInput>): number => {
      car.reset({ x: 0, y: 1000, z: 0 }, 0);
      run(0.05);
      run(0.08, input);
      const a = car.body.angvel();
      return Math.hypot(a.x, a.y, a.z);
    };
    const roll = spinRate({ roll: 1 });
    const pitch = spinRate({ pitch: 1 });
    const yaw = spinRate({ steer: 1 });
    expect(roll).toBeGreaterThan(pitch * 1.5);
    expect(roll).toBeGreaterThan(yaw * 1.5);
  });

  it('caps angular speed at the configured maximum', () => {
    car.reset({ x: 0, y: 1500, z: 0 }, 0);
    run(2.5, { roll: 1 });
    const a = car.body.angvel();
    expect(Math.hypot(a.x, a.y, a.z)).toBeLessThanOrEqual(cfg.car.maxAngularSpeed * 1.02);
  });

  it('settles its spin once input is released', () => {
    car.reset({ x: 0, y: 1500, z: 0 }, 0);
    run(0.5, { roll: 1 });
    const spinning = Math.hypot(...vec(car.body.angvel()));
    run(1.0);
    expect(Math.hypot(...vec(car.body.angvel()))).toBeLessThan(spinning * 0.5);
  });
});

describe('boost', () => {
  it('drains at the published rate and stops at zero', () => {
    run(1.0);
    car.boost = 100;
    run(1.0, { throttle: 1, boost: true });
    // 33.3 per second.
    expect(100 - car.boost).toBeGreaterThan(30);
    expect(100 - car.boost).toBeLessThan(37);
    run(4.0, { throttle: 1, boost: true });
    expect(car.boost).toBe(0);
  });

  it('gives no thrust once empty', () => {
    car.boost = 0;
    run(1.0);
    const peak = runPeak(4.0, { throttle: 1, boost: true });
    expect(peak).toBeLessThanOrEqual(cfg.car.maxDriveSpeed * 1.02);
  });

  it('is refilled by driving over a pad', () => {
    const pads = new BoostPads();
    // The small pad on the halfway line, off to one side.
    const pad = pads.pads.find((p) => !p.big && p.x === 0 && p.z === -1024)!;
    car.reset({ x: pad.x - 1200, y: 60, z: pad.z }, 0);
    car.boost = 0;
    run(0.8, {}, pads);
    run(2.0, { throttle: 1 }, pads);
    expect(car.boost).toBeGreaterThanOrEqual(cfg.boost.smallPadAmount);
    expect(pad.cooldown).toBeGreaterThan(0);
  });

  it('fills completely from a big pad', () => {
    const pads = new BoostPads();
    const pad = pads.pads.find((p) => p.big && p.x === 0)!;
    car.reset({ x: pad.x - 1200, y: 60, z: pad.z }, 0);
    car.boost = 0;
    run(0.8, {}, pads);
    run(2.0, { throttle: 1 }, pads);
    expect(car.boost).toBe(cfg.boost.max);
  });
});

describe('recovery', () => {
  it('rights itself after landing on its roof', () => {
    car.reset({ x: 0, y: 400, z: 0 }, 0);
    car.body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true); // upside down
    run(5.0);
    expect(upAxisY(car)).toBeGreaterThan(0.9);
    expect(car.grounded).toBe(true);
  });

  it('recovers from a tumble and ends up driveable', () => {
    car.reset({ x: 0, y: 800, z: 0 }, 0);
    car.body.setAngvel({ x: 4, y: 1.5, z: 3 }, true);
    run(6.0);
    expect(upAxisY(car)).toBeGreaterThan(0.9);
    expect(car.grounded).toBe(true);
    const x0 = car.position.x;
    run(1.0, { throttle: 1 });
    expect(Math.abs(car.position.x - x0)).toBeGreaterThan(200);
  });
});

describe('wall driving', () => {
  it('transitions onto the side wall and climbs it', () => {
    // Square at the +z wall with a long run-up. Boost is topped up so the run
    // is about the geometry, not about pad management.
    car.reset({ x: 0, y: 60, z: -1000 }, -Math.PI / 2);
    car.boost = cfg.boost.max;
    run(0.8);

    const dt = cfg.physics.fixedDt;
    let peakY = 0;
    let minUpY = 1;
    let wheelsWhileHigh = 0;
    for (let i = 0; i < Math.round(4.5 / dt); i++) {
      car.input = { ...emptyInput(), throttle: 1, boost: true };
      car.boost = cfg.boost.max;
      car.update(dt);
      phys.step();
      phys.events.drainCollisionEvents(() => {});
      peakY = Math.max(peakY, car.position.y);
      if (car.position.y > 500) {
        minUpY = Math.min(minUpY, upAxisY(car));
        wheelsWhileHigh = Math.max(wheelsWhileHigh, car.wheelsOnGround);
      }
    }

    // Well past the 256 seam ramp, so this is the vertical wall proper.
    expect(peakY).toBeGreaterThan(1000);
    // Driving on it, not scraping along it: the roof has rotated to face inward.
    expect(minUpY).toBeLessThan(0.2);
    expect(wheelsWhileHigh).toBeGreaterThanOrEqual(3);
  });
});

describe('ball', () => {
  it('bounces and loses energy', () => {
    ball.reset({ x: 0, y: 1500, z: 0 });
    run(1.3);
    const apex = trackApex(2.5);
    expect(apex).toBeGreaterThan(cfg.ball.radius);
    expect(apex).toBeLessThan(1500);
  });

  it('stays inside the arena after a hard kick', () => {
    ball.reset({ x: 0, y: 300, z: 0 });
    ball.body.setLinvel({ x: 4000, y: 600, z: 1800 }, true);
    run(10);
    const p = ball.position;
    expect(Math.abs(p.x)).toBeLessThan(cfg.arena.halfLength + cfg.arena.goalDepth + 200);
    expect(Math.abs(p.z)).toBeLessThan(cfg.arena.halfWidth + 200);
    expect(p.y).toBeGreaterThan(-50);
    expect(p.y).toBeLessThan(cfg.arena.ceiling + 200);
  });

  it('respects its speed cap', () => {
    ball.body.setLinvel({ x: 30000, y: 0, z: 0 }, true);
    run(0.1);
    const s = Math.hypot(...vec(ball.velocity));
    expect(s).toBeLessThanOrEqual(cfg.ball.maxSpeed * 1.02);
  });
});

describe('kickoff spawns', () => {
  it('places all five spots inside the defending half, facing the centre', () => {
    for (const sign of [1, -1] as const) {
      for (const spot of kickoffSpawns(sign)) {
        expect(Math.sign(spot.x)).toBe(sign);
        expect(Math.abs(spot.x)).toBeLessThan(cfg.arena.halfLength);
        expect(Math.abs(spot.z)).toBeLessThan(cfg.arena.halfWidth);
        // Facing the middle means the forward vector points back toward x = 0.
        const fx = Math.cos(spot.yaw);
        expect(Math.sign(fx)).toBe(-sign);
      }
    }
  });
});

// --- helpers ---------------------------------------------------------------

function vec(v: { x: number; y: number; z: number }): [number, number, number] {
  return [v.x, v.y, v.z];
}

/** Highest point the ball reaches over the next `seconds`. */
function trackApex(seconds: number): number {
  const dt = cfg.physics.fixedDt;
  let apex = 0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    car.input = emptyInput();
    car.update(dt);
    ball.update();
    phys.step();
    phys.events.drainCollisionEvents(() => {});
    apex = Math.max(apex, ball.position.y);
  }
  return apex;
}
