import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Loop } from '../src/core/loop';

/**
 * The loop decides how much simulation each frame gets. Getting this wrong means
 * the feel changes with frame rate, so the step accounting is tested directly
 * rather than by eye.
 */

let now = 0;
let callbacks: ((t: number) => void)[] = [];

/** Runs one frame `ms` after the last, draining the rAF queue once. */
function frame(ms: number): void {
  now += ms;
  const due = callbacks;
  callbacks = [];
  for (const cb of due) cb(now);
}

beforeEach(() => {
  now = 0;
  callbacks = [];
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    callbacks.push(cb);
    return callbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function makeLoop(step: number, maxSteps = 8) {
  const counts = { fixed: 0, render: 0 };
  const alphas: number[] = [];
  const loop = new Loop(
    {
      fixed: () => counts.fixed++,
      render: (_dt, alpha) => {
        counts.render++;
        alphas.push(alpha);
      },
    },
    () => step,
    () => maxSteps,
  );
  return { loop, counts, alphas };
}

describe('fixed step accounting', () => {
  it('runs two 120Hz steps per 60Hz frame', () => {
    const { loop, counts } = makeLoop(1 / 120);
    loop.start();
    for (let i = 0; i < 10; i++) frame(1000 / 60);
    expect(counts.render).toBe(10);
    // First frame has no accumulated time yet, so 9 frames' worth of steps.
    expect(counts.fixed).toBeGreaterThanOrEqual(18);
    expect(counts.fixed).toBeLessThanOrEqual(20);
  });

  it('runs one step per frame when display and physics rates match', () => {
    const { loop, counts } = makeLoop(1 / 60);
    loop.start();
    for (let i = 0; i < 20; i++) frame(1000 / 60);
    expect(counts.fixed).toBeGreaterThanOrEqual(19);
    expect(counts.fixed).toBeLessThanOrEqual(20);
  });

  it('simulates the same amount of time at 30fps as at 144fps', () => {
    const slow = makeLoop(1 / 120);
    slow.loop.start();
    for (let i = 0; i < 30; i++) frame(1000 / 30);
    const slowSteps = slow.counts.fixed;

    now = 0;
    callbacks = [];
    const fast = makeLoop(1 / 120);
    fast.loop.start();
    for (let i = 0; i < 144; i++) frame(1000 / 144);
    const fastSteps = fast.counts.fixed;

    // One second of wall time either way, so the same simulated time.
    expect(Math.abs(slowSteps - fastSteps)).toBeLessThan(4);
  });

  it('caps steps per frame so a long stall cannot spiral', () => {
    const { loop, counts } = makeLoop(1 / 120, 4);
    loop.start();
    frame(16);
    counts.fixed = 0;
    frame(5000); // tab was backgrounded
    expect(counts.fixed).toBeLessThanOrEqual(4);
  });

  it('reports an interpolation alpha inside [0, 1)', () => {
    const { loop, alphas } = makeLoop(1 / 120);
    loop.start();
    for (let i = 0; i < 15; i++) frame(7); // deliberately not a multiple of the step
    for (const a of alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('stops scheduling once stopped', () => {
    const { loop, counts } = makeLoop(1 / 120);
    loop.start();
    frame(16);
    loop.stop();
    const before = counts.render;
    frame(16);
    frame(16);
    expect(counts.render).toBe(before);
  });
});
