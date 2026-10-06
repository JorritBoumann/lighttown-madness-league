import { describe, it, expect, beforeAll } from 'vitest';
import { cfg } from '../src/config';
import { initPhysics } from '../src/physics/world';
import { GameServer } from '../src/server/gameServer';
import { ConfigOverrides } from '../src/state/configOverride';

/**
 * A gauntlet run, played by more than one person.
 *
 * The run moved to the server because it is a sequence of decisions — which
 * round, which modifiers, which upgrades — and two clients deciding those
 * separately is two different games being played at once.
 */

beforeAll(async () => {
  await initPhysics();
});

function server(): GameServer {
  return new GameServer({ maxClients: 2, botOpponents: 1, random: () => 0.5 });
}

describe('the server owns the run', () => {
  it('starts on round one with the opposition in place', () => {
    const s = server();
    const run = s.runState();
    expect(run.phase).toBe('round');
    expect(run.round).toBe(1);
    // Two seats plus the bot the round asked for.
    expect(s.sim.cars.length).toBe(3);
  });

  it('tells a joining client the round it is joining', () => {
    const s = server();
    const round = s.currentRound();
    expect(round).not.toBeNull();
    expect(round!.index).toBe(1);
    expect(round!.type).toBe('round');
  });

  it('sends the tuning as values, not as modifier names', () => {
    // The guarantee that matters: whatever the round did to gravity or ball
    // mass arrives as a number the client writes straight into its own config,
    // so the two ends cannot compute it differently.
    const s = server();
    for (let i = 0; i < 12; i++) {
      s.run.finishRound({ winner: 0, score: [1, 0], overtime: false, reason: 'goal-target' }, 10);
      if (s.run.phase === 'between') s.run.advance();
    }
    const round = s.currentRound()!;
    for (const [path, value] of Object.entries(round.config)) {
      expect(path).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('applies a round config patch to exactly the same numbers', () => {
    // What the client does on receipt, checked against the config it writes to.
    const overrides = new ConfigOverrides();
    const before = cfg.physics.gravity;
    overrides.apply({ 'physics.gravity': -400 });
    expect(cfg.physics.gravity).toBe(-400);
    overrides.revert();
    expect(cfg.physics.gravity).toBe(before);
  });
});

describe('upgrades in a shared run', () => {
  it('offers them between rounds and lets the host take one', () => {
    const s = server();
    const host = s.join()!;
    const other = s.join()!;

    s.run.finishRound({ winner: 0, score: [1, 0], overtime: false, reason: 'goal-target' }, 10);
    const between = s.runState();
    expect(between.phase).toBe('between');
    expect(between.offer.length).toBeGreaterThan(0);
    expect(between.chooser).toBe(host.handle.id);

    // The non-host's choice is ignored; the host's is taken.
    s.choose(other.handle.id, 0);
    expect(s.run.upgrades).toHaveLength(0);
    s.choose(host.handle.id, 0);
    expect(s.run.upgrades).toHaveLength(1);
  });

  it('hands the choice on when the host leaves', () => {
    const s = server();
    const host = s.join()!;
    const other = s.join()!;
    s.run.finishRound({ winner: 0, score: [1, 0], overtime: false, reason: 'goal-target' }, 10);
    expect(s.runState().chooser).toBe(host.handle.id);

    s.leave(host.handle.id);
    // Somebody must still be able to choose, or the run deadlocks.
    expect(s.runState().chooser).toBe(other.handle.id);
    s.choose(other.handle.id, 0);
    expect(s.run.upgrades).toHaveLength(1);
  });

  it('applies a taken upgrade to every human car, not just one', () => {
    // A shared run is shared. An upgrade that only helped whoever picked it
    // would make the second seat a worse place to sit for no stated reason.
    const s = server();
    const host = s.join()!;
    s.join();
    s.run.finishRound({ winner: 0, score: [1, 0], overtime: false, reason: 'goal-target' }, 10);
    s.choose(host.handle.id, 0);
    s.run.advance();

    const [a, b] = [s.sim.cars[0]!.car.mods, s.sim.cars[1]!.car.mods];
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

describe('rounds advance', () => {
  it('moves to the next round and rebuilds the world for it', () => {
    const s = server();
    s.join();
    expect(s.runState().round).toBe(1);

    s.run.finishRound({ winner: 0, score: [1, 0], overtime: false, reason: 'goal-target' }, 10);
    s.run.advance();

    const run = s.runState();
    expect(run.round).toBe(2);
    expect(run.phase).toBe('round');
    // A fresh round means a fresh round message for the clients.
    expect(s.takeRoundMessage()?.index).toBe(2);
  });

  it('ends the run when a round is lost', () => {
    const s = server();
    s.join();
    s.run.finishRound({ winner: 1, score: [0, 1], overtime: false, reason: 'conceded' }, 10);
    expect(s.runState().phase).toBe('over');
  });
});

describe('goals reach the clients', () => {
  it('reports a goal once, with who it counts for', () => {
    const s = server();
    s.join();
    // Past the countdown first: during it the match holds everyone on their
    // line and does not look at the ball, so a goal scored then is not one.
    while (s.sim.match.phase !== 'playing') s.step();
    // Put the ball through the orange mouth.
    s.sim.ball.body.setTranslation(
      { x: cfg.arena.goalLine - 150, y: cfg.ball.radius, z: 0 },
      true,
    );
    s.sim.ball.body.setLinvel({ x: 1500, y: 0, z: 0 }, true);
    // Clear anything queued by the round starting.
    s.takeGoalMessage();

    let goals = 0;
    let seen: { team: number; score: [number, number] } | null = null;
    for (let i = 0; i < 240; i++) {
      s.step();
      const goal = s.takeGoalMessage();
      if (goal) {
        goals++;
        seen = { team: goal.team, score: goal.score };
      }
    }
    expect(goals).toBe(1);
    expect(seen!.team).toBe(0);
    expect(seen!.score).toEqual([1, 0]);
  });

  it('tells clients when everyone is put back on their line', () => {
    // Without this a client never clears its trails, and a kickoff draws a
    // streak from wherever each car was to wherever it now is.
    const s = server();
    s.join();
    while (s.sim.match.phase !== 'playing') s.step();
    s.sim.ball.body.setTranslation(
      { x: cfg.arena.goalLine - 150, y: cfg.ball.radius, z: 0 },
      true,
    );
    s.sim.ball.body.setLinvel({ x: 1500, y: 0, z: 0 }, true);
    s.takeKickoffMessage();

    let kickoffs = 0;
    for (let i = 0; i < 900; i++) {
      s.step();
      if (s.takeKickoffMessage()) kickoffs++;
    }
    expect(kickoffs).toBeGreaterThanOrEqual(1);
  });

  it('hands out each event once, not on every step after it', () => {
    const s = server();
    s.join();
    s.takeGoalMessage();
    s.takeKickoffMessage();
    expect(s.takeGoalMessage()).toBeNull();
    expect(s.takeKickoffMessage()).toBeNull();
  });
});

describe('run changes are broadcast, not just recorded', () => {
  /**
   * The earlier tests read `runState()` directly, which is what the server
   * *knows*. This checks `takeRunMessage()`, which is what it *says* — and the
   * two disagreed: a cleared round moved the run to `between` and nothing went
   * out, so a joined game sat on an ended match with no upgrade picker.
   */
  it('announces a cleared round with its offer', () => {
    const s = server();
    s.join();
    s.takeRunMessage(); // the round-one state, already sent

    s.run.finishRound({ winner: 0, score: [1, 0], overtime: false, reason: 'time' }, 10);
    const message = s.takeRunMessage();
    expect(message?.phase).toBe('between');
    expect(message!.offer.length).toBeGreaterThan(0);
    expect(message!.chooser).not.toBeNull();
  });

  it('announces the new chooser when the host leaves', () => {
    const s = server();
    const host = s.join()!;
    const other = s.join()!;
    s.run.finishRound({ winner: 0, score: [1, 0], overtime: false, reason: 'time' }, 10);
    s.takeRunMessage();

    s.leave(host.handle.id);
    expect(s.takeRunMessage()?.chooser).toBe(other.handle.id);
  });

  it('says nothing when nothing changed', () => {
    const s = server();
    s.join();
    s.takeRunMessage();
    for (let i = 0; i < 30; i++) s.step();
    expect(s.takeRunMessage()).toBeNull();
  });
});

describe('the server does not get stuck', () => {
  it('starts a new run after one ends', () => {
    // It used to sit on the finished match forever: one run per process.
    const s = new GameServer({ maxClients: 2, botOpponents: 1, random: () => 0.5, restartAfter: 1 });
    s.join();
    s.run.finishRound({ winner: 1, score: [0, 2], overtime: false, reason: 'goal-target' }, 10);
    expect(s.runState().phase).toBe('over');

    for (let i = 0; i < Math.ceil(1.1 / s.stepSeconds); i++) s.step();
    const run = s.runState();
    expect(run.phase).toBe('round');
    expect(run.round).toBe(1);
    // A fresh run, not the old one resumed.
    expect(run.taken).toEqual([]);
  });

  it('picks for a host who has walked away', () => {
    const s = new GameServer({ maxClients: 2, botOpponents: 1, random: () => 0.5, pickTimeout: 1 });
    s.join();
    s.run.finishRound({ winner: 0, score: [1, 0], overtime: false, reason: 'time' }, 10);
    expect(s.runState().phase).toBe('between');

    for (let i = 0; i < Math.ceil(1.1 / s.stepSeconds); i++) s.step();
    const run = s.runState();
    expect(run.phase).toBe('round');
    expect(run.round).toBe(2);
    expect(run.taken).toHaveLength(1);
  });

  it('waits the full timeout before picking, not a step', () => {
    const s = new GameServer({ maxClients: 2, botOpponents: 1, random: () => 0.5, pickTimeout: 1 });
    s.join();
    s.run.finishRound({ winner: 0, score: [1, 0], overtime: false, reason: 'time' }, 10);
    for (let i = 0; i < Math.floor(0.5 / s.stepSeconds); i++) s.step();
    expect(s.runState().phase).toBe('between');
  });
});
