import { describe, it, expect } from 'vitest';
import { cfg } from '../src/config';
import { BallPredictor, predictAt } from '../src/ai/ballPrediction';

/**
 * The predictor only has to be right for about a second, but it has to be right
 * about the things a bot acts on: where a dropping ball lands, and that it stays
 * inside the arena.
 */

const still = (x: number, y: number, z = 0) => ({
  position: { x, y, z },
  velocity: { x: 0, y: 0, z: 0 },
});

describe('free fall', () => {
  it('matches the analytic drop over a short horizon', () => {
    const start = 1000;
    const t = 0.5;
    const out = predictAt(still(0, start), t);
    // Drag is small over half a second, so this should land close to v = gt.
    const analytic = start + 0.5 * cfg.physics.gravity * t * t;
    expect(out.position.y).toBeGreaterThan(analytic - 15);
    expect(out.position.y).toBeLessThan(analytic + 15);
  });

  it('settles onto the floor rather than through it', () => {
    const samples = new BallPredictor().predict(still(0, 500), 4);
    for (const s of samples) {
      expect(s.position.y).toBeGreaterThanOrEqual(cfg.ball.radius - 0.01);
    }
    expect(samples.at(-1)!.position.y).toBeLessThan(cfg.ball.radius + 120);
  });

  it('loses height on each bounce', () => {
    const samples = new BallPredictor().predict(still(0, 1200), 6, 1 / 60);
    // Collect the apex of each arc.
    const apexes: number[] = [];
    for (let i = 1; i < samples.length - 1; i++) {
      const a = samples[i - 1]!.position.y;
      const b = samples[i]!.position.y;
      const c = samples[i + 1]!.position.y;
      if (b >= a && b > c && b > cfg.ball.radius + 40) apexes.push(b);
    }
    expect(apexes.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < apexes.length; i++) {
      expect(apexes[i]!).toBeLessThan(apexes[i - 1]!);
    }
  });
});

describe('containment', () => {
  it('keeps a hard cross inside the side walls', () => {
    const samples = new BallPredictor().predict(
      { position: { x: 0, y: 300, z: 0 }, velocity: { x: 0, y: 0, z: 5000 } },
      4,
    );
    for (const s of samples) {
      expect(Math.abs(s.position.z)).toBeLessThanOrEqual(cfg.arena.halfWidth);
    }
  });

  it('lets a shot on target carry into the goal mouth', () => {
    const samples = new BallPredictor().predict(
      { position: { x: 0, y: cfg.ball.radius, z: 0 }, velocity: { x: 5000, y: 0, z: 0 } },
      4,
    );
    // The mouth is open, so the ball should end up past the goal line.
    expect(samples.at(-1)!.position.x).toBeGreaterThan(cfg.arena.halfLength);
  });

  it('bounces a shot that is still above the bar off the back wall', () => {
    // Fired from close in, so it has no time to dip under the crossbar.
    const samples = new BallPredictor().predict(
      {
        position: { x: 4000, y: cfg.arena.goalHeight + 500, z: 0 },
        velocity: { x: 4000, y: 0, z: 0 },
      },
      1.0,
    );
    for (const s of samples) {
      expect(s.position.x).toBeLessThanOrEqual(cfg.arena.halfLength + 1);
    }
  });

  it('lets a dipping shot through the mouth once it falls under the bar', () => {
    // Same shot from distance: by the time it arrives it has dropped, and a
    // ball under the bar should go in rather than bouncing off thin air.
    const samples = new BallPredictor().predict(
      {
        position: { x: 0, y: cfg.arena.goalHeight + 400, z: 0 },
        velocity: { x: 4000, y: 0, z: 0 },
      },
      2.0,
    );
    expect(samples.at(-1)!.position.x).toBeGreaterThan(cfg.arena.halfLength);
  });
});

describe('sampling', () => {
  it('returns samples in time order out to the horizon', () => {
    const samples = new BallPredictor().predict(still(0, 500), 2, 1 / 20);
    expect(samples.length).toBe(40);
    expect(samples[0]!.time).toBeCloseTo(0.05, 3);
    expect(samples.at(-1)!.time).toBeCloseTo(2.0, 3);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.time).toBeGreaterThan(samples[i - 1]!.time);
    }
  });
});
