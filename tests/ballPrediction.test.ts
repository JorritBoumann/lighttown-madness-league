import { describe, it, expect } from 'vitest';
import { cfg } from '../src/config';
import { BallPredictor, predictAt, threatensGoal } from '../src/ai/ballPrediction';

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

/**
 * Reading a shot. This decides whether a bot leaves the ground in defence, so
 * both answers are expensive: a missed threat is a goal, and a false one sends
 * the defender into the air for a ball that was never going in.
 */
describe('threats on goal', () => {
  const GOAL_X = cfg.arena.halfLength;
  const halfWidth = cfg.arena.goalWidth / 2 + cfg.ball.radius;
  const maxHeight = cfg.arena.goalHeight + cfg.ball.radius;

  /** A ball fired from midfield at a given point on the goal plane. */
  const shot = (aimZ: number, aimY: number, flight = 1.6, fromY = 300) => {
    const from = { x: GOAL_X - 3000, y: fromY, z: 0 };
    const g = -cfg.physics.gravity;
    const predictor = new BallPredictor();
    return predictor.predict(
      {
        position: from,
        velocity: {
          x: 3000 / flight,
          y: (aimY - fromY + 0.5 * g * flight * flight) / flight,
          z: (aimZ - from.z) / flight,
        },
      },
      3,
    );
  };

  const look = (samples: ReturnType<typeof shot>) =>
    threatensGoal({ samples, goalX: GOAL_X, halfWidth, maxHeight });

  it('sees a shot heading into the middle of the net', () => {
    const threat = look(shot(0, 300));
    expect(threat).not.toBeNull();
    expect(threat!.time).toBeGreaterThan(0.5);
    expect(threat!.time).toBeLessThan(3);
    expect(Math.abs(threat!.z)).toBeLessThan(halfWidth);
  });

  it('ignores one going wide of the post', () => {
    expect(look(shot(halfWidth + 400, 300))).toBeNull();
  });

  it('ignores one going over the bar', () => {
    expect(look(shot(0, maxHeight + 500))).toBeNull();
  });

  it('ignores a ball travelling away from the goal', () => {
    const predictor = new BallPredictor();
    const samples = predictor.predict(
      { position: { x: 0, y: 300, z: 0 }, velocity: { x: -1500, y: 200, z: 0 } },
      3,
    );
    expect(look(samples)).toBeNull();
  });

  /** Samples built by hand, to test the bounds rather than the predictor. */
  const path = (pts: { x: number; y: number; z: number }[]) =>
    pts.map((p, i) => ({
      position: p,
      velocity: { x: 0, y: 0, z: 0 },
      time: (i + 1) * 0.1,
    }));

  it('grows the mouth by the ball radius', () => {
    // The ball is not a point: a centre just outside the post still has most
    // of the ball over the line. The predictor bounces such a ball off the
    // wall long before this, so the margin only ever matters for callers that
    // pass a path of their own — but the bound belongs here, not there.
    const justOutside = cfg.arena.goalWidth / 2 + cfg.ball.radius * 0.5;
    const samples = path([
      { x: GOAL_X - 100, y: 300, z: justOutside },
      { x: GOAL_X + 60, y: 300, z: justOutside },
    ]);
    expect(threatensGoal({ samples, goalX: GOAL_X, halfWidth, maxHeight })).not.toBeNull();
    expect(
      threatensGoal({ samples, goalX: GOAL_X, halfWidth: cfg.arena.goalWidth / 2, maxHeight }),
    ).toBeNull();
  });

  it('judges the crossing where it happens and nowhere later', () => {
    // A path that goes wide at the plane and then curls back inside it is not
    // a goal: the ball hit the wall. Deciding on the nearest approach instead
    // of the crossing would call this one in.
    const samples = path([
      { x: GOAL_X - 50, y: 300, z: 0 },
      { x: GOAL_X + 40, y: 300, z: halfWidth + 600 },
      { x: GOAL_X + 300, y: 300, z: 0 },
    ]);
    expect(threatensGoal({ samples, goalX: GOAL_X, halfWidth, maxHeight })).toBeNull();
  });

  it('works for the other net, where the ball crosses going the other way', () => {
    const samples = path([
      { x: -GOAL_X + 50, y: 300, z: 0 },
      { x: -GOAL_X - 40, y: 300, z: 0 },
    ]);
    expect(threatensGoal({ samples, goalX: -GOAL_X, halfWidth, maxHeight })).not.toBeNull();
    // And that same path is no threat at all to the net at the far end.
    expect(threatensGoal({ samples, goalX: GOAL_X, halfWidth, maxHeight })).toBeNull();
  });

  it('reports the height it crosses at, so a defender can judge the save', () => {
    const low = look(shot(0, 150));
    const high = look(shot(0, 560));
    expect(low).not.toBeNull();
    expect(high).not.toBeNull();
    expect(high!.height).toBeGreaterThan(low!.height + 200);
  });

  it('says nothing about a path that never reaches the plane', () => {
    const predictor = new BallPredictor();
    const samples = predictor.predict(
      { position: { x: 0, y: 200, z: 0 }, velocity: { x: 120, y: 0, z: 0 } },
      3,
    );
    expect(look(samples)).toBeNull();
  });
});
