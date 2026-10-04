import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { cfg } from '../src/config';
import { initPhysics, PhysicsWorld } from '../src/physics/world';
import { createArena } from '../src/physics/arena';
import { Ball } from '../src/physics/ball';
import { Car } from '../src/physics/car';
import { BoostPads } from '../src/physics/boostPads';
import { emptyInput } from '../src/input/types';

/**
 * Headless checks on the feel-critical behaviour: the car settles on the floor,
 * accelerates, respects its speed cap, turns, jumps, flips, drains boost and
 * collects pads; the ball bounces and stays inside the arena.
 */

let phys: PhysicsWorld;
let car: Car;
let ball: Ball;

beforeAll(async () => {
  await initPhysics();
});

/** Advances the sim, feeding the same input every step. */
function run(seconds: number, input: Partial<ReturnType<typeof emptyInput>> = {}, pads?: BoostPads): void {
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
function runPeak(seconds: number, input: Partial<ReturnType<typeof emptyInput>> = {}): number {
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

beforeEach(() => {
  phys = new PhysicsWorld();
  createArena(phys);
  ball = new Ball(phys);
  car = new Car(phys, { x: -20, y: 2, z: 0 }, 0);
});

describe('ground contact', () => {
  it('settles on the floor at roughly ride height', () => {
    run(1.5);
    expect(car.grounded).toBe(true);
    expect(car.position.y).toBeGreaterThan(cfg.car.rideHeight * 0.5);
    expect(car.position.y).toBeLessThan(cfg.car.rideHeight + 0.5);
  });

  it('floats the chassis clear of the floor instead of scraping it', () => {
    run(2.0);
    expect(car.grounded).toBe(true);
    // Collider bottom must sit above the floor, or contacts fight the suspension.
    const clearance = car.position.y - cfg.car.halfExtents.y;
    expect(clearance).toBeGreaterThan(0.05);
    expect(clearance).toBeLessThan(0.45);
  });

  it('holds a steady ride height rather than oscillating', () => {
    run(2.0);
    const samples: number[] = [];
    for (let i = 0; i < 60; i++) {
      run(1 / 60);
      samples.push(car.position.y);
    }
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(max - min).toBeLessThan(0.06);
  });

  it('stays upright after landing', () => {
    run(1.5);
    const up = car.forward().set(0, 1, 0);
    const r = car.body.rotation();
    // Rotate local up by the body rotation and check it still points up.
    const { x, y, z, w } = r;
    const ux = 2 * (x * y - w * z);
    const uy = 1 - 2 * (x * x + z * z);
    const uz = 2 * (y * z + w * x);
    expect(uy).toBeGreaterThan(0.95);
    void up;
    void ux;
    void uz;
  });
});

describe('driving', () => {
  it('accelerates forward under throttle', () => {
    run(1.0);
    const startX = car.position.x;
    run(1.5, { throttle: 1 });
    expect(car.position.x).toBeGreaterThan(startX + 5);
    expect(car.speed).toBeGreaterThan(10);
  });

  it('reaches but does not exceed the no-boost speed cap', () => {
    // Start at one end so the car has clear track ahead of it.
    car.reset({ x: -cfg.arena.length / 2 + 4, y: 2, z: 0 }, 0);
    run(1.0);
    const peak = runPeak(3.0, { throttle: 1 });
    expect(peak).toBeGreaterThan(cfg.car.maxSpeed * 0.9);
    // A little overshoot is one step of integrator slop, not a broken cap.
    expect(peak).toBeLessThanOrEqual(cfg.car.maxSpeed * 1.03);
  });

  it('goes faster with boost than without', () => {
    car.reset({ x: -cfg.arena.length / 2 + 4, y: 2, z: 0 }, 0);
    car.boost = 0;
    run(1.0);
    const plain = runPeak(2.5, { throttle: 1 });

    car.reset({ x: -cfg.arena.length / 2 + 4, y: 2, z: 0 }, 0);
    car.boost = 100;
    run(1.0);
    const boosted = runPeak(2.5, { throttle: 1, boost: true });

    expect(boosted).toBeGreaterThan(plain + 2);
    expect(boosted).toBeLessThanOrEqual(cfg.car.boostMaxSpeed * 1.03);
  });

  it('changes heading when steering', () => {
    run(1.0);
    run(0.5, { throttle: 1 });
    const before = car.forward().clone();
    run(1.0, { throttle: 1, steer: 1 });
    const after = car.forward();
    expect(before.dot(after)).toBeLessThan(0.97);
  });

  it('brakes to a stop when throttle reverses', () => {
    run(1.0);
    run(2, { throttle: 1 });
    const fast = car.speed;
    expect(fast).toBeGreaterThan(8);
    run(1.2, { throttle: -1 });
    expect(car.speed).toBeLessThan(fast);
  });
});

describe('jumps and flips', () => {
  it('leaves the ground on jump', () => {
    run(1.2);
    const groundY = car.position.y;
    run(0.03, { jumpPressed: true, jumpHeld: true });
    run(0.25, { jumpHeld: true });
    expect(car.position.y).toBeGreaterThan(groundY + 0.8);
    expect(car.grounded).toBe(false);
  });

  it('holding jump gains more height than tapping it', () => {
    run(1.2);
    run(0.03, { jumpPressed: true, jumpHeld: true });
    run(0.45);
    const tapHeight = car.position.y;

    car.reset({ x: -20, y: 2, z: 0 }, 0);
    run(1.2);
    run(0.03, { jumpPressed: true, jumpHeld: true });
    run(cfg.car.jumpHoldTime, { jumpHeld: true });
    run(0.45 - cfg.car.jumpHoldTime);
    expect(car.position.y).toBeGreaterThan(tapHeight);
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

  it('front flip converts the second jump into forward speed', () => {
    run(1.2);
    run(0.03, { jumpPressed: true, jumpHeld: true });
    run(0.2);
    const vxBefore = car.velocity.x;
    run(0.03, { jumpPressed: true, jumpHeld: true, throttle: 1 });
    run(0.05);
    expect(car.velocity.x).toBeGreaterThan(vxBefore + 3);
  });
});

describe('boost', () => {
  it('drains while held and stops at zero', () => {
    run(1.0);
    car.boost = 20;
    run(0.5, { throttle: 1, boost: true });
    expect(car.boost).toBeLessThan(20);
    run(3, { throttle: 1, boost: true });
    expect(car.boost).toBe(0);
  });

  it('is refilled by driving over a pad', () => {
    const pads = new BoostPads();
    const pad = pads.pads.find((p) => !p.big && p.x === 0 && p.z === 0)!;
    car.reset({ x: pad.x - 8, y: 2, z: pad.z }, 0);
    car.boost = 0;
    run(1.0, {}, pads);
    run(2.5, { throttle: 1 }, pads);
    expect(car.boost).toBeGreaterThan(0);
    expect(pad.cooldown).toBeGreaterThan(0);
  });
});

describe('ball', () => {
  it('falls, bounces and loses energy', () => {
    ball.reset({ x: 0, y: 14, z: 0 });
    run(1.2);
    const firstApex = trackApex(2.0);
    expect(firstApex).toBeGreaterThan(0.5);
    expect(firstApex).toBeLessThan(14);
  });

  it('stays inside the arena after a hard kick', () => {
    ball.reset({ x: 0, y: 3, z: 0 });
    ball.body.setLinvel({ x: 55, y: 8, z: 22 }, true);
    run(8);
    const p = ball.position;
    const bound = cfg.arena.length / 2 + cfg.arena.goalDepth + 2;
    expect(Math.abs(p.x)).toBeLessThan(bound);
    expect(Math.abs(p.z)).toBeLessThan(cfg.arena.width / 2 + 2);
    expect(p.y).toBeGreaterThan(-1);
  });

  it('respects its speed cap', () => {
    ball.body.setLinvel({ x: 500, y: 0, z: 0 }, true);
    run(0.1);
    expect(Math.hypot(ball.velocity.x, ball.velocity.y, ball.velocity.z)).toBeLessThanOrEqual(
      cfg.ball.maxSpeed + 1,
    );
  });
});

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
