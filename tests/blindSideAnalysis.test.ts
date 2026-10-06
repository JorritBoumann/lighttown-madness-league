import { describe, it, expect, beforeAll } from 'vitest';
import { cfg } from '../src/config';
import { initPhysics } from '../src/physics/world';
import { GameServer } from '../src/server/gameServer';
import { Recorder } from '../src/server/recorder';
import { Bot } from '../src/ai/bot';
import { analyseRecording, learningCurve, parseLines } from '../src/research/blindSideAnalysis';

/**
 * The experiment's arithmetic, on lines written by hand so every count can be
 * checked, and once on a real recording so the two cannot drift apart.
 */

beforeAll(async () => {
  await initPhysics();
});

const W = cfg.experiment.blindSide.margin + 500;
const third = cfg.arena.halfLength / 3;
const cars = [{ team: 0, bot: null }, { team: 1, bot: 3 }];
const round = (index: number, side: 1 | -1, k = 0) => ({
  t: 'round', k, index, label: `R${index}`, blindSide: { side, strength: 0.4 }, cars,
});
const touch = (car: number, x: number, z: number, k = 1) => ({ t: 'touch', k, car, p: [x, 93, z] });
const ball = (x: number, z: number, k = 1) => ({ t: 'state', k, b: [x, 93, z, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0] });

describe('measuring one run', () => {
  it('sorts the players’ touches in the attacking half by side, and ignores the rest', () => {
    const [run] = analyseRecording(
      [
        round(1, 1),
        touch(0, 2000, W), // blind
        touch(0, 2000, -W), // strong
        touch(0, 2000, -W), // strong
        touch(0, 2000, 0), // middle
        touch(0, -2000, W), // own half: not counted
        touch(1, 2000, W), // the bot's: not counted
      ] as never,
      'hand',
    );
    expect(run!.rounds[0]!.touches).toEqual({ blind: 1, strong: 2, middle: 1 });
  });

  it('counts an attack once, by the side it came in on, and credits the goal to it', () => {
    const [run] = analyseRecording(
      [
        round(1, -1),
        ball(0, -W),
        ball(third + 100, -W), // in on the blind side (-1)
        ball(third + 50, -W), // bobbling on the line: same attack
        ball(third + 300, 0),
        { t: 'goal', k: 2, team: 0 },
        { t: 'kickoff', k: 3 },
        ball(third + 100, W), // in on the strong side
        ball(0, W), // cleared
        ball(third + 100, 0), // in through the middle
      ] as never,
      'hand',
    );
    const r = run!.rounds[0]!;
    expect(r.entries).toEqual({ blind: 1, strong: 1, middle: 1 });
    expect(r.scored).toEqual({ blind: 1, strong: 0, middle: 0 });
    expect(r.goalsFor).toBe(1);
  });

  it('starts a new run when round one comes round again', () => {
    const runs = analyseRecording(
      [round(1, 1), touch(0, 2000, W), round(2, 1), touch(0, 2000, W), round(1, -1), touch(0, 2000, -W)] as never,
      'hand',
    );
    expect(runs).toHaveLength(2);
    expect(runs[0]!.rounds.map((r) => r.index)).toEqual([1, 2]);
    expect(runs[1]!.blindSide!.side).toBe(-1);
  });

  it('builds the learning curve by round across runs', () => {
    const runs = analyseRecording(
      [
        round(1, 1), touch(0, 2000, W), touch(0, 2000, -W),
        round(2, 1), touch(0, 2000, W), touch(0, 2000, W), touch(0, 2000, W), touch(0, 2000, -W),
        round(1, -1), touch(0, 2000, W),
      ] as never,
      'hand',
    );
    const curve = learningCurve(runs);
    expect(curve.map((p) => p.round)).toEqual([1, 2]);
    // Round one: blind 1 of 2 in the first run, plus a strong one in the second.
    expect(curve[0]!.touchShare).toBeCloseTo(1 / 3);
    expect(curve[1]!.touchShare).toBeCloseTo(3 / 4);
  });

  it('survives a file cut off mid-line', () => {
    const lines = parseLines('{"t":"round","k":0}\n{"t":"in","k":1}\n{"t":"sta');
    expect(lines).toHaveLength(2);
  });
});

describe('on a real recording', () => {
  it('measures a server match, a bot standing in for the person', () => {
    const text: string[] = [];
    const server = new GameServer({
      code: 'REAL',
      recorder: new Recorder((line) => text.push(line)),
      random: () => 0.37,
    });
    const joined = server.join()!;
    // A bot in the person's seat, its controls sent the way a client sends them.
    const stand = new Bot(server.sim.cars[joined.handle.carIndex]!.car, 3, () => 0.5, 'attacker');
    let seq = 0;
    for (let i = 0; i < Math.round(40 / server.stepSeconds); i++) {
      const input = stand.think(server.stepSeconds, {
        ball: { position: server.sim.ball.position, velocity: server.sim.ball.velocity, radius: cfg.ball.radius },
        pads: server.sim.pads.pads,
      });
      server.onInput(joined.handle.id, ++seq, input);
      server.step();
    }
    server.dispose();

    const runs = analyseRecording(parseLines(text.join('\n')), 'real');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.blindSide).toEqual(server.run.blindSide);
    const r = runs[0]!.rounds[0]!;
    const touches = r.touches.blind + r.touches.strong + r.touches.middle;
    expect(touches).toBeGreaterThan(0);
    // Every goal the person's side scored is in the round's count.
    const goals = parseLines(text.join('\n')).filter((l) => l.t === 'goal' && l.team === 0).length;
    expect(r.goalsFor).toBe(goals);
  }, 60_000);
});
