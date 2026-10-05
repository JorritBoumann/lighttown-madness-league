import { describe, it, expect, beforeAll } from 'vitest';
import { cfg } from '../src/config';
import { initPhysics } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { buildRound } from '../src/state/round';
import { emptyInput, type CarInput } from '../src/input/types';
import type { GoalEvent, MatchRules } from '../src/state/match';

/**
 * A whole match, played with nothing attached to it.
 *
 * Until now the tests could exercise a car, a ball or a bot, but never the game
 * — because the game only existed inside `Game`, wired to a renderer, an audio
 * context and the DOM. This runs the real rules, the real physics and the real
 * bots under Node, which is the thing that had to be true before a
 * server-authoritative multiplayer build was worth discussing.
 */

beforeAll(async () => {
  await initPhysics();
});

const NO_INPUT = new Map<number, CarInput>();

/** Real round rules, so the shape cannot drift from what the game uses. */
function rules(over: Partial<MatchRules> = {}): MatchRules {
  return { ...buildRound(1, () => 0.5).rules, ...over };
}

/** Runs a simulation forward, with the player idle unless told otherwise. */
function play(
  sim: Simulation,
  seconds: number,
  input: Partial<CarInput> = {},
): void {
  const dt = cfg.physics.fixedDt;
  const inputs = new Map<number, CarInput>([[0, { ...emptyInput(), ...input }]]);
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    sim.step(dt, { driving: true, frozen: false, clock: true, inputs });
  }
}

describe('a match with no renderer attached', () => {
  it('runs the clock down and ends on its own', () => {
    const sim = new Simulation(() => 0.5);
    sim.addCar(0, 0, null);
    const spec = buildRound(1, () => 0.5);
    sim.setOpponents(spec.lineup);

    let ended = false;
    // Short match, no countdown to sit through, and no sudden death — at 0-0
    // with sudden death on, running out of clock is exactly when the match is
    // *not* supposed to end, so leaving it on tested the opposite of this.
    sim.startMatch(rules({ durationSeconds: 5, countdown: 0, suddenDeath: false }), {
      onEnd: () => {
        ended = true;
      },
    });
    sim.resetKickoff();

    play(sim, 6);
    expect(ended).toBe(true);
  });

  it('lets the bots play football', () => {
    // No human input at all: the opposition alone should move the ball off the
    // spot and get it into the player's half.
    const sim = new Simulation(() => 0.5);
    sim.addCar(0, 0, null);
    const spec = buildRound(3, () => 0.5);
    sim.setOpponents(spec.lineup);
    sim.startMatch(rules({ durationSeconds: 120, countdown: 0 }), {});
    sim.resetKickoff();

    const dt = cfg.physics.fixedDt;
    let moved = 0;
    for (let i = 0; i < Math.round(12 / dt); i++) {
      sim.step(dt, { driving: true, frozen: false, clock: true, inputs: NO_INPUT });
      moved = Math.max(moved, Math.hypot(sim.ball.position.x, sim.ball.position.z));
    }
    expect(spec.lineup.length).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(800);
  });

  it('reports the contacts the presentation layer needs', () => {
    const sim = new Simulation(() => 0.5);
    sim.addCar(0, 0, null);
    sim.setOpponents([]);
    sim.startMatch(rules({ durationSeconds: 120, countdown: 0 }), {});
    sim.resetKickoff();

    // Drive the player straight at the ball sitting on the halfway spot.
    const dt = cfg.physics.fixedDt;
    const inputs = new Map<number, CarInput>([[0, { ...emptyInput(), throttle: 1, boost: true }]]);
    let touches = 0;
    for (let i = 0; i < Math.round(4 / dt); i++) {
      const events = sim.step(dt, { driving: true, frozen: false, clock: true, inputs });
      touches += events.ballTouches.length;
    }
    expect(touches).toBeGreaterThan(0);
  });

  it('holds everyone still when nobody is driving', () => {
    const sim = new Simulation(() => 0.5);
    sim.addCar(0, 0, null);
    sim.setOpponents([]);
    sim.startMatch(rules({ durationSeconds: 120, countdown: 0 }), {});
    sim.resetKickoff();

    const before = { ...sim.player.car.position };
    const dt = cfg.physics.fixedDt;
    const inputs = new Map<number, CarInput>([[0, { ...emptyInput(), throttle: 1, boost: true }]]);
    for (let i = 0; i < Math.round(2 / dt); i++) {
      sim.step(dt, { driving: false, frozen: true, clock: false, inputs });
    }
    const after = sim.player.car.position;
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(5);
  });

  it('is reproducible from the same seed and inputs', () => {
    // The property a server-authoritative build rests on: same start, same
    // inputs, same outcome. Within one process and one build, at least — across
    // machines is a different question and the reason to keep one simulation
    // authoritative rather than trusting several to agree.
    const run = (): number[] => {
      const sim = new Simulation(() => 0.5);
      sim.addCar(0, 0, null);
      const spec = buildRound(2, () => 0.5);
      sim.setOpponents(spec.lineup);
      sim.startMatch(rules({ durationSeconds: 120, countdown: 0 }), {});
      sim.resetKickoff();
      play(sim, 5, { throttle: 1, steer: 0.3, boost: true });
      const p = sim.player.car.position;
      const b = sim.ball.position;
      return [p.x, p.y, p.z, b.x, b.y, b.z];
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });
});

describe('goals still happen', () => {
  it('scores when the ball is driven over the line', () => {
    const sim = new Simulation(() => 0.5);
    sim.addCar(0, 0, null);
    sim.setOpponents([]);
    const goals: GoalEvent[] = [];
    sim.startMatch(rules({ durationSeconds: 300, countdown: 0, goalTarget: 0 }), {
      onGoal: (e) => goals.push(e),
      onKickoff: () => sim.resetKickoff(),
    });
    sim.resetKickoff();

    // Put the ball just outside the orange mouth and nudge it in.
    sim.ball.body.setTranslation({ x: cfg.arena.goalLine - 160, y: cfg.ball.radius, z: 0 }, true);
    sim.ball.body.setLinvel({ x: 1400, y: 0, z: 0 }, true);
    play(sim, 2);
    expect(goals.length).toBe(1);
    expect(goals[0]!.team).toBe(0);
  });
});
