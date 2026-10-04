import { describe, it, expect, vi } from 'vitest';
import { cfg } from '../src/config';
import {
  Match,
  formatClock,
  type BallLike,
  type GoalEvent,
  type MatchResult,
  type MatchRules,
  type Team,
} from '../src/state/match';

/**
 * Match flow is pure logic, so it is tested without a physics world: feed it a
 * ball position and a clock and check the rules come out right.
 */

const RADIUS = cfg.ball.radius;

/** A ball at a given spot. */
const ball = (x: number, y = RADIUS, z = 0): BallLike => ({ position: { x, y, z }, radius: RADIUS });

/** Centre spot. */
const CENTRE = ball(0);

/** Just past the line at the given end: a goal. */
function inNet(sign: 1 | -1, z = 0, y = RADIUS): BallLike {
  return ball(sign * (cfg.arena.goalLine + RADIUS + 1), y, z);
}

/** Runs the match forward, holding the ball at one spot. */
function advance(match: Match, seconds: number, at: BallLike = CENTRE): void {
  const dt = cfg.physics.fixedDt;
  for (let i = 0; i < Math.round(seconds / dt); i++) match.update(dt, at);
}

/** A match already past its countdown and into play. */
function playing(rules: Partial<MatchRules> = {}, handlers = {}): Match {
  const match = new Match(rules, handlers);
  advance(match, match.rules.countdown + 0.05);
  return match;
}

describe('phases', () => {
  it('starts frozen on a countdown, not in play', () => {
    const match = new Match();
    expect(match.phase).toBe('countdown');
    expect(match.running).toBe(false);
  });

  it('does not run the clock during the countdown', () => {
    const match = new Match({ durationSeconds: 90, countdown: 3 });
    advance(match, 2.0);
    expect(match.clock).toBe(90);
    expect(match.phase).toBe('countdown');
  });

  it('starts play when the countdown expires', () => {
    const match = new Match({ countdown: 3 });
    advance(match, 3.05);
    expect(match.phase).toBe('playing');
    expect(match.running).toBe(true);
  });

  it('runs the clock down only while playing', () => {
    const match = playing({ durationSeconds: 90 });
    advance(match, 10);
    expect(match.clock).toBeGreaterThan(79);
    expect(match.clock).toBeLessThan(81);
  });

  it('ignores a ball in the net before kickoff', () => {
    const match = new Match({ countdown: 3 });
    advance(match, 2.0, inNet(1));
    expect(match.score).toEqual([0, 0]);
  });
});

describe('goal detection', () => {
  it('needs the ball fully past the line', () => {
    const match = playing();
    // Centre exactly on the line: not yet a goal.
    advance(match, 0.2, ball(cfg.arena.goalLine));
    expect(match.score).toEqual([0, 0]);
    // A radius further on: goal.
    advance(match, 0.1, ball(cfg.arena.goalLine + RADIUS + 1));
    expect(match.score).toEqual([1, 0]);
  });

  it('credits the +x net to blue and the -x net to orange', () => {
    const blue = playing();
    advance(blue, 0.1, inNet(1));
    expect(blue.score).toEqual([1, 0]);

    const orange = playing();
    advance(orange, 0.1, inNet(-1));
    expect(orange.score).toEqual([0, 1]);
  });

  it('does not count a ball wide of the mouth', () => {
    const match = playing();
    advance(match, 0.2, inNet(1, cfg.arena.goalWidth / 2 + 50));
    expect(match.score).toEqual([0, 0]);
  });

  it('does not count a ball above the crossbar', () => {
    const match = playing();
    advance(match, 0.2, inNet(1, 0, cfg.arena.goalHeight + 50));
    expect(match.score).toEqual([0, 0]);
  });

  it('counts one goal, not one per step the ball sits in the net', () => {
    const match = playing({ goalTarget: 0 });
    advance(match, 1.0, inNet(1));
    expect(match.score).toEqual([1, 0]);
  });
});

describe('own goals', () => {
  it('credits the opposing team and flags it', () => {
    const goals: GoalEvent[] = [];
    const match = playing({ goalTarget: 0 }, { onGoal: (e: GoalEvent) => goals.push(e) });
    // Blue touched it last, and it went into blue's own net at -x.
    match.touch(0);
    advance(match, 0.1, inNet(-1));
    expect(match.score).toEqual([0, 1]);
    expect(goals[0]!.ownGoal).toBe(true);
    expect(goals[0]!.team).toBe(1);
  });

  it('is not an own goal when the scoring team touched it last', () => {
    const goals: GoalEvent[] = [];
    const match = playing({ goalTarget: 0 }, { onGoal: (e: GoalEvent) => goals.push(e) });
    match.touch(0);
    advance(match, 0.1, inNet(1));
    expect(goals[0]!.ownGoal).toBe(false);
  });

  it('forgets the last touch at the next kickoff', () => {
    const match = playing({ goalTarget: 0, goalPause: 1 });
    match.touch(0);
    advance(match, 0.1, inNet(1));
    expect(match.lastTouch).toBe(0);
    advance(match, 1.1, CENTRE);
    expect(match.lastTouch).toBe(null);
  });
});

describe('kickoffs after a goal', () => {
  it('pauses, then asks for a kickoff, then counts down again', () => {
    const onKickoff = vi.fn();
    const match = playing({ goalTarget: 0, goalPause: 2, countdown: 3 }, { onKickoff });

    advance(match, 0.1, inNet(1));
    expect(match.phase).toBe('goal');
    expect(onKickoff).not.toHaveBeenCalled();

    advance(match, 2.0, inNet(1));
    expect(onKickoff).toHaveBeenCalledTimes(1);
    expect(match.phase).toBe('countdown');

    advance(match, 3.05, CENTRE);
    expect(match.phase).toBe('playing');
  });

  it('holds the clock through the goal celebration', () => {
    const match = playing({ goalTarget: 0, durationSeconds: 90, goalPause: 2 });
    advance(match, 0.1, inNet(1));
    const atGoal = match.clock;
    advance(match, 1.5, inNet(1));
    // The celebration is not playing time, so the clock holds.
    expect(match.clock).toBe(atGoal);
  });
});

describe('win conditions', () => {
  it('ends the moment the goal target is reached', () => {
    const onEnd = vi.fn();
    const match = playing({ goalTarget: 2, goalPause: 1 }, { onEnd });

    advance(match, 0.1, inNet(1));
    expect(match.over).toBe(false);
    advance(match, 1.1, CENTRE); // back to kickoff
    advance(match, match.rules.countdown + 0.05, CENTRE);
    advance(match, 0.1, inNet(1));

    expect(match.over).toBe(true);
    expect(onEnd).toHaveBeenCalledTimes(1);
    const result = onEnd.mock.calls[0]![0] as MatchResult;
    expect(result.winner).toBe(0);
    expect(result.reason).toBe('goal-target');
    expect(match.goals.at(-1)!.decisive).toBe(true);
  });

  it('awards the match to whoever leads when time expires', () => {
    const onEnd = vi.fn();
    const match = playing({ goalTarget: 0, durationSeconds: 5, goalPause: 0.2 }, { onEnd });
    advance(match, 0.1, inNet(-1)); // orange scores
    advance(match, 10, CENTRE);
    const result = onEnd.mock.calls[0]![0] as MatchResult;
    expect(result.winner).toBe(1);
    expect(result.reason).toBe('time');
  });

  it('goes to sudden death on a draw, and the next goal wins it', () => {
    const onEnd = vi.fn();
    const match = playing(
      { goalTarget: 0, durationSeconds: 3, goalPause: 0.5, suddenDeath: true },
      { onEnd },
    );
    advance(match, 3.2, CENTRE);
    expect(match.over).toBe(false);
    expect(match.overtime).toBe(true);
    expect(onEnd).not.toHaveBeenCalled();

    // Through the kickoff and into sudden death.
    advance(match, 0.6 + match.rules.countdown + 0.05, CENTRE);
    expect(match.phase).toBe('playing');
    advance(match, 0.1, inNet(1));

    const result = onEnd.mock.calls[0]![0] as MatchResult;
    expect(result.winner).toBe(0);
    expect(result.overtime).toBe(true);
    expect(result.reason).toBe('sudden-death');
  });

  it('counts up in sudden death rather than down', () => {
    const match = playing({ goalTarget: 0, durationSeconds: 2, goalPause: 0.2, suddenDeath: true });
    advance(match, 2.3 + 0.3 + match.rules.countdown + 0.05, CENTRE);
    expect(match.overtime).toBe(true);
    const before = match.clock;
    advance(match, 1.0, CENTRE);
    expect(match.clock).toBeGreaterThan(before);
  });

  it('is a draw at full time when sudden death is off', () => {
    const onEnd = vi.fn();
    const match = playing({ goalTarget: 0, durationSeconds: 3, suddenDeath: false }, { onEnd });
    advance(match, 3.2, CENTRE);
    const result = onEnd.mock.calls[0]![0] as MatchResult;
    expect(result.winner).toBe(null);
    expect(result.reason).toBe('time');
  });

  it('stops scoring once over', () => {
    const match = playing({ goalTarget: 1 });
    advance(match, 0.1, inNet(1));
    expect(match.over).toBe(true);
    advance(match, 2.0, inNet(1));
    expect(match.score).toEqual([1, 0]);
  });

  it('records every goal in order for the run summary', () => {
    const match = playing({ goalTarget: 0, goalPause: 0.2, countdown: 0.2 });
    const sequence: Team[] = [0, 1, 0];
    for (const team of sequence) {
      advance(match, 0.1, inNet(team === 0 ? 1 : -1));
      advance(match, 0.45, CENTRE);
    }
    expect(match.goals.map((g) => g.team)).toEqual(sequence);
    expect(match.score).toEqual([2, 1]);
  });
});

describe('clock formatting', () => {
  it('reads as minutes and seconds', () => {
    expect(formatClock(90)).toBe('1:30');
    expect(formatClock(9)).toBe('0:09');
    expect(formatClock(60)).toBe('1:00');
  });

  it('never shows a negative clock', () => {
    expect(formatClock(-3)).toBe('0:00');
  });
});
