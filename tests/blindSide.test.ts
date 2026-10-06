import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { cfg } from '../src/config';
import { initPhysics } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { buildRound } from '../src/state/round';
import { Run } from '../src/state/run';
import { GameServer } from '../src/server/gameServer';
import { describeSide, pickBlindSide, sideOf, type BlindSide } from '../src/state/blindSide';
import type { CarInput } from '../src/input/types';

/**
 * The blind side: hidden from the player, held for a whole run, and a real
 * weakness rather than a label -- a keeper that has one lets in more at that
 * post, and only that post.
 */

beforeAll(async () => {
  await initPhysics();
});

const saved = { ...cfg.experiment.blindSide };
afterEach(() => {
  Object.assign(cfg.experiment.blindSide, saved);
});

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('choosing and describing', () => {
  it('is off when the experiment is', () => {
    cfg.experiment.blindSide.enabled = false;
    expect(pickBlindSide(Math.random)).toBeNull();
  });

  it('picks both sides', () => {
    expect(pickBlindSide(() => 0.2)!.side).toBe(1);
    expect(pickBlindSide(() => 0.8)!.side).toBe(-1);
  });

  it('calls the middle of the pitch neither side', () => {
    const m = cfg.experiment.blindSide.margin;
    expect(sideOf(0)).toBe(0);
    expect(sideOf(m - 1)).toBe(0);
    expect(sideOf(m + 1)).toBe(1);
    expect(sideOf(-m - 1)).toBe(-1);
  });

  it('names +z as the attacker’s right', () => {
    expect(describeSide(1)).toBe('right');
    expect(describeSide(-1)).toBe('left');
  });
});

describe('a run', () => {
  it('keeps one blind side for every round, and it moves between runs', () => {
    const sides = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const run = new Run({}, seeded(seed));
      run.start();
      const side = run.blindSide!.side;
      sides.add(side);
      for (let round = 0; round < 4; round++) {
        expect(run.spec!.blindSide).toEqual(run.blindSide);
        run.finishRound({ winner: 0, score: [1, 0], reason: 'time' } as never, 60);
        run.choose(0);
      }
      expect(run.blindSide!.side).toBe(side);
    }
    expect(sides.size).toBe(2);
  });

  it('is not sent to players', () => {
    const server = new GameServer({ random: seeded(3) });
    const round = server.currentRound()!;
    expect(JSON.stringify(round)).not.toMatch(/blind/i);
    expect(server.run.blindSide).not.toBeNull();
    server.dispose();
  });

  it('reaches the opposition and only the opposition', () => {
    const server = new GameServer({ random: seeded(5), maxClients: 2 });
    const blind = server.run.blindSide;
    for (const entry of server.sim.cars) {
      if (entry.bot) expect(entry.bot.blindSide).toEqual(blind);
      else expect(entry.car.team).toBe(0);
    }
    server.dispose();
  });
});

/** A shot at one post from the wing, with only a keeper to stop it. */
function shot(seed: number, wing: 1 | -1, blind: BlindSide | null): boolean {
  const random = seeded(seed);
  const sim = new Simulation(random);
  sim.addCar(1, 0, 3, 'keeper').bot!.blindSide = blind;
  let scored = false;
  sim.startMatch(
    { ...buildRound(1, () => 0.5).rules, durationSeconds: 60, countdown: 0, suddenDeath: false, goalTarget: 99 },
    { onGoal: (e) => { if (e.team === 0) scored = true; } },
  );
  sim.resetKickoff();
  const j = (n: number): number => (random() - 0.5) * n;
  const h = cfg.arena.halfLength;
  const ride = cfg.car.hitbox.height / 2 + cfg.car.rideHeight;
  sim.cars[0]!.car.reset({ x: h - 500, y: ride, z: 0 }, Math.PI);
  const from = { x: 1500 + j(600), z: wing * (2000 + j(800)) };
  const post = { x: h, z: wing * (cfg.arena.goalWidth / 2 - 220 + j(200)) };
  sim.ball.reset({ x: from.x, y: cfg.ball.radius + 60, z: from.z });
  const dx = post.x - from.x;
  const dz = post.z - from.z;
  const len = Math.hypot(dx, dz);
  const speed = 1300 + j(400);
  sim.ball.body.setLinvel({ x: (dx / len) * speed, y: 150 + j(150), z: (dz / len) * speed }, true);
  const none = new Map<number, CarInput>();
  for (let i = 0; i < Math.round(5 / cfg.physics.fixedDt) && !scored; i++) {
    sim.step(cfg.physics.fixedDt, { driving: true, frozen: false, clock: true, inputs: none });
  }
  sim.dispose();
  return scored;
}

describe('the weakness', () => {
  it('lets in more at the blind post, and no more at the other', () => {
    const N = 30;
    const blind: BlindSide = { side: 1, strength: cfg.experiment.blindSide.strength };
    const count = (wing: 1 | -1, b: BlindSide | null): number => {
      let goals = 0;
      for (let seed = 1; seed <= N; seed++) if (shot(seed * 13 + (wing > 0 ? 0 : 500), wing, b)) goals++;
      return goals;
    };
    const atBlind = count(1, blind);
    const atStrong = count(-1, blind);
    const unhandicapped = count(1, null);
    // The same shots, so the difference is the keeper and nothing else.
    expect(atBlind).toBeGreaterThanOrEqual(unhandicapped * 1.8);
    expect(atBlind).toBeGreaterThanOrEqual(atStrong * 1.8);
    expect(atStrong).toBeLessThanOrEqual(unhandicapped + 3);
  }, 60_000);
});
