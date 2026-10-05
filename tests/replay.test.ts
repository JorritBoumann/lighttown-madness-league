import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { cfg } from '../src/config';
import { Replay, type ReplayActor } from '../src/render/replay';

/**
 * Goal replays.
 *
 * A replay is a recording of transforms, not a re-simulation: replaying by
 * running the physics again would need the world rewound exactly, and one
 * floating-point difference turns a goal into a miss. So what is worth testing
 * is the recording — that the ring buffer plays back oldest first after it
 * wraps, that playback is the same length however fast the machine recorded
 * it, and that it refuses to show footage that would be nonsense.
 */

const actor = (x: number): ReplayActor => ({
  position: { x, y: 100, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
});

/** Records `seconds` of a ball moving steadily, at the given frame rate. */
function record(replay: Replay, seconds: number, fps = 120, speed = 1000): void {
  const dt = 1 / fps;
  let x = 0;
  for (let t = 0; t < seconds; t += dt) {
    x += speed * dt;
    replay.record(dt, [actor(x * 0.5)], actor(x));
  }
}

function meshes(n: number): THREE.Object3D[] {
  return Array.from({ length: n }, () => new THREE.Object3D());
}

describe('replay recording', () => {
  it('has nothing to show before anything happens', () => {
    const r = new Replay();
    expect(r.start({ x: 0, y: 0, z: 0 })).toBe(false);
    expect(r.playing).toBe(false);
  });

  it('refuses a replay of a goal scored in the first moments', () => {
    // There is nothing worth watching, and a two-frame replay is a flicker.
    const r = new Replay();
    record(r, 0.1);
    expect(r.start({ x: 0, y: 0, z: 0 })).toBe(false);
  });

  it('plays once there is footage', () => {
    const r = new Replay();
    record(r, 3);
    expect(r.start({ x: 5000, y: 100, z: 0 })).toBe(true);
    expect(r.playing).toBe(true);
  });

  it('keeps a fixed window however long it records', () => {
    const r = new Replay();
    record(r, 30);
    // The buffer is capped, so half a minute of play leaves the configured
    // few seconds, not half a minute.
    expect(r.available).toBeLessThanOrEqual(cfg.replay.seconds);
    expect(r.available).toBeGreaterThan(cfg.replay.seconds * 0.8);
  });

  it('records the same footage at 60 and at 240 frames a second', () => {
    const slow = new Replay();
    const fast = new Replay();
    record(slow, 3, 60);
    record(fast, 3, 240);
    // Sampling is on a fixed interval, so the window is the same either way,
    // give or take where the last sample happened to land.
    expect(Math.abs(fast.available - slow.available)).toBeLessThanOrEqual(cfg.replay.interval + 1e-9);
    expect(slow.available).toBeGreaterThan(2.5);
  });

  it('plays back oldest first after the buffer wraps', () => {
    const r = new Replay();
    record(r, 30, 120, 1000);
    r.start({ x: 0, y: 0, z: 0 });

    const cars = meshes(1);
    const ball = new THREE.Object3D();
    r.apply(cars, ball);
    const first = ball.position.x;

    // Halfway through, the ball should be further along than at the start:
    // a buffer read from the write head rather than the oldest slot plays the
    // tail before the head and jumps backwards here.
    for (let t = 0; t < r.available / 2; t += 1 / 60) r.update(1 / 60);
    r.apply(cars, ball);
    expect(ball.position.x).toBeGreaterThan(first);
  });

  it('finishes, and reports when it has', () => {
    const r = new Replay();
    record(r, 3);
    r.start({ x: 0, y: 0, z: 0 });
    let guard = 0;
    while (r.update(1 / 60) && guard++ < 10000) {
      /* run it out */
    }
    expect(r.playing).toBe(false);
    expect(guard).toBeLessThan(10000);
  });

  it('runs for longer than the footage when played under speed', () => {
    const r = new Replay();
    record(r, 3);
    r.start({ x: 0, y: 0, z: 0 });
    let elapsed = 0;
    while (r.update(1 / 60)) elapsed += 1 / 60;
    // Played at 0.85, so the wall-clock length is the footage divided by that.
    expect(elapsed).toBeGreaterThan(r.available);
  });

  it('records nothing while it is playing', () => {
    const r = new Replay();
    record(r, 3);
    const before = r.available;
    r.start({ x: 0, y: 0, z: 0 });
    record(r, 2);
    expect(r.available).toBeCloseTo(before, 5);
  });

  it('throws the recording away on demand', () => {
    const r = new Replay();
    record(r, 3);
    r.reset();
    expect(r.start({ x: 0, y: 0, z: 0 })).toBe(false);
  });

  it('drops old footage when the lineup changes', () => {
    // Rounds have different numbers of opponents. Footage of four cars cannot
    // be played back against two.
    const r = new Replay();
    record(r, 3);
    expect(r.available).toBeGreaterThan(0);
    r.record(1 / 120, [actor(0), actor(1), actor(2)], actor(3));
    expect(r.start({ x: 0, y: 0, z: 0 })).toBe(false);
  });
});
